/* ============================================================
   ZION outSchool - Supabase Family Portal
   ============================================================ */

const ZION_SUPABASE_URL = 'https://zwoivkqmnriwtokpbmdo.supabase.co';
const ZION_SUPABASE_KEY = 'sb_publishable_Phy4E8oKXWHcIfJZnDhxAA_DXEAyZ5g';

const portalClient = window.supabase
    ? window.supabase.createClient(ZION_SUPABASE_URL, ZION_SUPABASE_KEY)
    : null;

const STAFF_PORTAL_ROLES = ['admin', 'teacher', 'staff'];
const GRADUATION_GRADES = ['8', '9', '10', '11', '12'];
const GRADUATION_REQUIREMENTS = [
    { key: 'ela_category', label: 'English Language Arts', credits: '4', category: true },
    { key: 'english_i', label: 'ADE-Approved English I', credits: '1' },
    { key: 'english_ii', label: 'ADE-Approved English II', credits: '1' },
    { key: 'english_iii', label: 'ADE-Approved English III', credits: '1' },
    { key: 'english_iv', label: 'ADE-Approved English IV', credits: '1' },
    { key: 'math_category', label: 'Mathematics', credits: '4', category: true },
    { key: 'algebra_i', label: 'Algebra I', credits: '1' },
    { key: 'geometry', label: 'Geometry', credits: '1' },
    { key: 'algebra_ii_quantitative', label: 'Algebra II or Quantitative Reasoning (Transitional)', credits: '1' },
    { key: 'math_cs_flex', label: 'ADE-Approved Mathematics or Computer Science Flex Credit', credits: '1' },
    { key: 'science_category', label: 'Science', credits: '3', category: true },
    { key: 'biology', label: 'ADE-Approved Biology', credits: '1' },
    { key: 'physical_science', label: 'ADE-Approved Physical Science (Physical Science, Chemistry, or Physics)', credits: '1' },
    { key: 'science_cs_flex', label: 'ADE-Approved Science or Computer Science Flex Credit', credits: '1' },
    { key: 'social_studies_category', label: 'Social Studies', credits: '3', category: true },
    { key: 'world_history', label: 'ADE-Approved World History', credits: '1' },
    { key: 'us_history', label: 'ADE-Approved U.S. History', credits: '1' },
    { key: 'civics', label: 'ADE-Approved Civics', credits: '0.5' },
    { key: 'economics_finance', label: 'ADE-Approved Economics with Personal Finance', credits: '0.5' },
    { key: 'physical_education', label: 'Physical Education', credits: '0.5' },
    { key: 'fine_arts', label: 'Fine Arts', credits: '0.5' },
    { key: 'oral_communication', label: 'Oral Communication', credits: '0.5' },
    { key: 'health_safety', label: 'Health & Safety', credits: '0.5' },
    { key: 'career_focus_electives', label: 'Career Focus or Content Electives', credits: '6' },
    { key: 'total_required', label: 'TOTAL REQUIRED CREDITS', credits: '22', category: true }
];
const GRADUATION_MILESTONES = [
    { key: 'community_service', label: 'Documented community service', target: '75 clock hours in grades 9-12 (begins with 2027 graduates)' },
    { key: 'finance_standards', label: 'Personal and Family Finance Standards', target: 'Earn credit in a course that includes the standards in grades 9-12' },
    { key: 'arkansas_civics_exam', label: 'Arkansas Civics Exam', target: 'Pass with at least 60%' },
    { key: 'cpr_training', label: 'CPR training', target: 'Complete training' },
    { key: 'computer_science', label: 'Computer Science', target: 'Earn 1 credit of ADE-approved Computer Science or a computer science-related CTE course (begins with 2026 graduates)' }
];

function setPortalMessage(element, message, tone = 'neutral') {
    if (!element) return;
    element.textContent = message;
    element.dataset.tone = tone;
}

