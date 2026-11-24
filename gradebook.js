/* global portalClient, getPortalSession, getPortalProfile,
    appendTextElement, setPortalMessage, normalizeStudentName, loadPlannerStudents,
    GRADUATION_GRADES, GRADUATION_REQUIREMENTS, formatPortalDate, portalActionMessage */

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

function calculateGradebookPreview(course, assignments, scoreFor) {
    const totals = new Map();
    let unresolved = 0;
    for (const assignment of assignments) {
        const mark = scoreFor(assignment.id);
        if (!mark || mark.state === 'ungraded' ||
            (mark.state === 'scored' && (mark.score === null || mark.score > Number(assignment.points)))) {
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
    const enrollmentForm = byId('gradebook-enroll');
    const assignmentForm = byId('gradebook-assignment');
    const scoreDialog = byId('gradebook-score-dialog');
    const finalDialog = byId('gradebook-final-dialog');
    const grid = byId('gradebook-grid');
    const save = byId('gradebook-save');
    const marks = new Map();
    const dirty = new Set();
    const gradeDisplays = new Map();
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
        try {
            await work();
        } catch (error) {
            message(error.code || error.status ? portalActionMessage(error, action, next)
                : error.message || `We couldn’t ${action}. ${next}`, 'error');
        } finally {
            busy = false;
            panel.inert = false;
        }
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
        settings.elements.name.value = record?.name || '';
        settings.elements.term.value = record?.term || '';
        settings.elements.teacher_id.value = record?.teacher_id || '';
        settings.elements.weighting.value = record?.weighting || 'points';
        settings.elements.missing_is_zero.value = String(record?.missing_is_zero ?? true);
        settings.elements.categories.value = record ? formatGradebookLines(record.categories, record.weighting === 'weighted') : 'General';
        settings.elements.scale.value = record ? formatGradebookLines(record.scale) : '';
        settings.elements.scale.placeholder = 'A=90\nB=80\nC=70\nD=60\nF=0';
    }

    function loadAssignmentForm() {
        const fields = assignmentForm.elements;
        const assignment = assignments.find(record => record.id === fields.assignment_id.value);
        fields.title.value = assignment?.title || '';
        fields.category.value = assignment?.category || Object.keys(course.categories)[0];
        fields.due_on.value = assignment?.due_on || '';
        fields.points.value = assignment?.points ?? '';
        fields.rubric.value = assignment ? formatGradebookLines(assignment.rubric) : '';
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

    async function loadCourse(id) {
        workspace.hidden = true;
        settingsPanel.hidden = true;
        course = courses.find(item => item.id === id);
        if (!course) {
            message('Create a course to start a gradebook.');
            return;
        }

        const [roster, tasks, savedMarks, finalized] = await Promise.all([
            portalClient.from('gradebook_enrollments').select('*').eq('course_id', id),
            portalClient.from('gradebook_assignments').select('*').eq('course_id', id).order('due_on').order('title'),
            loadSavedMarks(id),
            portalClient.from('gradebook_final_courses').select('*').eq('course_id', id)
        ]);

        enrollments = data(roster).sort((first, second) => studentName(first).localeCompare(studentName(second)));
        assignments = data(tasks);
        finals = new Map(data(finalized).map(item => [item.enrollment_id, item]));
        marks.clear();
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
        renderGrid();
        message(`${course.name} · ${course.term}`);
    }

    function studentName(enrollment) {
        return normalizeStudentName(students.find(student => student.id === enrollment.student_id) || {});
    }

    function renderEnrollmentForm(enrollment) {
        editingEnrollment = enrollment;
        enrollmentForm.reset();
        const fields = enrollmentForm.elements;
        fields.student_id.replaceChildren();
        option(fields.student_id, 'Select a student', '');
        for (const student of students.filter(student => student.id === enrollment?.student_id
            || !enrollments.some(item => item.student_id === student.id))) {
            option(fields.student_id, normalizeStudentName(student), student.id);
        }
        fields.student_id.value = enrollment?.student_id || '';
        fields.student_id.disabled = Boolean(enrollment);
        fields.requirement_key.value = enrollment?.requirement_key || '';
        fields.grade_level.value = enrollment?.grade_level || '';
        fields.credits.value = enrollment?.credits ?? '';
        updateEnrollmentCredits();
        byId('gradebook-enrollment-submit').textContent = enrollment ? 'Save enrollment' : 'Add to roster';
        byId('gradebook-enrollment-cancel').hidden = !enrollment;
        if (enrollment) {
            enrollmentForm.closest('details').open = true;
            fields.requirement_key.focus();
        }
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
        save.disabled = false;
        byId('gradebook-discard').disabled = false;
        updateRunningGrade(enrollment);
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

    function renderScoreCell(row, enrollment, assignment, column) {
        const cell = row.insertCell();
        const mark = marks.get(markKey(enrollment.id, assignment.id)) || emptyMark(enrollment, assignment);
        const locked = finals.has(enrollment.id);
        const context = `${studentName(enrollment)}, ${assignment.title}`;
        const stateInput = document.createElement('select');
        stateInput.setAttribute('aria-label', `Status for ${context}`);
        for (const [state, label] of [['ungraded', 'Ungraded'], ['scored', 'Scored'], ['missing', 'Missing'], ['excused', 'Excused']]) {
            option(stateInput, label, state);
        }
        stateInput.value = mark.state;
        stateInput.disabled = locked;
        const scoreInput = document.createElement('input');
        scoreInput.type = 'number';
        scoreInput.min = '0';
        scoreInput.max = assignment.points;
        scoreInput.step = '.01';
        scoreInput.value = mark.score ?? '';
        scoreInput.setAttribute('aria-label', `Points for ${context}`);
        scoreInput.dataset.scoreColumn = String(column);
        scoreInput.disabled = locked;
        scoreInput.addEventListener('input', () => {
            stateInput.value = scoreInput.value === '' ? 'ungraded' : 'scored';
            updateMark(enrollment, assignment, {
                state: stateInput.value, score: scoreInput.value === '' ? null : Number(scoreInput.value), rubric_scores: {}
            }, cell);
        });
        stateInput.addEventListener('change', () => {
            if (stateInput.value !== 'scored') scoreInput.value = '';
            updateMark(enrollment, assignment, {
                state: stateInput.value, score: scoreInput.value === '' ? null : Number(scoreInput.value), rubric_scores: {}
            }, cell);
        });
        const details = document.createElement('button');
        details.type = 'button';
        details.textContent = 'Details';
        details.setAttribute('aria-label', `Details for ${context}`);
        details.onclick = () => openScoreDetails(enrollment, assignment, cell);
        cell.append(stateInput, scoreInput, details);
        if (dirty.has(markKey(enrollment.id, assignment.id))) cell.dataset.dirty = '';
    }

    function renderGrid() {
        grid.replaceChildren();
        gradeDisplays.clear();
        save.disabled = !dirty.size;
        byId('gradebook-discard').disabled = !dirty.size;
        const ruleText = course.weighting === 'weighted'
            ? `Weighted categories · ${Object.entries(course.categories).map(([name, weight]) => `${name} ${weight}%`).join(', ')}. Categories with no countable work are omitted from the running grade.`
            : 'Total points.';
        byId('gradebook-rules').textContent = `${ruleText} Missing work ${course.missing_is_zero ? 'counts as zero' : 'is excluded'}. Excused work is excluded.`;
        if (!enrollments.length) {
            appendTextElement(grid, 'p', managesRoster
                ? 'Add students to start scoring this course.'
                : 'No students are enrolled. Ask a portal administrator to update your roster.');
            return;
        }
        const table = document.createElement('table');
        const head = table.createTHead().insertRow();
        appendTextElement(head, 'th', 'Student').scope = 'col';
        appendTextElement(head, 'th', 'Course grade').scope = 'col';
        for (const assignment of assignments) {
            const heading = appendTextElement(head, 'th', assignment.title);
            heading.scope = 'col';
            appendTextElement(heading, 'small', ` · ${assignment.points} pts`);
        }
        const body = table.createTBody();
        for (const enrollment of enrollments) {
            const row = body.insertRow();
            appendTextElement(row, 'th', studentName(enrollment)).scope = 'row';
            const gradeCell = row.insertCell();
            gradeDisplays.set(enrollment.id, appendTextElement(gradeCell, 'p', ''));
            updateRunningGrade(enrollment);
            const review = appendTextElement(gradeCell, 'button', finals.has(enrollment.id) ? 'View final grade' : 'Review grade');
            review.type = 'button';
            review.setAttribute('aria-label', `${review.textContent} for ${studentName(enrollment)}`);
            review.onclick = () => reviewGrade(enrollment);
            if (managesRoster && !finals.has(enrollment.id)) {
                const edit = appendTextElement(gradeCell, 'button', 'Edit enrollment');
                edit.type = 'button';
                edit.setAttribute('aria-label', `Edit enrollment for ${studentName(enrollment)}`);
                edit.onclick = () => { if (requireSavedScores()) renderEnrollmentForm(enrollment); };
            }
            assignments.forEach((assignment, column) => renderScoreCell(row, enrollment, assignment, column));
        }
        grid.appendChild(table);
    }

    function openScoreDetails(enrollment, assignment, cell) {
        const mark = marks.get(markKey(enrollment.id, assignment.id)) || emptyMark(enrollment, assignment);
        const locked = finals.has(enrollment.id);
        const form = scoreDialog.querySelector('form');
        const rubric = byId('gradebook-rubric');
        rubric.replaceChildren();
        byId('gradebook-score-heading').textContent = `${studentName(enrollment)} · ${assignment.title}`;
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
        scoreContext = { enrollment, assignment, cell, mark };
        scoreDialog.returnValue = '';
        scoreDialog.showModal();
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
                finalized ? `${finalized.credits} credits earned` : `${enrollment.credits} maximum credits`,
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
            byId('gradebook-earned-label').hidden = Boolean(finalized);
            form.elements.earned_credits.disabled = Boolean(finalized);
            form.elements.earned_credits.max = enrollment.credits;
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
            scoreDialog.close();
            finalDialog.close();
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
            run(() => loadCourse(courseSelect.value));
        };
        byId('gradebook-new-course').onclick = () => {
            if (!requireSavedScores()) return;
            course = null;
            courseSelect.value = '';
            workspace.hidden = true;
            renderSettings(null);
            settings.elements.name.focus();
            message('Enter the course grading rules.');
        };

        settings.onsubmit = event => {
            event.preventDefault();
            if (!requireSavedScores()) return;
            run(async () => {
                const values = Object.fromEntries(new FormData(settings));
                const record = {
                    name: values.name.trim(), term: values.term.trim(), weighting: values.weighting,
                    missing_is_zero: values.missing_is_zero === 'true',
                    categories: parseGradebookLines(values.categories, { requiredNumbers: values.weighting === 'weighted' }),
                    scale: parseGradebookLines(values.scale)
                };
                if (profile.role === 'admin') record.teacher_id = values.teacher_id || profile.id;
                const table = portalClient.from('gradebook_courses');
                const request = course ? table.update(record).eq('id', course.id) : table.insert(record);
                const saved = data(await request.select('id').single());
                await refreshCourses(saved.id);
                message('Course settings saved.', 'success');
            }, 'save course settings', 'Review the course name, grading scale and categories. Leave the entered settings in place while you correct them.');
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
            const student = students.find(record => record.id === enrollmentForm.elements.student_id.value);
            enrollmentForm.elements.grade_level.value = GRADEBOOK_GRADE_LEVELS.includes(student?.grade_level) ? student.grade_level : '';
            updateEnrollmentCredits();
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
                message(editing ? 'Enrollment updated.' : 'Student added to roster.', 'success');
            }, 'save the enrollment', 'Check the chosen student and course. If the student is already on this roster, edit the existing enrollment.');
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
            fields.title.focus();
        };
        byId('gradebook-duplicate-assignment').onclick = () => {
            if (!assignmentForm.elements.assignment_id.value) return;
            assignmentForm.elements.assignment_id.value = '';
            assignmentForm.elements.title.value = `${assignmentForm.elements.title.value} copy`.slice(0, 120);
            assignmentForm.elements.due_on.value = '';
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
                data(await (assignment_id ? table.update(updates).eq('id', assignment_id) : table.insert(record)));
                await loadCourse(course.id);
                message('Assignment saved.', 'success');
            }, 'save the assignment', 'Check the assignment name, category, points and rubric. Confirm that the course is still assigned to you.');
        };

        grid.onpaste = event => {
            const target = event.target.closest('input[data-score-column]');
            if (!target) return;
            const raw = event.clipboardData.getData('text').trim();
            if (!raw.includes('\n')) return;
            event.preventDefault();
            const scores = raw.split(/\r?\n/).map(score => score.trim());
            const column = [...grid.querySelectorAll('input[data-score-column]')].filter(input => input.dataset.scoreColumn === target.dataset.scoreColumn);
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

        scoreDialog.querySelector('form').addEventListener('submit', event => {
            if (event.submitter?.value !== 'apply') return;
            const rubricInputs = [...scoreDialog.querySelectorAll('[data-criterion]')];
            const completed = rubricInputs.filter(input => input.value !== '');
            if (completed.length && completed.length !== rubricInputs.length) {
                event.preventDefault();
                rubricInputs.find(input => input.value === '')?.focus();
                byId('gradebook-score-heading').textContent = 'Enter every rubric score or clear them all.';
            }
        });
        scoreDialog.onclose = () => {
            if (scoreDialog.returnValue !== 'apply') return;
            const fields = scoreDialog.querySelector('form').elements;
            const rubricInputs = Array.from(scoreDialog.querySelectorAll('[data-criterion]')).filter(input => input.value !== '');
            const rubricScores = Object.fromEntries(rubricInputs.map(input => [input.dataset.criterion, Number(input.value)]));
            const { enrollment, assignment, cell, mark } = scoreContext;
            updateMark(enrollment, assignment, {
                state: rubricInputs.length ? 'scored' : mark.state,
                score: rubricInputs.length ? rubricInputs.reduce((sum, input) => sum + Number(input.value), 0) : mark.score,
                rubric_scores: rubricScores,
                family_feedback: fields.family_feedback.value.trim(), private_note: fields.private_note.value.trim()
            }, cell);
            renderGrid();
        };

        save.onclick = () => run(async () => {
            const changed = [...dirty].map(key => marks.get(key));
            if (changed.some(mark => mark.state === 'scored' && (mark.score == null ||
                mark.score < 0 || Math.abs(mark.score * 100 - Math.round(mark.score * 100)) > 1e-6 ||
                mark.score > Number(assignments.find(item => item.id === mark.assignment_id).points)))) {
                throw new Error('Each score needs to be in range and have at most two decimal places.');
            }
            if (changed.length) data(await portalClient.rpc('gradebook_save_marks', { target_course: course.id, changes: changed }));
            await loadCourse(course.id);
            message('Scores saved.', 'success');
        }, 'save the scores', 'Check the score ranges and roster. A finalized grade must be reopened before you edit its scores.');

        byId('gradebook-discard').onclick = () => run(async () => {
            await loadCourse(course.id);
            message('Unsaved score changes discarded.');
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
                message(finalized ? 'Grade reopened. Finalize it again to restore it to the planner.'
                    : 'Grade finalized and added to the planner and transcript.', 'success');
            }, 'update the final grade', 'Review the enrollment, earned credits and reason before submitting again.');
        };

        panel.hidden = false;
        await run(() => refreshCourses());
    } catch (error) {
        message(portalActionMessage(error, 'load the gradebook', 'Confirm that you have an active administrator or teacher login and that an administrator assigned your classroom.'), 'error');
    }
}

document.addEventListener('DOMContentLoaded', initTeacherGradebook);
