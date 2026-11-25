/* global portalClient, getPortalSession, getPortalProfile,
    appendTextElement, setPortalMessage, normalizeStudentName, loadPlannerStudents,
    GRADUATION_GRADES, GRADUATION_REQUIREMENTS, formatPortalDate, portalActionMessage */

const GRADEBOOK_DEFAULT_SCALE = { A: 90, B: 80, C: 70, D: 60, F: 0 };
const GRADEBOOK_GRADE_LEVELS = ['K', ...Array.from({ length: 12 }, (_, index) => String(index + 1))];

function parseGradebookLines(value, { requiredNumbers = true } = {}) {
    const entries = [];
    const names = new Set();
    for (const line of value.split('\n').map(item => item.trim()).filter(Boolean)) {
        const [name, number, extra] = line.split('=').map(item => item.trim());
        if (!name || names.has(name) || extra !== undefined || ((requiredNumbers || number !== undefined)
            && !/^\d+(\.\d{1,2})?$/.test(number || ''))) {
            throw new Error('Use one unique label per line with a valid number where required.');
        }
        names.add(name);
        entries.push([name, number === undefined ? 0 : Number(number)]);
    }
    return Object.fromEntries(entries);
}

function formatGradebookLines(values, showNumbers = true) {
    return Object.entries(values).map(([name, value]) => showNumbers ? `${name}=${value}` : name).join('\n');
}

function validGradebookScore(score, max) {
    return Number.isFinite(score) && score >= 0 && score <= Number(max)
        && Math.abs(score * 100 - Math.round(score * 100)) <= 1e-6;
}

function calculateGradebookPreview(course, assignments, scoreFor) {
    const totals = new Map();
    let unresolved = 0;
    for (const assignment of assignments) {
        const mark = scoreFor(assignment.id);
        if (!mark || mark.state === 'ungraded' ||
            (mark.state === 'scored' && !validGradebookScore(mark.score, assignment.points))) {
            unresolved++;
            continue;
        }
        if (mark.state === 'excused' || (mark.state === 'missing' && !course.missing_is_zero)) continue;
        const category = totals.get(assignment.category) || { earned: 0, possible: 0 };
        category.earned += Number(mark.score || 0);
        category.possible += Number(assignment.points);
        totals.set(assignment.category, category);
    }

    let numerator = 0;
    let denominator = 0;
    for (const [name, totalsForCategory] of totals) {
        if (course.weighting === 'weighted') {
            const weight = Number(course.categories[name]);
            numerator += weight * totalsForCategory.earned / totalsForCategory.possible;
            denominator += weight;
        } else {
            numerator += totalsForCategory.earned;
            denominator += totalsForCategory.possible;
        }
    }

    const percent = denominator ? Math.round((100 * numerator / denominator + Number.EPSILON) * 100) / 100 : null;
    const letter = percent === null ? null : Object.entries(course.scale)
        .sort((first, second) => second[1] - first[1]).find(([, floor]) => floor <= percent)?.[0];
    return { percent, letter, unresolved, totals };
}