function togglePortalState(session) {
    document.querySelectorAll('[data-portal-guest]').forEach(el => {
        el.hidden = Boolean(session);
    });

    document.querySelectorAll('[data-portal-authenticated]').forEach(el => {
        el.hidden = !session;
    });

    document.querySelectorAll('[data-portal-user-email]').forEach(el => {
        el.textContent = session?.user?.email || '';
    });
}

function isStaffPortalProfile(profile) {
    return STAFF_PORTAL_ROLES.includes(profile?.role);
}

function togglePortalProfileState(profile) {
    const isStaff = isStaffPortalProfile(profile);

    document.querySelectorAll('[data-portal-staff]').forEach(el => {
        el.hidden = !isStaff;
    });

    document.querySelectorAll('[data-portal-role]').forEach(el => {
        el.textContent = profile?.role || '';
    });
}

async function getPortalProfile(session) {
    if (!portalClient || !session) return null;

    const { data, error } = await portalClient
        .from('portal_users')
        .select('id, display_name, family_name, role, active')
        .eq('id', session.user.id)
        .maybeSingle();

    if (error) {
        console.error('Unable to read portal profile:', error);
        return null;
    }

    return data;
}

async function getPortalSession() {
    if (!portalClient) return null;

    const { data, error } = await portalClient.auth.getSession();
    if (error) {
        console.error('Unable to read Supabase session:', error);
        return null;
    }

    return data.session;
}

function bindPortalLogin() {
    const loginForm = document.querySelector('[data-portal-login-form]');
    const status = document.querySelector('[data-portal-login-status]');

    if (!loginForm || !portalClient) {
        if (!portalClient) {
            setPortalMessage(status, 'The login service could not be loaded. Please refresh and try again.', 'error');
        }
        return;
    }

    loginForm.addEventListener('submit', async event => {
        event.preventDefault();

        const email = loginForm.querySelector('[name="email"]')?.value.trim();
        const password = loginForm.querySelector('[name="password"]')?.value;
        const submit = loginForm.querySelector('[type="submit"]');

        if (!email || !password) {
            setPortalMessage(status, 'Please enter both email and password.', 'error');
            return;
        }

        if (submit) submit.disabled = true;
        setPortalMessage(status, 'Signing in...', 'neutral');

        const { data, error } = await portalClient.auth.signInWithPassword({ email, password });

        if (submit) submit.disabled = false;

        if (error) {
            setPortalMessage(status, 'The email or password was not accepted.', 'error');
            return;
        }

        loginForm.reset();
        togglePortalState(data.session);
        setPortalMessage(status, 'You are signed in.', 'success');

        if (loginForm.dataset.redirectAfterLogin) {
            window.location.href = loginForm.dataset.redirectAfterLogin;
        }
    });
}

function bindPortalSignOut() {
    document.querySelectorAll('[data-portal-sign-out]').forEach(button => {
        button.addEventListener('click', async () => {
            if (!portalClient) return;
            await portalClient.auth.signOut();
            togglePortalState(null);

            if (document.body.dataset.requiresAuth === 'true') {
                window.location.href = 'family-portal.html';
            }
        });
    });
}

async function createSignedReportUrl(report) {
    if (!report.storage_path) return report.file_url || '';

    const bucket = report.storage_bucket || 'grade-reports';
    const { data, error } = await portalClient.storage
        .from(bucket)
        .createSignedUrl(report.storage_path, 600);

    if (error) {
        console.error('Unable to create signed grade report URL:', error);
        return '';
    }

    return data.signedUrl;
}

function normalizeStudentName(student) {
    const parts = [
        student.preferred_name || student.first_name,
        student.last_name
    ].filter(Boolean);

    return parts.join(' ') || 'Student';
}

function appendTextElement(parent, tagName, text, className = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
}

function formatPortalDate(value) {
    if (!value) return '';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

async function renderGradeReports(session) {
    const reportList = document.querySelector('[data-grade-reports-list]');
    const emptyState = document.querySelector('[data-grade-reports-empty]');
    const status = document.querySelector('[data-grade-reports-status]');

    if (!reportList || !portalClient || !session) return;

    setPortalMessage(status, 'Loading grade reports...', 'neutral');

    const [{ data: students, error: studentError }, { data: reports, error: reportError }] = await Promise.all([
        portalClient
            .from('students')
            .select('id, first_name, preferred_name, last_name, grade_level')
            .order('last_name', { ascending: true }),
        portalClient
            .from('grade_reports')
            .select('id, student_id, title, school_year, term, report_type, status, gpa, credits_earned, file_url, storage_bucket, storage_path, published_at, updated_at')
            .eq('status', 'published')
            .order('published_at', { ascending: false })
    ]);

    if (studentError || reportError) {
        console.error('Unable to load grade report data:', studentError || reportError);
        reportList.innerHTML = '';
        if (emptyState) emptyState.hidden = false;
        setPortalMessage(status, 'Grade reports are protected. No reports are published for this login yet.', 'neutral');
        return;
    }

    const reportsByStudent = new Map();
    (reports || []).forEach(report => {
        const studentReports = reportsByStudent.get(report.student_id) || [];
        studentReports.push(report);
        reportsByStudent.set(report.student_id, studentReports);
    });

    const visibleStudents = (students || []).filter(student => reportsByStudent.has(student.id));

    reportList.innerHTML = '';

    if (!visibleStudents.length) {
        if (emptyState) emptyState.hidden = false;
        setPortalMessage(status, 'No grade reports have been published for this login yet.', 'neutral');
        return;
    }

    if (emptyState) emptyState.hidden = true;

    for (const student of visibleStudents) {
        const card = document.createElement('article');
        card.className = 'grade-report-student';

        const heading = document.createElement('div');
        heading.className = 'grade-report-student-heading';

        const headingText = document.createElement('div');
        appendTextElement(headingText, 'span', 'Student', 'portal-tool-status');
        appendTextElement(headingText, 'h2', normalizeStudentName(student));
        appendTextElement(heading, 'span', student.grade_level ? `Grade ${student.grade_level}` : 'Grade level pending');
        heading.prepend(headingText);

        const list = document.createElement('div');
        list.className = 'grade-report-items';

        for (const report of reportsByStudent.get(student.id)) {
            const url = await createSignedReportUrl(report);
            const item = document.createElement('div');
            item.className = 'grade-report-item';

            const reportType = report.report_type === 'transcript' ? 'Working Transcript' : 'Grade Report';
            const published = formatPortalDate(report.published_at || report.updated_at);
            const meta = [report.school_year, report.term, published].filter(Boolean).join(' | ');

            const reportText = document.createElement('div');
            appendTextElement(reportText, 'span', reportType, 'grade-report-type');
            appendTextElement(reportText, 'h3', report.title || reportType);
            appendTextElement(reportText, 'p', meta || 'Published report');

            const academicMeta = [
                report.gpa ? `GPA: ${report.gpa}` : '',
                report.credits_earned ? `Credits: ${report.credits_earned}` : ''
            ].filter(Boolean).join(' | ');

            if (academicMeta) {
                appendTextElement(reportText, 'p', academicMeta);
            }

            item.appendChild(reportText);

            if (url) {
                const link = document.createElement('a');
                link.href = url;
                link.target = '_blank';
                link.rel = 'noopener';
                link.textContent = 'Open PDF';
                item.appendChild(link);
            } else {
                appendTextElement(item, 'span', 'File pending', 'grade-report-unavailable');
            }

            list.appendChild(item);
        }

        card.append(heading, list);
        reportList.appendChild(card);
    }

    setPortalMessage(status, 'Grade reports loaded.', 'success');
}

function graduationCellKey(requirementKey, gradeLevel) {
    return `${requirementKey}::${gradeLevel}`;
}

function buildGraduationEntryMap(entries) {
    const map = new Map();
    (entries || []).forEach(entry => {
        map.set(graduationCellKey(entry.requirement_key, entry.grade_level), entry);
    });
    return map;
}

function buildMilestoneMap(milestones) {
    const map = new Map();
    (milestones || []).forEach(milestone => {
        map.set(milestone.milestone_key, milestone);
    });
    return map;
}

function createPlannerInput(name, value, placeholder = '') {
    const input = document.createElement('input');
    input.name = name;
    input.value = value || '';
    input.placeholder = placeholder;
    return input;
}

function createPlannerStatusSelect(value) {
    const select = document.createElement('select');
    select.name = 'status';

    [
        ['not_started', 'Not started'],
        ['planned', 'Planned'],
        ['in_progress', 'In progress'],
        ['completed', 'Completed'],
        ['waived', 'Waived']
    ].forEach(([optionValue, label]) => {
        const option = document.createElement('option');
        option.value = optionValue;
        option.textContent = label;
        option.selected = (value || 'not_started') === optionValue;
        select.appendChild(option);
    });

    return select;
}

function renderGraduationPlannerTable(container, entries, milestones, options = {}) {
    if (!container) return;

    const editable = Boolean(options.editable);
    const entryMap = buildGraduationEntryMap(entries);
    const milestoneMap = buildMilestoneMap(milestones);

    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'graduation-table-wrap';

    const table = document.createElement('table');
    table.className = 'graduation-planner-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['Graduation Requirement', 'Required Credits', ...GRADUATION_GRADES.map(grade => `${grade}th Grade`), 'Notes'].forEach(text => {
        appendTextElement(headRow, 'th', text);
    });
    thead.appendChild(headRow);

    const tbody = document.createElement('tbody');

    GRADUATION_REQUIREMENTS.forEach(requirement => {
        const row = document.createElement('tr');
        if (requirement.category) row.className = 'graduation-category-row';

        appendTextElement(row, 'td', requirement.label);
        appendTextElement(row, 'td', requirement.credits);

        GRADUATION_GRADES.forEach(grade => {
            const cell = document.createElement('td');
            const entry = entryMap.get(graduationCellKey(requirement.key, grade));

            if (!requirement.category && editable) {
                cell.dataset.requirementKey = requirement.key;
                cell.dataset.gradeLevel = grade;
                cell.appendChild(createPlannerInput('course_name', entry?.course_name, 'Course'));
                cell.appendChild(createPlannerInput('credits', entry?.credits, 'Credits'));
                cell.appendChild(createPlannerStatusSelect(entry?.status));
                cell.appendChild(createPlannerInput('notes', entry?.notes, 'Notes'));
            } else {
                const parts = [
                    entry?.course_name,
                    entry?.credits ? `${entry.credits} credit${Number(entry.credits) === 1 ? '' : 's'}` : '',
                    entry?.status && entry.status !== 'not_started' ? entry.status.replace('_', ' ') : '',
                    entry?.notes
                ].filter(Boolean);
                cell.textContent = parts.join(' | ');
            }

            row.appendChild(cell);
        });

        const notesCell = document.createElement('td');
        if (!requirement.category && editable) {
            notesCell.textContent = 'Use grade cells for course details.';
        }
        row.appendChild(notesCell);

        tbody.appendChild(row);
    });

    table.append(thead, tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);

    const milestoneSection = document.createElement('div');
    milestoneSection.className = 'graduation-milestones';
    appendTextElement(milestoneSection, 'h3', 'Other Graduation Requirements');

    GRADUATION_MILESTONES.forEach(milestone => {
        const record = milestoneMap.get(milestone.key);
        const card = document.createElement('article');
        card.className = 'graduation-milestone-card';
        card.dataset.milestoneKey = milestone.key;

        const copy = document.createElement('div');
        appendTextElement(copy, 'h4', milestone.label);
        appendTextElement(copy, 'p', milestone.target);

        const controls = document.createElement('div');
        controls.className = 'graduation-milestone-controls';

        if (editable) {
            const select = document.createElement('select');
            select.name = 'status';
            ['not_started', 'in_progress', 'completed', 'waived'].forEach(value => {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = value.replace('_', ' ');
                option.selected = (record?.status || 'not_started') === value;
                select.appendChild(option);
            });

            controls.appendChild(select);
            controls.appendChild(createPlannerInput('completed_on', record?.completed_on, 'Completed date'));
            controls.appendChild(createPlannerInput('notes', record?.notes, 'Notes'));
        } else {
            appendTextElement(controls, 'span', (record?.status || 'not_started').replace('_', ' '));
            if (record?.completed_on) appendTextElement(controls, 'span', formatPortalDate(record.completed_on));
            if (record?.notes) appendTextElement(controls, 'span', record.notes);
        }

        card.append(copy, controls);
        milestoneSection.appendChild(card);
    });

    container.appendChild(milestoneSection);
}