async function initTeacherGradebook() {
    const byId = id => document.getElementById(id);
    const status = byId('gradebook-status');
    if (!status) return;

    const panel = byId('gradebook');
    const workspace = byId('gradebook-workspace');
    const courseSelect = byId('gradebook-course');
    const settings = byId('course-settings');
    const settingsPanel = byId('course-settings-panel');
    const deleteCourse = byId('gradebook-delete-course');
    const deleteDialog = byId('gradebook-delete-course-dialog');
    const deleteForm = deleteDialog.querySelector('form');
    const deleteStatus = byId('gradebook-delete-course-status');
    const enrollmentForm = byId('gradebook-enroll');
    const assignmentForm = byId('gradebook-assignment');
    const scoreDialog = byId('gradebook-score-dialog');
    const finalDialog = byId('gradebook-final-dialog');
    const grid = byId('gradebook-grid');
    const save = byId('gradebook-save');
    const view = byId('gradebook-view');
    const scoringAssignment = byId('gradebook-scoring-assignment');
    const assignmentPanel = byId('gradebook-assignment-management');
    const studentFilter = byId('gradebook-student-filter');
    const assignmentList = byId('gradebook-assignment-list');
    const assignmentButtons = new Map();
    const googleImport = typeof initGradebookGoogleImport === 'function' ? initGradebookGoogleImport({
        runImport: work => requireSavedScores() && run(work),
        reload: id => loadCourse(id),
        canManageRoster: () => managesRoster,
        openRoster: () => {
            const rosterPanel = byId('gradebook-roster-management');
            if (rosterPanel.hidden) return;
            rosterPanel.open = true;
            enrollmentForm.elements.student_id.focus();
        }
    }) : null;
    const scoreForm = scoreDialog.querySelector('form');
    const marks = new Map();
    const dirty = new Set();
    const gradeDisplays = new Map();
    const scoresBeforeWaiver = new Map();
    let studentsAscending = true;
    let courses = [];
    let students = [];
    let course = null;
    let enrollments = [];
    let assignments = [];
    let finals = new Map();
    let scoreContext;
    let finalContext;
    let editingEnrollment;
    let busy = false;
    let managesRoster = false;

    function message(text, tone) {
        setPortalMessage(status, text, tone);
    }

    function requireSavedScores() {
        if (!dirty.size) return true;
        message('Save or discard the score changes before continuing.', 'error');
        return false;
    }

    async function run(work, action = 'open this course', next = 'Check that the course still appears in your gradebook. Ask an administrator to verify your classroom assignment if it is missing.') {
        if (busy) return;
        busy = true;
        panel.inert = true;
        let focusAfter;
        try {
            focusAfter = await work();
        } catch (error) {
            message(error.code || error.status ? portalActionMessage(error, action, next)
                : error.message || `We couldn’t ${action}. ${next}`, 'error');
        } finally {
            busy = false;
            panel.inert = false;
        }
        focusAfter?.focus();
    }

    function data(result) {
        if (result.error) throw result.error;
        return result.data;
    }

    function option(select, label, value) {
        const item = appendTextElement(select, 'option', label);
        item.value = value;
        return item;
    }

    function renderSettings(record) {
        settings.reset();
        settingsPanel.hidden = false;
        settingsPanel.open = !record;
        deleteCourse.hidden = !managesRoster || !record;
        settings.elements.name.value = record?.name || '';
        settings.elements.term.value = record?.term || '';
        settings.elements.teacher_id.value = record?.teacher_id || '';
        settings.elements.weighting.value = record?.weighting || 'points';
        settings.elements.missing_is_zero.value = String(record?.missing_is_zero ?? true);
        settings.elements.categories.value = record ? formatGradebookLines(record.categories, record.weighting === 'weighted') : 'General';
        settings.elements.scale.value = formatGradebookLines(record?.scale || GRADEBOOK_DEFAULT_SCALE);
        byId('gradebook-grading-options').open = false;
        updateRuleSummary();
    }

    function updateRuleSummary() {
        const { weighting, missing_is_zero, scale } = settings.elements;
        const thresholds = scale.value.trim().split('\n').filter(Boolean).map(line => line.trim()).join(', ');
        byId('course-settings-summary').textContent = [
            weighting.value === 'points' ? 'Total points' : 'Weighted categories',
            missing_is_zero.value === 'true' ? 'Missing work counts as zero' : 'Missing work is excluded',
            thresholds
        ].filter(Boolean).join(' · ');
    }

    function loadAssignmentForm() {
        const fields = assignmentForm.elements;
        const assignment = assignments.find(record => record.id === fields.assignment_id.value);
        fields.title.value = assignment?.title || '';
        fields.category.value = assignment?.category || Object.keys(course.categories)[0];
        fields.due_on.value = assignment?.due_on || '';
        fields.points.value = assignment?.points ?? '';
        fields.rubric.value = assignment ? formatGradebookLines(assignment.rubric) : '';
        byId('gradebook-duplicate-assignment').disabled = !assignment;
        byId('gradebook-assignment-options').open = false;
    }

    async function loadSavedMarks(courseId) {
        const marks = [];
        const pageSize = 500;
        for (let offset = 0; ; offset += pageSize) {
            const page = data(await portalClient.from('gradebook_marks').select('*').eq('course_id', courseId)
                .order('enrollment_id').order('assignment_id').range(offset, offset + pageSize - 1));
            marks.push(...page);
            if (page.length < pageSize) return marks;
        }
    }

    async function refreshCourses(selectedId) {
        courses = data(await portalClient.from('gradebook_courses').select('*').order('term', { ascending: false }).order('name'));
        courseSelect.replaceChildren();
        option(courseSelect, 'Select a course', '');
        for (const item of courses) option(courseSelect, `${item.name} · ${item.term}`, item.id);
        courseSelect.value = selectedId || courses[0]?.id || '';
        await loadCourse(courseSelect.value);
    }

    async function loadCourse(id, assignmentId) {
        const nextCourse = courses.find(item => item.id === id);
        const sameCourse = course?.id === id;
        const priorAssignment = assignmentId || (sameCourse ? scoringAssignment.value : '');
        if (!nextCourse) {
            course = null;
            googleImport?.configure(null, []);
            workspace.hidden = true;
            settingsPanel.hidden = true;
            message('Create a course to start a gradebook.');
            return;
        }

        const [roster, tasks, savedMarks, finalized] = await Promise.all([
            portalClient.from('gradebook_enrollments').select('*').eq('course_id', id),
            portalClient.from('gradebook_assignments').select('*').eq('course_id', id).order('due_on').order('title'),
            loadSavedMarks(id),
            portalClient.from('gradebook_final_courses').select('*').eq('course_id', id)
        ]);

        const nextRoster = data(roster);
        const nextAssignments = data(tasks);
        const nextFinals = data(finalized);
        course = nextCourse;
        enrollments = nextRoster.sort(compareEnrollments);
        assignments = nextAssignments;
        finals = new Map(nextFinals.map(item => [item.enrollment_id, item]));
        if (!sameCourse) {
            view.value = 'assignment';
            studentFilter.value = '';
        }
        assignmentPanel.open = false;
        scoringAssignment.replaceChildren();
        for (const assignment of assignments) option(scoringAssignment, assignment.title, assignment.id);
        const latestDated = assignments.filter(assignment => assignment.due_on).at(-1);
        scoringAssignment.value = assignments.some(assignment => assignment.id === priorAssignment)
            ? priorAssignment : latestDated?.id || assignments[0]?.id || '';
        scoringAssignment.disabled = !assignments.length;
        marks.clear();
        scoresBeforeWaiver.clear();
        dirty.clear();
        for (const mark of savedMarks) marks.set(markKey(mark.enrollment_id, mark.assignment_id), mark);
        renderEnrollmentForm();
        const fields = assignmentForm.elements;
        fields.assignment_id.replaceChildren();
        option(fields.assignment_id, 'New assignment', '');
        for (const assignment of assignments) option(fields.assignment_id, assignment.title, assignment.id);
        fields.category.replaceChildren();
        for (const category of Object.keys(course.categories)) option(fields.category, category, category);
        const copyCourse = byId('gradebook-copy-course');
        const copyAssignment = byId('gradebook-copy-assignment');
        copyCourse.replaceChildren();
        option(copyCourse, 'Select a source course', '');
        for (const source of courses.filter(item => item.id !== id)) option(copyCourse, `${source.name} · ${source.term}`, source.id);
        copyAssignment.replaceChildren();
        copyAssignment.disabled = true;
        loadAssignmentForm();
        renderSettings(course);
        workspace.hidden = false;
        grid.inert = false;
        renderAssignmentList();
        renderGrid();
        googleImport?.configure(course, enrollments.map(enrollment => ({ id: enrollment.id, name: studentName(enrollment) })));
        message(`${course.name} · ${course.term}`);
    }

    function studentName(enrollment) {
        return normalizeStudentName(students.find(student => student.id === enrollment.student_id) || {});
    }

    function compareEnrollments(first, second) {
        const firstStudent = students.find(student => student.id === first.student_id);
        const secondStudent = students.find(student => student.id === second.student_id);
        return (firstStudent?.last_name || '').localeCompare(secondStudent?.last_name || '', undefined, { sensitivity: 'base' })
            || studentName(first).localeCompare(studentName(second), undefined, { sensitivity: 'base' })
            || first.id.localeCompare(second.id);
    }

    function visibleEnrollments(fullGradebook) {
        const query = fullGradebook ? studentFilter.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean) : [];
        const selected = enrollments.filter(enrollment => {
            if (!query.length) return true;
            const student = students.find(item => item.id === enrollment.student_id);
            const names = [student?.first_name, student?.preferred_name, student?.last_name].filter(Boolean).join(' ').toLocaleLowerCase();
            return query.every(term => names.includes(term));
        });
        return studentsAscending ? selected : selected.reverse();
    }

    function renderEnrollmentForm(enrollment) {
        enrollmentForm.reset();
        const studentField = enrollmentForm.elements.student_id;
        studentField.replaceChildren();
        option(studentField, 'Select a student', '');
        if (enrollments.length) {
            const group = appendTextElement(studentField, 'optgroup', '');
            group.label = 'Enrolled students · edit settings';
            for (const item of enrollments) {
                const finalized = finals.has(item.id);
                option(group, studentName(item) + (finalized ? ' · Finalized' : ''), item.student_id).disabled = finalized;
            }
        }
        const enrolled = new Set(enrollments.map(item => item.student_id));
        const available = students.filter(student => !enrolled.has(student.id));
        if (available.length) {
            const group = appendTextElement(studentField, 'optgroup', '');
            group.label = 'Add to roster';
            for (const student of available) option(group, normalizeStudentName(student), student.id);
        }
        byId('gradebook-enrollment-finalized').hidden = !finals.size;
        studentField.value = enrollment?.student_id || '';
        fillEnrollmentSettings(enrollment);
        if (enrollment) {
            enrollmentForm.closest('details').open = true;
            enrollmentForm.elements.requirement_key.focus();
        }
    }

    function fillEnrollmentSettings(enrollment, student) {
        editingEnrollment = enrollment;
        const fields = enrollmentForm.elements;
        const grade = enrollment?.grade_level || student?.grade_level;
        fields.requirement_key.value = enrollment?.requirement_key || '';
        fields.grade_level.value = GRADEBOOK_GRADE_LEVELS.includes(grade) ? grade : '';
        fields.credits.value = enrollment?.credits ?? '';
        updateEnrollmentCredits();
        byId('gradebook-enrollment-submit').textContent = enrollment ? 'Save student settings' : 'Add to roster';
        byId('gradebook-enrollment-cancel').hidden = !enrollment;
    }

    function updateEnrollmentCredits() {
        const fields = enrollmentForm.elements;
        const eligible = GRADUATION_GRADES.includes(fields.grade_level.value);
        fields.requirement_key.disabled = !eligible;
        if (!eligible) fields.requirement_key.value = '';
        fields.credits.readOnly = !fields.requirement_key.value;
        if (fields.credits.readOnly) fields.credits.value = '0';
    }

    function markKey(enrollmentId, assignmentId) {
        return `${enrollmentId}/${assignmentId}`;
    }

    function emptyMark(enrollment, assignment) {
        return {
            course_id: course.id, enrollment_id: enrollment.id, assignment_id: assignment.id,
            state: 'ungraded', score: null, rubric_scores: {}, family_feedback: '', private_note: ''
        };
    }

    function updateMark(enrollment, assignment, changes, cell) {
        const key = markKey(enrollment.id, assignment.id);
        marks.set(key, { ...(marks.get(key) || emptyMark(enrollment, assignment)), ...changes });
        dirty.add(key);
        cell.dataset.dirty = '';
        updateSaveBar();
        updateRunningGrade(enrollment);
        updateAssignmentProgress(assignment);
        updateAssignmentSummary();
    }

    function updateRunningGrade(enrollment) {
        const display = gradeDisplays.get(enrollment.id);
        if (!display) return;
        const finalized = finals.get(enrollment.id);
        const result = calculateGradebookPreview(course, assignments, id => marks.get(markKey(enrollment.id, id)));
        display.textContent = finalized ? `${finalized.final_grade} · Finalized` :
            result.percent === null ? 'No graded work' : `${result.percent}% · ${result.letter}`;
        if (!finalized && result.unresolved) display.textContent += ` · ${result.unresolved} ungraded`;
        display.title = [...result.totals].map(([category, score]) => `${category}: ${score.earned}/${score.possible}`).join('\n');
    }

    function updateSaveBar() {
        byId('gradebook-save-bar').hidden = !dirty.size;
        save.disabled = !dirty.size;
        byId('gradebook-discard').disabled = !dirty.size;
        byId('gradebook-unsaved').textContent = dirty.size ? `${dirty.size} unsaved ${dirty.size === 1 ? 'change' : 'changes'}` : '';
    }

    function countRecorded(assignment) {
        return enrollments.filter(enrollment => {
            const mark = marks.get(markKey(enrollment.id, assignment.id));
            return mark?.state === 'missing' || mark?.state === 'excused'
                || (mark?.state === 'scored' && validGradebookScore(mark.score, assignment.points));
        }).length;
    }

    function updateAssignmentProgress(assignment) {
        const button = assignmentButtons.get(assignment.id);
        if (!button) return;
        const recorded = countRecorded(assignment);
        button.querySelector('.gradebook-assignment-count').textContent = `${recorded}/${enrollments.length} recorded`;
    }

    function assignmentDueDate(assignment) {
        return assignment.due_on ? formatPortalDate(assignment.due_on + 'T12:00:00') : '';
    }

    function renderAssignmentList() {
        assignmentList.replaceChildren();
        assignmentButtons.clear();
        assignmentList.closest('aside').hidden = !assignments.length;
        for (const assignment of assignments) {
            const row = appendTextElement(assignmentList, 'li', '');
            const button = appendTextElement(row, 'button', '', 'gradebook-assignment-choice');
            button.type = 'button';
            appendTextElement(button, 'span', assignment.title, 'gradebook-assignment-title');
            const meta = appendTextElement(button, 'span', '', 'gradebook-assignment-meta');
            const date = assignmentDueDate(assignment);
            if (date) appendTextElement(meta, 'span', date);
            appendTextElement(meta, 'span', '', 'gradebook-assignment-count');
            assignmentButtons.set(assignment.id, button);
            updateAssignmentProgress(assignment);
            button.onclick = () => openAssignment(assignment.id);
        }
    }

    function assignmentFocusTarget() {
        if (view.value !== 'assignment' || !assignments.length) return view;
        const button = assignmentButtons.get(scoringAssignment.value);
        return button?.getClientRects().length ? button : scoringAssignment;
    }

    function openAssignment(id) {
        view.value = 'assignment';
        scoringAssignment.value = id;
        renderGrid();
        assignmentFocusTarget().focus();
    }

    function updateAssignmentSummary() {
        const selected = view.value === 'assignment' && assignments.find(item => item.id === scoringAssignment.value);
        const summary = byId('gradebook-assignment-summary');
        const meter = byId('gradebook-completion-meter');
        meter.parentElement.hidden = !selected || !enrollments.length;
        if (!selected) {
            summary.textContent = view.value === 'grid' ? 'Select an assignment heading to enter or edit its scores.' : '';
            return;
        }
        const completed = countRecorded(selected);
        const date = assignmentDueDate(selected);
        meter.max = enrollments.length || 1;
        meter.value = completed;
        summary.textContent = [
            `Out of ${selected.points} points`, date && `Due ${date}`,
            `${completed} of ${enrollments.length} recorded`
        ].filter(Boolean).join(' · ');
    }

    function renderScoreCell(row, enrollment, assignment) {
        const cell = row.insertCell();
        const key = markKey(enrollment.id, assignment.id);
        const mark = marks.get(key) || emptyMark(enrollment, assignment);
        const locked = finals.has(enrollment.id);
        const context = `${studentName(enrollment)}, ${assignment.title}`;
        const scoreInput = document.createElement('input');
        scoreInput.type = 'number';
        scoreInput.inputMode = 'decimal';
        scoreInput.min = '0';
        scoreInput.max = assignment.points;
        scoreInput.step = '.01';
        scoreInput.placeholder = '—';
        scoreInput.setAttribute('aria-label', `Points for ${context}`);
        scoreInput.dataset.scoreColumn = assignment.id;
        const waiverLabel = document.createElement('label');
        waiverLabel.className = 'gradebook-waiver';
        const waiver = document.createElement('input');
        waiver.type = 'checkbox';
        waiver.disabled = locked;
        waiver.setAttribute('aria-label', `Waive assignment for ${context}`);
        waiverLabel.append(waiver);
        const waiverText = appendTextElement(waiverLabel, 'span', 'Waive');

        const details = document.createElement('button');
        details.type = 'button';
        details.className = 'gradebook-secondary';
        details.dataset.mark = key;
        function labelDetails(value) {
            const tag = value.state === 'missing' ? 'Missing' : '';
            const hasDetails = value.family_feedback || value.private_note || Object.keys(value.rubric_scores).length;
            details.textContent = tag ? `${tag} · Details` : hasDetails ? 'View details' : 'Details';
            details.setAttribute('aria-label', `${details.textContent} for ${context}`);
        }
        function showMark(value) {
            waiver.checked = value.state === 'excused';
            waiverLabel.classList.toggle('gradebook-waived', waiver.checked);
            waiverText.textContent = waiver.checked ? 'Waived' : 'Waive';
            scoreInput.disabled = locked || waiver.checked;
            scoreInput.value = value.score ?? '';
            labelDetails(value);
        }
        showMark(mark);
        waiver.onchange = () => {
            const current = marks.get(key) || emptyMark(enrollment, assignment);
            const { state, score, rubric_scores } = current;
            let next = { state: 'excused', score: null, rubric_scores: {} };
            if (waiver.checked) {
                scoresBeforeWaiver.set(key, { state, score, rubric_scores });
            } else {
                next = scoresBeforeWaiver.get(key) || { state: 'ungraded', score: null, rubric_scores: {} };
                scoresBeforeWaiver.delete(key);
            }
            updateMark(enrollment, assignment, next, cell);
            showMark(marks.get(key));
        };
        details.onclick = () => openScoreDetails(enrollment, assignment, cell);
        scoreInput.addEventListener('input', () => {
            const filled = scoreInput.value !== '' || scoreInput.validity.badInput;
            const next = { state: filled ? 'scored' : 'ungraded',
                score: Number.isFinite(scoreInput.valueAsNumber) ? scoreInput.valueAsNumber : null, rubric_scores: {} };
            updateMark(enrollment, assignment, next, cell);
            labelDetails(marks.get(key));
        });
        const controls = document.createElement('div');
        controls.className = 'gradebook-score-controls';
        controls.append(scoreInput, waiverLabel, details);
        cell.append(controls);
        if (dirty.has(key)) cell.dataset.dirty = '';
    }

    function renderGrid() {
        grid.replaceChildren();
        gradeDisplays.clear();
        updateSaveBar();
        updateAssignmentSummary();
        const isAssignmentView = view.value === 'assignment';
        const showGrades = !isAssignmentView;
        const fullGradebook = view.value === 'grid';
        const visible = isAssignmentView ? assignments.filter(item => item.id === scoringAssignment.value)
            : fullGradebook ? assignments : [];
        const rosterTitle = byId('roster-title');
        rosterTitle.textContent = isAssignmentView ? (visible[0]?.title || 'Enter scores')
            : view.value === 'grades' ? 'Review course grades' : 'Full gradebook';
        for (const [id, button] of assignmentButtons) {
            if (isAssignmentView && id === scoringAssignment.value) button.setAttribute('aria-current', 'true');
            else button.removeAttribute('aria-current');
        }
        byId('gradebook-scoring-assignment-label').hidden = !isAssignmentView || !assignments.length;
        byId('gradebook-student-filter-label').hidden = !fullGradebook;
        byId('gradebook-add-assignment').hidden = !isAssignmentView;
        grid.classList.toggle('gradebook-overview', fullGradebook);
        const rules = byId('gradebook-rules');
        rules.hidden = isAssignmentView && !visible.length;
        const ruleText = course.weighting === 'weighted'
            ? `Weighted categories · ${Object.entries(course.categories).map(([name, weight]) => `${name} ${weight}%`).join(', ')}.`
            : 'Total points.';
        rules.textContent = isAssignmentView ? 'Waived work is excluded from the course grade.'
            : `${ruleText} Missing work ${course.missing_is_zero ? 'counts as zero' : 'is excluded'}. Waived work is excluded.`;
        if (!enrollments.length) {
            appendTextElement(grid, 'p', managesRoster
                ? 'Add students in Manage roster to start scoring.'
                : 'No students are enrolled. Ask a portal administrator to update your roster.');
            return;
        }
        if (isAssignmentView && !visible.length) {
            appendTextElement(grid, 'p', 'Add your first assignment to start entering scores.');
            return;
        }
        const roster = visibleEnrollments(fullGradebook);
        if (!roster.length) {
            appendTextElement(grid, 'p', 'No students match your search.');
            return;
        }
        const table = document.createElement('table');
        const head = table.createTHead().insertRow();
        const studentHeading = appendTextElement(head, 'th', '');
        studentHeading.scope = 'col';
        studentHeading.setAttribute('aria-sort', studentsAscending ? 'ascending' : 'descending');
        const sort = appendTextElement(studentHeading, 'button', studentsAscending ? 'Student · A–Z' : 'Student · Z–A', 'gradebook-table-action');
        sort.type = 'button';
        sort.setAttribute('aria-label', studentsAscending ? 'Student, sort last name Z to A' : 'Student, sort last name A to Z');
        sort.onclick = () => {
            studentsAscending = !studentsAscending;
            renderGrid();
            grid.querySelector('thead th:first-child button')?.focus();
        };
        if (showGrades) appendTextElement(head, 'th', 'Course grade').scope = 'col';
        for (const assignment of visible) {
            const title = isAssignmentView ? 'Points' : assignment.title;
            const heading = appendTextElement(head, 'th', fullGradebook ? '' : title);
            heading.scope = 'col';
            if (fullGradebook) {
                const edit = appendTextElement(heading, 'button', title, 'gradebook-table-action');
                edit.type = 'button';
                edit.setAttribute('aria-label', `Enter scores for ${title}`);
                edit.onclick = () => openAssignment(assignment.id);
                appendTextElement(heading, 'small', `${assignment.points} pts`);
            }
        }
        const body = table.createTBody();
        for (const enrollment of roster) {
            const row = body.insertRow();
            appendTextElement(row, 'th', studentName(enrollment)).scope = 'row';
            if (showGrades) {
                const gradeCell = row.insertCell();
                gradeDisplays.set(enrollment.id, appendTextElement(gradeCell, 'p', ''));
                updateRunningGrade(enrollment);
                if (!fullGradebook) {
                    const review = appendTextElement(gradeCell, 'button', finals.has(enrollment.id) ? 'View final grade' : 'Review grade');
                    review.type = 'button';
                    review.className = 'gradebook-secondary';
                    review.setAttribute('aria-label', `${review.textContent} for ${studentName(enrollment)}`);
                    review.onclick = () => reviewGrade(enrollment);
                    if (managesRoster && !finals.has(enrollment.id)) {
                        const edit = appendTextElement(gradeCell, 'button', 'Edit enrollment');
                        edit.type = 'button';
                        edit.className = 'gradebook-secondary';
                        edit.setAttribute('aria-label', `Edit enrollment for ${studentName(enrollment)}`);
                        edit.onclick = () => { if (requireSavedScores()) renderEnrollmentForm(enrollment); };
                    }
                }
            }
            for (const assignment of visible) {
                if (!fullGradebook) {
                    renderScoreCell(row, enrollment, assignment);
                    continue;
                }
                const key = markKey(enrollment.id, assignment.id);
                const mark = marks.get(key);
                const text = mark?.state === 'scored' ? (mark.score ?? 'Invalid score')
                    : { missing: 'Missing', excused: 'Waived' }[mark?.state] || '—';
                const cell = row.insertCell();
                cell.textContent = text;
                if (mark?.state === 'excused') cell.classList.add('gradebook-waived');
                if (dirty.has(key)) cell.dataset.dirty = '';
            }
        }
        grid.appendChild(table);
    }

    function openScoreDetails(enrollment, assignment, cell) {
        const mark = marks.get(markKey(enrollment.id, assignment.id)) || emptyMark(enrollment, assignment);
        const locked = finals.has(enrollment.id);
        const form = scoreForm;
        form.reset();
        const rubric = byId('gradebook-rubric');
        rubric.replaceChildren();
        byId('gradebook-score-heading').textContent = `${studentName(enrollment)} · ${assignment.title} · ${assignment.points} points`;
        byId('gradebook-score-status').textContent = '';
        form.elements.state.value = mark.state;
        form.elements.state.disabled = locked;
        form.elements.score.value = mark.score ?? '';
        form.elements.score.max = assignment.points;
        form.elements.score.readOnly = locked;
        for (const [criterion, max] of Object.entries(assignment.rubric)) {
            const label = appendTextElement(rubric, 'label', `${criterion} (out of ${max})`);
            const input = document.createElement('input');
            input.type = 'number';
            input.dataset.criterion = criterion;
            input.min = '0';
            input.max = max;
            input.step = '.01';
            input.value = mark.rubric_scores[criterion] ?? '';
            input.disabled = locked;
            label.appendChild(input);
        }
        form.elements.family_feedback.value = mark.family_feedback;
        form.elements.private_note.value = mark.private_note;
        form.elements.family_feedback.readOnly = locked;
        form.elements.private_note.readOnly = locked;
        form.querySelector('[value="apply"]').hidden = locked;
        scoreContext = { enrollment, assignment, cell, locked, manualScore: mark.score ?? '' };
        updateDialogScoring();
        scoreDialog.returnValue = '';
        scoreDialog.showModal();
    }

    function updateDialogScoring() {
        const scoring = scoreForm.elements.state.value === 'scored';
        const rubricInputs = [...scoreDialog.querySelectorAll('[data-criterion]')];
        const filled = rubricInputs.filter(input => input.value !== '');
        for (const input of rubricInputs) input.disabled = !scoring || scoreContext.locked;
        const points = scoreForm.elements.score;
        points.disabled = !scoring;
        points.readOnly = scoreContext.locked || filled.length > 0;
        if (!scoring) return;
        if (!filled.length) points.value = scoreContext.manualScore;
        else if (filled.length === rubricInputs.length) {
            points.value = (filled.reduce((total, input) => total + Number(input.value), 0)).toFixed(2);
        } else {
            points.value = '';
        }
    }

    async function reviewGrade(enrollment) {
        if (!requireSavedScores()) return;
        await run(async () => {
            const [calculated, history] = await Promise.all([
                portalClient.rpc('gradebook_calculate', { target_enrollment: enrollment.id }).single(),
                portalClient.from('gradebook_history').select('action, reason, recorded_at, details')
                    .eq('enrollment_id', enrollment.id).order('recorded_at', { ascending: false })
            ]);
            const result = data(calculated);
            const finalized = finals.get(enrollment.id);
            const form = finalDialog.querySelector('form');
            form.reset();
            form.elements.override.replaceChildren();
            option(form.elements.override, 'Use calculated grade', '');
            for (const grade of Object.keys(course.scale)) option(form.elements.override, grade, grade);
            byId('gradebook-final-summary').textContent = [
                studentName(enrollment),
                finalized ? `Finalized as ${finalized.final_grade}` :
                    result.percent == null ? 'No countable score' : `${result.percent}% · ${result.letter}`,
                finalized && Number(finalized.credits) ? `${finalized.credits} credits earned` :
                    !finalized && Number(enrollment.credits) ? `${enrollment.credits} maximum credits` : '',
                !finalized && Number(result.unresolved) ? `${result.unresolved} ungraded assignments` : ''
            ].filter(Boolean).join(' · ');
            const breakdown = byId('gradebook-grade-breakdown');
            breakdown.replaceChildren();
            const preview = calculateGradebookPreview(course, assignments, id => marks.get(markKey(enrollment.id, id)));
            for (const [category, score] of preview.totals) {
                appendTextElement(breakdown, 'li', `${category}: ${Math.round(score.earned * 100) / 100} of ${Math.round(score.possible * 100) / 100} points`);
            }
            breakdown.hidden = !breakdown.childElementCount;
            byId('gradebook-override-label').hidden = Boolean(finalized);
            const availableCredits = Number(enrollment.credits);
            byId('gradebook-earned-label').hidden = Boolean(finalized) || !availableCredits;
            form.elements.earned_credits.disabled = Boolean(finalized) || !availableCredits;
            form.elements.earned_credits.max = availableCredits;
            form.elements.earned_credits.value = availableCredits ? '' : '0';
            byId('gradebook-final-options').open = Boolean(finalized);
            byId('gradebook-final-options-title').textContent = finalized ? 'Reason for reopening' : 'Override grade';
            const confirm = byId('gradebook-confirm');
            confirm.textContent = finalized ? 'Reopen grade' : 'Finalize grade';
            confirm.disabled = !finalized && (result.percent == null || Number(result.unresolved) !== 0);
            form.elements.reason.required = Boolean(finalized);
            form.elements.override.onchange = () => { form.elements.reason.required = Boolean(form.elements.override.value); };
            const historyList = byId('gradebook-history');
            historyList.replaceChildren();
            for (const change of data(history)) {
                appendTextElement(historyList, 'li', [formatPortalDate(change.recorded_at), change.action, change.details.final_grade, change.reason].filter(Boolean).join(' · '));
            }
            if (!historyList.childElementCount) appendTextElement(historyList, 'li', 'No recorded changes.');
            finalContext = { enrollment, finalized };
            finalDialog.returnValue = '';
            finalDialog.showModal();
        });
    }

    try {
        const session = await getPortalSession();
        const profile = await getPortalProfile(session);
        if (!profile?.active || !['admin', 'teacher'].includes(profile.role)) {
            byId('gradebook-login').hidden = Boolean(session);
            message(session ? 'Teacher or administrator access is required.' : 'Sign in to open the teacher gradebook.');
            return;
        }

        const signOut = document.querySelector('[data-portal-sign-out]');
        signOut.hidden = false;
        portalClient.auth.onAuthStateChange((_event, nextSession) => {
            if (nextSession?.user?.id === session.user.id) return;
            panel.hidden = true;
            dirty.clear();
            scoresBeforeWaiver.clear();
            marks.clear();
            googleImport?.configure(null, []);
            scoreDialog.close();
            finalDialog.close();
            deleteDialog.close();
            location.replace('family-portal.html');
        });
        students = await loadPlannerStudents();
        managesRoster = profile.role === 'admin';
        if (managesRoster) {
            byId('gradebook-roster-management').hidden = false;
            const teachers = data(await portalClient.from('portal_users').select('id, display_name').in('role', ['admin', 'teacher']).eq('active', true).order('display_name'));
            const field = settings.elements.teacher_id;
            option(field, 'My account', '');
            for (const teacher of teachers) option(field, teacher.display_name, teacher.id);
            byId('gradebook-teacher-label').hidden = false;
        }

        courseSelect.onchange = () => {
            if (!requireSavedScores()) {
                courseSelect.value = course?.id || '';
                return;
            }
            const requested = courseSelect.value;
            run(async () => {
                try { await loadCourse(requested); }
                finally { courseSelect.value = course?.id || ''; }
            });
        };
        byId('gradebook-new-course').onclick = () => {
            if (!requireSavedScores()) return;
            course = null;
            googleImport?.configure(null, []);
            courseSelect.value = '';
            workspace.hidden = true;
            renderSettings(null);
            settings.elements.name.focus();
            message('Enter the course name and term. Review the grading rules before saving.');
        };

        settings.addEventListener('input', updateRuleSummary);
        settings.addEventListener('invalid', event => {
            if (event.target.closest('#gradebook-grading-options')) byId('gradebook-grading-options').open = true;
        }, true);
        settings.onsubmit = event => {
            event.preventDefault();
            if (!requireSavedScores()) return;
            run(async () => {
                const values = Object.fromEntries(new FormData(settings));
                let gradingRules;
                try {
                    gradingRules = {
                        categories: parseGradebookLines(values.categories, { requiredNumbers: values.weighting === 'weighted' }),
                        scale: parseGradebookLines(values.scale)
                    };
                } catch (error) {
                    byId('gradebook-grading-options').open = true;
                    throw error;
                }
                const record = {
                    name: values.name.trim(), term: values.term.trim(), weighting: values.weighting,
                    missing_is_zero: values.missing_is_zero === 'true',
                    ...gradingRules
                };
                if (profile.role === 'admin') record.teacher_id = values.teacher_id || profile.id;
                const table = portalClient.from('gradebook_courses');
                const request = course ? table.update(record).eq('id', course.id) : table.insert(record);
                const saved = data(await request.select('id').single());
                await refreshCourses(saved.id);
                message('Course settings saved.', 'success');
            }, 'save course settings', 'Review the course name, grading scale and categories. Leave the entered settings in place while you correct them.');
        };

        deleteCourse.onclick = () => {
            if (!managesRoster || !course || !requireSavedScores()) return;
            deleteForm.reset();
            deleteStatus.hidden = true;
            byId('gradebook-delete-course-name').textContent = `${course.name} · ${course.term}`;
            deleteDialog.showModal();
        };
        deleteForm.elements.cancel.onclick = () => deleteDialog.close();
        deleteDialog.addEventListener('cancel', event => {
            if (busy) event.preventDefault();
        });
        deleteForm.onsubmit = event => {
            event.preventDefault();
            if (!managesRoster || !course || deleteForm.elements.confirmation.value !== 'DELETE') return;
            const courseId = course.id;
            run(async () => {
                const { cancel, confirmation, confirm } = deleteForm.elements;
                cancel.disabled = confirm.disabled = true;
                confirmation.readOnly = true;
                deleteStatus.hidden = false;
                setPortalMessage(deleteStatus, 'Deleting class…');
                try {
                    data(await portalClient.rpc('portal_delete_course', { target_course: courseId }));
                } catch (error) {
                    const text = ['PGRST202', '42883'].includes(error.code)
                        ? 'Class deletion requires the Supabase course deletion migration.'
                        : portalActionMessage(error, 'delete this class', 'Reload the gradebook to check whether the class still appears.');
                    setPortalMessage(deleteStatus, text, 'error');
                    return confirmation;
                } finally {
                    cancel.disabled = confirm.disabled = false;
                    confirmation.readOnly = false;
                }
                deleteDialog.close();
                courses = courses.filter(item => item.id !== courseId);
                for (const item of courseSelect.options) {
                    if (item.value === courseId) {
                        item.remove();
                        break;
                    }
                }
                courseSelect.value = '';
                await loadCourse('');
                try {
                    await refreshCourses();
                    message('Class deleted.', 'success');
                } catch {
                    message('Class deleted. Reload the gradebook if the remaining classes do not appear.', 'success');
                }
                return courseSelect;
            });
        };

        option(enrollmentForm.elements.requirement_key, 'No graduation requirement', '');
        for (const requirement of GRADUATION_REQUIREMENTS.filter(item => !item.category)) {
            option(enrollmentForm.elements.requirement_key, requirement.label, requirement.key);
        }
        option(enrollmentForm.elements.grade_level, 'Select a grade year', '');
        for (const grade of GRADEBOOK_GRADE_LEVELS) {
            option(enrollmentForm.elements.grade_level, grade === 'K' ? 'Kindergarten' : `Grade ${grade}`, grade);
        }
        enrollmentForm.elements.grade_level.onchange = updateEnrollmentCredits;
        enrollmentForm.elements.requirement_key.onchange = updateEnrollmentCredits;
        enrollmentForm.elements.student_id.onchange = () => {
            const id = enrollmentForm.elements.student_id.value;
            const enrollment = enrollments.find(item => item.student_id === id);
            const student = students.find(record => record.id === id);
            fillEnrollmentSettings(enrollment, student);
        };
        byId('gradebook-enrollment-cancel').onclick = () => renderEnrollmentForm();
        enrollmentForm.onsubmit = event => {
            event.preventDefault();
            if (!managesRoster || !requireSavedScores()) return;
            run(async () => {
                const { student_id, ...values } = Object.fromEntries(new FormData(enrollmentForm));
                values.requirement_key = values.requirement_key || null;
                const table = portalClient.from('gradebook_enrollments');
                const editing = Boolean(editingEnrollment);
                data(await (editing ? table.update(values).eq('id', editingEnrollment.id)
                    : table.insert({ ...values, student_id, course_id: course.id })));
                await loadCourse(course.id);
                const saved = enrollments.find(item => item.student_id === student_id && !finals.has(item.id));
                if (saved) {
                    enrollmentForm.elements.student_id.value = saved.student_id;
                    fillEnrollmentSettings(saved);
                }
                message(editing ? 'Student settings saved.' : 'Student added to roster.', 'success');
                return enrollmentForm.elements.student_id;
            }, 'save the enrollment', 'Check the chosen student and course. If the student is already on this roster, edit the existing enrollment.');
        };

        view.onchange = renderGrid;
        studentFilter.oninput = renderGrid;
        scoringAssignment.onchange = renderGrid;
        byId('gradebook-add-assignment').onclick = () => {
            if (!requireSavedScores()) return;
            assignmentPanel.open = true;
            assignmentForm.elements.assignment_id.value = '';
            loadAssignmentForm();
            assignmentForm.elements.title.focus();
        };
        assignmentForm.elements.assignment_id.onchange = loadAssignmentForm;
        let sourceAssignments = [];
        byId('gradebook-copy-course').onchange = event => run(async () => {
            const list = byId('gradebook-copy-assignment');
            list.replaceChildren();
            option(list, 'Select an assignment', '');
            sourceAssignments = event.target.value
                ? data(await portalClient.from('gradebook_assignments').select('id, title, category, points, rubric').eq('course_id', event.target.value).order('title'))
                : [];
            list.disabled = !sourceAssignments.length;
            for (const item of sourceAssignments) option(list, item.title, item.id);
        });
        byId('gradebook-copy-assignment').onchange = event => {
            const source = sourceAssignments.find(item => item.id === event.target.value);
            if (!source) return;
            const fields = assignmentForm.elements;
            fields.assignment_id.value = '';
            fields.title.value = source.title;
            fields.category.value = Object.hasOwn(course.categories, source.category) ? source.category : Object.keys(course.categories)[0];
            fields.due_on.value = '';
            fields.points.value = source.points;
            fields.rubric.value = formatGradebookLines(source.rubric);
            byId('gradebook-duplicate-assignment').disabled = true;
            fields.title.focus();
        };
        byId('gradebook-duplicate-assignment').onclick = () => {
            if (!assignmentForm.elements.assignment_id.value) return;
            assignmentForm.elements.assignment_id.value = '';
            assignmentForm.elements.title.value = `${assignmentForm.elements.title.value} copy`.slice(0, 120);
            assignmentForm.elements.due_on.value = '';
            byId('gradebook-duplicate-assignment').disabled = true;
            assignmentForm.elements.title.focus();
        };
        assignmentForm.onsubmit = event => {
            event.preventDefault();
            if (!requireSavedScores()) return;
            run(async () => {
                const { assignment_id, ...values } = Object.fromEntries(new FormData(assignmentForm));
                const record = {
                    ...values, course_id: course.id, due_on: values.due_on || null,
                    rubric: parseGradebookLines(values.rubric)
                };
                const table = portalClient.from('gradebook_assignments');
                const { course_id, ...updates } = record;
                const saved = data(await (assignment_id ? table.update(updates).eq('id', assignment_id) : table.insert(record))
                    .select('id').single());
                view.value = 'assignment';
                await loadCourse(course.id, saved.id);
                message('Assignment saved. Select a student’s score to start grading.', 'success');
                return assignmentFocusTarget();
            }, 'save the assignment', 'Check the assignment name, category, points and rubric. Confirm that the course is still assigned to you.');
        };

        const scoreColumn = target => [...grid.querySelectorAll('input[data-score-column]')]
            .filter(input => input.dataset.scoreColumn === target.dataset.scoreColumn);
        grid.onkeydown = event => {
            const target = event.target.closest('input[data-score-column]');
            if (!target || event.key !== 'Enter') return;
            event.preventDefault();
            const column = scoreColumn(target);
            const next = column.slice(column.indexOf(target) + 1).find(input => !input.disabled);
            next?.focus();
            next?.select();
        };
        grid.onpaste = event => {
            const target = event.target.closest('input[data-score-column]');
            if (!target) return;
            const raw = event.clipboardData.getData('text').trim();
            if (!raw.includes('\n')) return;
            event.preventDefault();
            const scores = raw.split(/\r?\n/).map(score => score.trim());
            const column = scoreColumn(target);
            const destination = column.slice(column.indexOf(target), column.indexOf(target) + scores.length);
            if (destination.length !== scores.length || destination.some((input, index) => input.disabled ||
                !/^\d+(\.\d{1,2})?$/.test(scores[index]) || Number(scores[index]) > Number(input.max))) {
                message('Paste one valid numeric score per student. Make sure every destination row is editable.', 'error');
                return;
            }
            destination.forEach((input, index) => {
                input.value = scores[index];
                input.dispatchEvent(new Event('input'));
            });
        };

        scoreForm.addEventListener('input', event => {
            if (event.target.name === 'score') scoreContext.manualScore = event.target.value;
            else if (event.target.name === 'state' || event.target.hasAttribute('data-criterion')) updateDialogScoring();
        });
        scoreForm.addEventListener('submit', event => {
            if (event.submitter?.value !== 'apply') return;
            event.preventDefault();
            const { enrollment, assignment, cell } = scoreContext;
            const fields = scoreForm.elements;
            const state = fields.state.value;
            const rubricInputs = [...scoreDialog.querySelectorAll('[data-criterion]:enabled')];
            const completed = rubricInputs.filter(input => input.value !== '');
            if (completed.length && completed.length !== rubricInputs.length) {
                byId('gradebook-score-status').textContent = 'Enter every rubric score or clear them all.';
                rubricInputs.find(input => input.value === '')?.focus();
                return;
            }
            if (state === 'scored' && !Number.isFinite(fields.score.valueAsNumber)) {
                byId('gradebook-score-status').textContent = 'Enter points or choose a different work status.';
                fields.score.focus();
                return;
            }
            const changes = {
                state,
                score: state === 'scored' ? fields.score.valueAsNumber : null,
                rubric_scores: Object.fromEntries(completed.map(input => [input.dataset.criterion, Number(input.value)])),
                family_feedback: fields.family_feedback.value.trim(),
                private_note: fields.private_note.value.trim()
            };
            const previous = marks.get(markKey(enrollment.id, assignment.id)) || emptyMark(enrollment, assignment);
            scoreDialog.close();
            if (Object.keys(changes).every(key => JSON.stringify(changes[key]) === JSON.stringify(previous[key]))) return;
            const key = markKey(enrollment.id, assignment.id);
            if (changes.state !== previous.state) {
                if (changes.state === 'excused') {
                    scoresBeforeWaiver.set(key, { state: previous.state, score: previous.score, rubric_scores: previous.rubric_scores });
                } else {
                    scoresBeforeWaiver.delete(key);
                }
            }
            updateMark(enrollment, assignment, changes, cell);
            renderGrid();
            [...grid.querySelectorAll('[data-mark]')].find(button => button.dataset.mark === key)?.focus();
        });

        save.onclick = () => run(async () => {
            const changed = [...dirty].map(key => marks.get(key));
            const invalid = changed.find(mark => mark.state === 'scored'
                && !validGradebookScore(mark.score, assignments.find(item => item.id === mark.assignment_id).points));
            if (invalid) {
                const assignment = assignments.find(item => item.id === invalid.assignment_id);
                const enrollment = enrollments.find(item => item.id === invalid.enrollment_id);
                scoringAssignment.value = assignment.id;
                view.value = 'assignment';
                renderGrid();
                message(`${studentName(enrollment)} · ${assignment.title}. Enter a score from 0 to ${assignment.points}, with up to two decimal places.`, 'error');
                return [...grid.querySelectorAll('[data-mark]')]
                    .find(button => button.dataset.mark === markKey(enrollment.id, assignment.id))
                    ?.parentElement.querySelector('input');
            }
            if (changed.length) data(await portalClient.rpc('gradebook_save_marks', { target_course: course.id, changes: changed }));
            dirty.clear();
            scoresBeforeWaiver.clear();
            try {
                await loadCourse(course.id);
            } catch {
                renderGrid();
                message('Changes were saved. Reload the course before making more edits.', 'error');
                grid.inert = true;
                return;
            }
            grid.inert = false;
            message('Changes saved.', 'success');
            return assignmentFocusTarget();
        }, 'save the scores', 'Check the score ranges and roster. A finalized grade must be reopened before you edit its scores.');

        byId('gradebook-discard').onclick = () => run(async () => {
            if (!window.confirm('Discard all unsaved changes in this course?')) return;
            await loadCourse(course.id);
            message('Unsaved changes discarded.');
            return assignmentFocusTarget();
        });

        finalDialog.onclose = () => {
            if (finalDialog.returnValue !== 'confirm') return;
            run(async () => {
                const fields = finalDialog.querySelector('form').elements;
                const { enrollment, finalized } = finalContext;
                const reason = fields.reason.value.trim() || null;
                const payload = { target_enrollment: enrollment.id, reason };
                if (!finalized) {
                    payload.override_grade = fields.override.value || null;
                    payload.earned_credits = Number(fields.earned_credits.value);
                }
                data(await portalClient.rpc(finalized ? 'gradebook_reopen' : 'gradebook_finalize', payload));
                await loadCourse(course.id);
                const transcriptCourse = enrollment.requirement_key && GRADUATION_GRADES.includes(enrollment.grade_level);
                const result = finalized
                    ? (transcriptCourse ? 'Grade reopened. Finalize it again to restore it to the planner.' : 'Grade reopened.')
                    : (transcriptCourse ? 'Grade finalized and added to the planner and transcript.' : 'Grade finalized.');
                message(result, 'success');
            }, 'update the final grade', 'Review the enrollment, earned credits and reason before submitting again.');
        };

        window.addEventListener('beforeunload', event => {
            if (!dirty.size) return;
            event.preventDefault();
            event.returnValue = '';
        });
        panel.hidden = false;
        await run(() => refreshCourses());
    } catch (error) {
        message(portalActionMessage(error, 'load the gradebook', 'Confirm that you have an active administrator or teacher login and that an administrator assigned your classroom.'), 'error');
    }
}

document.addEventListener('DOMContentLoaded', initTeacherGradebook);