async function loadGraduationRecords(studentId) {
    const [{ data: entries, error: entryError }, { data: milestones, error: milestoneError }] = await Promise.all([
        portalClient
            .from('graduation_plan_entries')
            .select('id, student_id, requirement_key, grade_level, course_name, credits, status, notes')
            .eq('student_id', studentId),
        portalClient
            .from('graduation_milestones')
            .select('id, student_id, milestone_key, status, completed_on, notes')
            .eq('student_id', studentId)
    ]);

    if (entryError || milestoneError) {
        throw entryError || milestoneError;
    }

    return { entries: entries || [], milestones: milestones || [] };
}

async function renderFamilyGraduationProgress(session) {
    const container = document.querySelector('[data-graduation-planner-readonly]');
    const status = document.querySelector('[data-graduation-progress-status]');
    if (!container || !portalClient || !session) return;

    setPortalMessage(status, 'Loading graduation progress...', 'neutral');

    const { data: students, error } = await portalClient
        .from('students')
        .select('id, first_name, preferred_name, last_name, grade_level')
        .order('last_name', { ascending: true });

    if (error || !students?.length) {
        console.error('Unable to load students for graduation progress:', error);
        container.innerHTML = '';
        setPortalMessage(status, 'No graduation progress records are available for this login yet.', 'neutral');
        return;
    }

    container.innerHTML = '';

    for (const student of students) {
        const section = document.createElement('section');
        section.className = 'graduation-student-section';
        appendTextElement(section, 'h3', normalizeStudentName(student));

        const studentContainer = document.createElement('div');
        section.appendChild(studentContainer);
        container.appendChild(section);

        try {
            const records = await loadGraduationRecords(student.id);
            renderGraduationPlannerTable(studentContainer, records.entries, records.milestones, { editable: false });
        } catch (error) {
            console.error('Unable to load graduation records:', error);
            appendTextElement(studentContainer, 'p', 'Graduation progress records are not available yet.', 'portal-inline-status');
        }
    }

    setPortalMessage(status, 'Graduation progress loaded.', 'success');
}

async function initGraduationPlanner(profile) {
    const select = document.querySelector('[data-planner-student-select]');
    const container = document.querySelector('[data-graduation-planner-editable]');
    const status = document.querySelector('[data-graduation-planner-status]');
    const saveButton = document.querySelector('[data-save-graduation-plan]');

    if (!select || !container || !portalClient) return;

    if (!isStaffPortalProfile(profile)) {
        document.querySelectorAll('[data-portal-denied]').forEach(el => {
            el.hidden = false;
        });
        document.querySelectorAll('.graduation-planner-panel').forEach(el => {
            el.hidden = true;
        });
        setPortalMessage(status, 'Staff access is required for this page.', 'error');
        return;
    }

    setPortalMessage(status, 'Loading students...', 'neutral');

    const { data: students, error } = await portalClient
        .from('students')
        .select('id, first_name, preferred_name, last_name, grade_level')
        .order('last_name', { ascending: true });

    if (error) {
        console.error('Unable to load planner students:', error);
        setPortalMessage(status, 'Students could not be loaded. Check Supabase policies and try again.', 'error');
        return;
    }

    select.innerHTML = '';

    if (!students?.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No students found';
        select.appendChild(option);
        setPortalMessage(status, 'No students are available for this login.', 'neutral');
        return;
    }

    students.forEach(student => {
        const option = document.createElement('option');
        option.value = student.id;
        option.textContent = normalizeStudentName(student);
        select.appendChild(option);
    });

    async function loadSelectedStudent() {
        if (!select.value) return;
        setPortalMessage(status, 'Loading planner...', 'neutral');

        try {
            const records = await loadGraduationRecords(select.value);
            renderGraduationPlannerTable(container, records.entries, records.milestones, { editable: true });
            setPortalMessage(status, 'Planner loaded.', 'success');
        } catch (error) {
            console.error('Unable to load planner records:', error);
            container.innerHTML = '';
            setPortalMessage(status, 'Planner records could not be loaded. Run the graduation planner SQL setup first.', 'error');
        }
    }

    select.addEventListener('change', loadSelectedStudent);

    saveButton?.addEventListener('click', async () => {
        if (!select.value) return;

        const entryRows = Array.from(container.querySelectorAll('td[data-requirement-key][data-grade-level]')).map(cell => ({
            student_id: select.value,
            requirement_key: cell.dataset.requirementKey,
            grade_level: cell.dataset.gradeLevel,
            course_name: cell.querySelector('[name="course_name"]')?.value.trim() || null,
            credits: cell.querySelector('[name="credits"]')?.value.trim() || null,
            notes: cell.querySelector('[name="notes"]')?.value.trim() || null,
            status: cell.querySelector('[name="status"]')?.value || 'not_started',
            updated_by: profile.id
        }));

        const milestoneRows = Array.from(container.querySelectorAll('.graduation-milestone-card[data-milestone-key]')).map(card => ({
            student_id: select.value,
            milestone_key: card.dataset.milestoneKey,
            status: card.querySelector('[name="status"]')?.value || 'not_started',
            completed_on: card.querySelector('[name="completed_on"]')?.value.trim() || null,
            notes: card.querySelector('[name="notes"]')?.value.trim() || null,
            updated_by: profile.id
        }));

        setPortalMessage(status, 'Saving planner...', 'neutral');
        if (saveButton) saveButton.disabled = true;

        const [{ error: entryError }, { error: milestoneError }] = await Promise.all([
            portalClient
                .from('graduation_plan_entries')
                .upsert(entryRows, { onConflict: 'student_id,requirement_key,grade_level' }),
            portalClient
                .from('graduation_milestones')
                .upsert(milestoneRows, { onConflict: 'student_id,milestone_key' })
        ]);

        if (saveButton) saveButton.disabled = false;

        if (entryError || milestoneError) {
            console.error('Unable to save planner:', entryError || milestoneError);
            setPortalMessage(status, 'Planner could not be saved. Check Supabase policies and try again.', 'error');
            return;
        }

        setPortalMessage(status, 'Planner saved.', 'success');
    });

    await loadSelectedStudent();
}

async function initPortalAuth() {
    const session = await getPortalSession();
    togglePortalState(session);
    const profile = await getPortalProfile(session);
    togglePortalProfileState(profile);

    bindPortalLogin();
    bindPortalSignOut();

    if (document.body.dataset.requiresAuth === 'true' && !session) {
        window.location.href = 'family-portal.html';
        return;
    }

    if (document.body.classList.contains('grade-reports-page')) {
        renderGradeReports(session);
        renderFamilyGraduationProgress(session);
    }

    if (document.body.classList.contains('graduation-planner-page')) {
        initGraduationPlanner(profile);
    }

    if (portalClient) {
        portalClient.auth.onAuthStateChange(async (_event, nextSession) => {
            const nextProfile = await getPortalProfile(nextSession);
            togglePortalState(nextSession);
            togglePortalProfileState(nextProfile);

            if (document.body.classList.contains('grade-reports-page')) {
                if (nextSession) {
                    renderGradeReports(nextSession);
                    renderFamilyGraduationProgress(nextSession);
                } else {
                    window.location.href = 'family-portal.html';
                }
            }

            if (document.body.classList.contains('graduation-planner-page')) {
                if (nextSession) {
                    initGraduationPlanner(nextProfile);
                } else {
                    window.location.href = 'family-portal.html';
                }
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', initPortalAuth);
