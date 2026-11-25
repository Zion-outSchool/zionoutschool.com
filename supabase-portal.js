/* ============================================================
   ZION outSchool - Supabase Family Portal
   ============================================================ */

const ZION_SUPABASE_URL = 'https://zwoivkqmnriwtokpbmdo.supabase.co';
const ZION_SUPABASE_KEY = 'sb_publishable_Phy4E8oKXWHcIfJZnDhxAA_DXEAyZ5g';
const isPortalPasswordResetPage = document.body.dataset.portalPasswordReset === 'true';

const portalClient = window.supabase
    ? window.supabase.createClient(ZION_SUPABASE_URL, ZION_SUPABASE_KEY, isPortalPasswordResetPage
        ? { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'zion-portal-recovery' } }
        : undefined)
    : null;

const STAFF_PORTAL_ROLES = ['admin', 'teacher', 'staff'];
const ADMIN_PORTAL_ROLES = ['admin'];
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

function portalActionMessage(error, action, nextStep) {
    const code = String(error?.code || '');
    const status = Number(error?.status || error?.statusCode);
    if (status === 401 || code === 'PGRST301' || code === 'PGRST303') {
        return 'Your sign-in expired. Copy any unsaved work, sign in again, and reopen this page.';
    }
    if (['22023', '42501', 'PA001', 'PA002', 'PA003', 'P0001'].includes(code) && error.message
        && !/permission denied|row-level security/i.test(error.message)) return `${error.message} ${nextStep}`;
    if (code === '42501' || status === 403) {
        return `Your account doesn’t have access to ${action}. ${nextStep}`;
    }
    if (code === '23505') return `A matching record already exists. ${nextStep}`;
    if (code === '23503' || code === 'PGRST116') return `A linked record is missing or has changed. ${nextStep}`;
    if (code === '23514' || code === '23502' || code === '22P02') return `Check the required fields before you ${action}. ${nextStep}`;
    if (status === 429) return `The service reached its request limit. Keep this page open and wait before trying to ${action} again.`;
    return `We couldn’t ${action}. ${nextStep}`;
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
    return profile?.active === true && STAFF_PORTAL_ROLES.includes(profile?.role);
}

function isAdminPortalProfile(profile) {
    return profile?.active === true && ADMIN_PORTAL_ROLES.includes(profile?.role);
}

let schoolUpdatesVersion = 0;

async function refreshPortalSchoolUpdates(profile) {
    const section = document.querySelector('[data-portal-school-updates]');
    if (!section || !portalClient) return;
    const list = section.querySelector('[data-portal-school-update-list]');
    const version = ++schoolUpdatesVersion;
    section.hidden = true;
    list.replaceChildren();
    if (!profile?.active) return;

    const { data, error } = await portalClient.from('communication_posts').select('id, kind, title')
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(3);
    if (version !== schoolUpdatesVersion || error || !data?.length) return;
    for (const { id, kind, title } of data) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = kind === 'newsletter'
            ? 'portal-communications.html?newsletter=' + encodeURIComponent(id) + '#newsletters'
            : 'portal-communications.html#update-' + encodeURIComponent(id);
        link.textContent = title;
        item.append(link);
        list.append(item);
    }
    section.hidden = false;
}

function togglePortalProfileState(profile) {
    const isStaff = isStaffPortalProfile(profile);
    const isAdmin = isAdminPortalProfile(profile);

    const welcome = document.querySelector('[data-portal-welcome]');
    if (welcome) {
        const name = profile?.active ? profile.display_name?.trim() : '';
        welcome.textContent = name ? `Welcome, ${name}!`
            : profile?.active ? 'Welcome back!' : 'Welcome to the Family Portal';
    }

    document.querySelectorAll('[data-portal-staff]').forEach(el => {
        el.hidden = !isStaff;
    });

    document.querySelectorAll('[data-portal-admin]').forEach(el => {
        el.hidden = !isAdmin;
    });

    document.querySelectorAll('[data-portal-gradebook]').forEach(el => {
        el.hidden = !profile?.active || !['admin', 'teacher'].includes(profile.role);
    });
    document.querySelectorAll('[data-portal-family]').forEach(el => {
        el.hidden = !profile?.active || profile.role !== 'family';
    });

    document.querySelectorAll('[data-portal-role]').forEach(el => {
        el.textContent = profile?.role || '';
    });

    document.querySelectorAll('[data-portal-active]').forEach(el => {
        el.hidden = profile?.active !== true;
    });
    document.querySelectorAll('[data-portal-messages]').forEach(el => {
        el.hidden = !profile?.active || !['family', 'teacher', 'admin'].includes(profile.role);
    });

    const calendar = document.querySelector('[data-portal-calendar]');
    if (profile?.active && calendar && !calendar.hasAttribute('src')) calendar.src = calendar.dataset.portalCalendar;
    if (!profile?.active) calendar?.removeAttribute('src');
    void refreshPortalSchoolUpdates(profile).catch(() => {});
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

        try {
            const { data, error } = await portalClient.auth.signInWithPassword({ email, password });
            if (error) {
                setPortalMessage(status, 'The email or password was not accepted.', 'error');
                return;
            }

            loginForm.reset();
            togglePortalState(data.session);
            setPortalMessage(status, 'You are signed in.', 'success');
            if (loginForm.dataset.redirectAfterLogin) window.location.href = loginForm.dataset.redirectAfterLogin;
        } catch {
            setPortalMessage(status, 'We couldn’t sign you in. Please try again.', 'error');
        } finally {
            if (submit) submit.disabled = false;
        }
    });
}

function bindPortalSignOut() {
    document.querySelectorAll('[data-portal-sign-out]').forEach(button => {
        button.addEventListener('click', async () => {
            if (!portalClient) return;
            await portalClient.auth.signOut();
            togglePortalState(null);
            togglePortalProfileState(null);

            if (document.body.dataset.portalPageRole) {
                window.location.replace('family-portal.html');
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

async function renderGradeReports(session, profile, isCurrent) {
    const reportList = document.querySelector('[data-grade-reports-list]');
    const emptyState = document.querySelector('[data-grade-reports-empty]');
    const status = document.querySelector('[data-grade-reports-status]');

    if (!reportList || !portalClient || !session) return;

    setPortalMessage(status, 'Loading published reports…');
    let studentQuery = portalClient
        .from('students')
        .select('id, family_id, first_name, preferred_name, last_name, grade_level')
        .order('last_name', { ascending: true });

    if (!isStaffPortalProfile(profile)) {
        studentQuery = studentQuery.eq('family_id', session.user.id);
    }

    const [{ data: students, error: studentError }, { data: reports, error: reportError }] = await Promise.all([
        studentQuery,
        portalClient
            .from('grade_reports')
            .select('id, student_id, title, school_year, term, report_type, status, gpa, credits_earned, file_url, storage_bucket, storage_path, published_at, updated_at')
            .eq('status', 'published')
            .order('published_at', { ascending: false })
    ]);

    if (!isCurrent()) return;
    if (studentError || reportError) {
        console.error('Unable to load grade report data:', studentError || reportError);
        reportList.innerHTML = '';
        if (emptyState) emptyState.hidden = true;
        setPortalMessage(status, 'Grade reports could not be loaded. Please try again or contact the school.', 'error');
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
        setPortalMessage(status, '');
        return;
    }

    if (emptyState) emptyState.hidden = true;

    for (const student of visibleStudents) {
        const card = document.createElement('article');
        card.className = 'grade-report-student';

        const heading = document.createElement('div');
        heading.className = 'grade-report-student-heading';

        const headingText = document.createElement('div');
        appendTextElement(headingText, 'h3', normalizeStudentName(student));
        appendTextElement(heading, 'span', student.grade_level ? `Grade ${student.grade_level}` : 'Grade level pending');
        heading.prepend(headingText);

        const list = document.createElement('div');
        list.className = 'grade-report-items';

        for (const report of reportsByStudent.get(student.id)) {
            const url = await createSignedReportUrl(report);
            if (!isCurrent()) return;
            const item = document.createElement('div');
            item.className = 'grade-report-item';

            const reportType = report.report_type === 'transcript' ? 'Working Transcript' : 'Grade Report';
            const published = formatPortalDate(report.published_at || report.updated_at);
            const meta = [report.school_year, report.term, published].filter(Boolean).join(' | ');

            const reportText = document.createElement('div');
            appendTextElement(reportText, 'span', reportType, 'grade-report-type');
            appendTextElement(reportText, 'h4', report.title || reportType);
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

    setPortalMessage(status, '');
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

function createPlannerInput(name, value, label = '') {
    const input = document.createElement('input');
    input.name = name;
    input.value = value ?? '';
    input.placeholder = label;
    input.setAttribute('aria-label', label);
    return input;
}

const PLANNER_STATUSES = {
    not_started: 'Not started', planned: 'Planned', in_progress: 'In progress', completed: 'Completed', waived: 'Waived'
};

function createPlannerStatusSelect(value, statuses = Object.keys(PLANNER_STATUSES)) {
    const select = document.createElement('select');
    select.name = 'status';
    statuses.forEach(optionValue => {
        const option = document.createElement('option');
        option.value = optionValue;
        option.textContent = PLANNER_STATUSES[optionValue];
        option.selected = (value || 'not_started') === optionValue;
        select.appendChild(option);
    });

    return select;
}

function hasPlannerEntry(entry) {
    return Boolean(entry && (entry.course_name || entry.notes || entry.final_grade || entry.credits != null
        || (entry.status && entry.status !== 'not_started')));
}

function addPlannerField(fields, text, control) {
    const label = appendTextElement(fields, 'label', '');
    appendTextElement(label, 'span', text);
    label.appendChild(control);
}

function plannerNotes(value) {
    const notes = document.createElement('textarea');
    notes.name = 'notes';
    notes.rows = 3;
    notes.value = value ?? '';
    return notes;
}

function updatePlannerSummary(summary, entry) {
    summary.replaceChildren();
    if (!hasPlannerEntry(entry)) {
        summary.textContent = 'Add course to plan';
        return;
    }
    appendTextElement(summary, 'strong', entry.course_name || (entry.notes ? 'Planning note' : 'Course details'));
    const credits = entry.credits == null ? '' : `${entry.credits} credit${Number(entry.credits) === 1 ? '' : 's'}`;
    appendTextElement(summary, 'small', [PLANNER_STATUSES[entry.status], credits].filter(Boolean).join(' · '));
}

function renderPlannerCourseEditor(cell, requirement, grade, entry) {
    cell.dataset.requirementKey = requirement.key;
    cell.dataset.gradeLevel = grade;
    appendTextElement(cell, 'span', `Grade ${grade}`, 'planner-mobile-grade');
    const editor = document.createElement('details');
    editor.className = 'planner-course-editor';
    const summary = appendTextElement(editor, 'summary', '');
    summary.setAttribute('aria-description', `${requirement.label}, grade ${grade}`);
    updatePlannerSummary(summary, entry);

    const fields = appendTextElement(editor, 'div', '', 'planner-course-fields');
    const course = createPlannerInput('course_name', entry?.course_name, 'Course name');
    const credits = createPlannerInput('credits', entry?.credits, 'Credits');
    Object.assign(credits, { type: 'number', inputMode: 'decimal', min: '0', max: '99.99', step: '0.01' });
    addPlannerField(fields, 'Course name', course);
    addPlannerField(fields, 'Credits', credits);
    addPlannerField(fields, 'Final grade', createPlannerInput('final_grade', entry?.final_grade, 'Final grade'));
    addPlannerField(fields, 'Status', createPlannerStatusSelect(hasPlannerEntry(entry) ? entry.status : 'planned'));
    addPlannerField(fields, 'Notes', plannerNotes(entry?.notes));
    cell.appendChild(editor);
}

function renderGraduationPlannerTable(container, entries, milestones, options = {}) {
    if (!container) return;

    const editable = Boolean(options.editable);
    const entryMap = buildGraduationEntryMap(entries);
    const syncedCourses = new Map();
    for (const entry of options.finalCourses || []) {
        const key = graduationCellKey(entry.requirement_key, entry.grade_level);
        if (!syncedCourses.has(key)) syncedCourses.set(key, []);
        syncedCourses.get(key).push(entry);
    }
    const milestoneMap = buildMilestoneMap(milestones);

    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'graduation-table-wrap';

    const table = document.createElement('table');
    table.className = 'graduation-planner-table';
    if (editable) table.setAttribute('role', 'table');

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    if (editable) {
        thead.setAttribute('role', 'rowgroup');
        headRow.setAttribute('role', 'row');
    }
    const headings = ['Graduation requirement', 'Required credits', ...GRADUATION_GRADES.map(grade => `Grade ${grade}`)];
    if (!editable) headings.push('Notes');
    headings.forEach(text => {
        appendTextElement(headRow, 'th', text).scope = 'col';
    });
    thead.appendChild(headRow);

    const tbody = document.createElement('tbody');
    if (editable) tbody.setAttribute('role', 'rowgroup');

    GRADUATION_REQUIREMENTS.forEach(requirement => {
        const row = document.createElement('tr');
        if (editable) row.setAttribute('role', 'row');
        if (requirement.category) row.className = 'graduation-category-row';

        const label = appendTextElement(row, editable ? 'th' : 'td', requirement.label);
        if (editable) label.scope = 'row';
        const creditsCell = appendTextElement(row, 'td', requirement.credits);
        if (editable) creditsCell.dataset.creditUnit = Number(requirement.credits) === 1 ? ' credit' : ' credits';
        if (requirement.category && editable) {
            appendTextElement(row, 'td', '').colSpan = GRADUATION_GRADES.length;
            tbody.appendChild(row);
            return;
        }

        GRADUATION_GRADES.forEach(grade => {
            const cell = document.createElement('td');
            const entry = entryMap.get(graduationCellKey(requirement.key, grade));
            const finalized = syncedCourses.get(graduationCellKey(requirement.key, grade)) || [];

            if (!requirement.category && editable) {
                renderPlannerCourseEditor(cell, requirement, grade, entry);
            } else {
                const parts = [
                    entry?.course_name,
                    entry?.credits != null ? `${entry.credits} credit${Number(entry.credits) === 1 ? '' : 's'}` : '',
                    entry?.final_grade ? `Final grade: ${entry.final_grade}` : '',
                    entry?.status && entry.status !== 'not_started' ? entry.status.replace('_', ' ') : '',
                    entry?.notes
                ].filter(Boolean);
                cell.textContent = parts.join(' | ');
            }
            for (const course of finalized) {
                appendTextElement(cell, 'p', [
                    course.course_name, course.term, course.final_grade ? `Final grade: ${course.final_grade}` : '',
                    course.credits == null ? '' : `${course.credits} credit${Number(course.credits) === 1 ? '' : 's'}`
                ].filter(Boolean).join(' · '), 'planner-gradebook-course');
            }

            row.appendChild(cell);
        });

        if (!editable) appendTextElement(row, 'td', '');

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
            addPlannerField(controls, 'Status', createPlannerStatusSelect(record?.status, ['not_started', 'in_progress', 'completed', 'waived']));
            const date = createPlannerInput('completed_on', record?.completed_on, 'Completed date');
            date.type = 'date';
            addPlannerField(controls, 'Completed date', date);
            addPlannerField(controls, 'Notes', plannerNotes(record?.notes));
        } else {
            appendTextElement(controls, 'span', (record?.status || 'not_started').replace('_', ' '));
            if (record?.completed_on) appendTextElement(controls, 'span', formatPortalDate(`${record.completed_on}T12:00:00`));
            if (record?.notes) appendTextElement(controls, 'span', record.notes);
        }

        card.append(copy, controls);
        milestoneSection.appendChild(card);
    });

    container.appendChild(milestoneSection);
}

async function loadGraduationRecords(studentId, { allowPartial = false } = {}) {
    const [{ data: entries, error: entryError }, { data: milestones, error: milestoneError }, finals, earlyCredit] = await Promise.all([
        portalClient
            .from('graduation_plan_entries')
            .select('id, student_id, requirement_key, grade_level, course_name, credits, final_grade, status, notes')
            .eq('student_id', studentId),
        portalClient
            .from('graduation_milestones')
            .select('id, student_id, milestone_key, status, completed_on, notes')
            .eq('student_id', studentId),
        portalClient
            .from('gradebook_final_courses')
            .select('course_name, term, requirement_key, grade_level, credits, final_grade')
            .eq('student_id', studentId).order('finalized_at', { ascending: false }),
        portalClient.rpc('ms_high_school_courses', { target_student: studentId })
    ]);

    const finalError = finals.error && !['42P01', 'PGRST205'].includes(finals.error.code) ? finals.error : null;
    const earlyCreditError = earlyCredit.error && !['42883', 'PGRST202'].includes(earlyCredit.error.code)
        ? earlyCredit.error : null;
    const plannerError = entryError || milestoneError;
    if (!allowPartial && (plannerError || finalError || earlyCreditError)) throw plannerError || finalError || earlyCreditError;
    const finalCourses = finals.data || [];
    const courseKey = course => JSON.stringify([course.grade_level, course.requirement_key, course.course_name.trim().toLowerCase()]);
    const seen = new Set(finalCourses.map(courseKey));
    for (const course of earlyCredit.data || []) {
        const key = courseKey(course);
        if (!seen.has(key)) {
            finalCourses.push(course);
            seen.add(key);
        }
    }
    return { entries: entries || [], milestones: milestones || [], finalCourses, plannerError, finalError: finalError || earlyCreditError };
}

const TRANSCRIPT_GRADES = ['6', '7', ...GRADUATION_GRADES];

function completedTranscriptCourses(entries, finalCourses) {
    const creditCourses = finalCourses.filter(course => course.requirement_key && TRANSCRIPT_GRADES.includes(course.grade_level));
    const sameCourse = (entry, final) => entry.grade_level === final.grade_level
        && entry.requirement_key === final.requirement_key
        && entry.course_name?.trim().toLowerCase() === final.course_name.trim().toLowerCase();
    return [
        ...entries.filter(entry => entry.status === 'completed' && !creditCourses.some(final => sameCourse(entry, final))),
        ...creditCourses
    ];
}

function printGraduationTranscript(student, courses) {
    const transcript = createGraduationPrintDocument(student, 'Working Transcript');

    const table = document.createElement('table');
    const headings = table.createTHead().insertRow();
    ['Course and term', 'Graduation requirement', 'Final grade', 'Earned credits'].forEach(label => {
        appendTextElement(headings, 'th', label).scope = 'col';
    });

    const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
    let earnedCredits = 0;
    for (const grade of TRANSCRIPT_GRADES) {
        const gradeCourses = courses.filter(course => course.grade_level === grade)
            .sort((first, second) => (first.course_name || '').localeCompare(second.course_name || ''));
        if (!gradeCourses.length) continue;

        const group = table.createTBody();
        const gradeHeading = appendTextElement(group.insertRow(), 'th', `Grade ${grade}`, 'transcript-grade');
        gradeHeading.colSpan = 4;
        gradeHeading.scope = 'rowgroup';

        for (const course of gradeCourses) {
            const row = group.insertRow();
            const requirement = GRADUATION_REQUIREMENTS.find(item => item.key === course.requirement_key);
            appendTextElement(row, 'td', [course.course_name, course.term].filter(Boolean).join(' · ') || '—');
            appendTextElement(row, 'td', requirement?.label || course.requirement_key);
            appendTextElement(row, 'td', course.final_grade || '—');
            appendTextElement(row, 'td', course.credits == null ? '—' : numberFormat.format(course.credits));
            earnedCredits += Number(course.credits ?? 0);
        }
    }
    transcript.appendChild(table);
    appendTextElement(transcript, 'p', `Total earned credits: ${numberFormat.format(earnedCredits)}`, 'transcript-total');
    printGraduationDocument(transcript, 'Working Transcript');
}

function createGraduationPrintDocument(student, title) {
    const article = document.createElement('article');
    article.className = 'planner-transcript';
    appendTextElement(article, 'p', 'Zion outSchool', 'transcript-school');
    appendTextElement(article, 'h1', title);
    appendTextElement(article, 'p', [student.first_name, student.last_name].filter(Boolean).join(' '), 'transcript-student');
    appendTextElement(article, 'p', `Generated ${formatPortalDate(new Date())}`);
    return article;
}

function printGraduationPlan(student, { entries, milestones, finalCourses }) {
    const plan = createGraduationPrintDocument(student, 'Graduation Plan');
    plan.classList.add('planner-print-plan');
    const requirements = new Map(GRADUATION_REQUIREMENTS.map(requirement => [requirement.key, requirement.label]));
    const requirementOrder = new Map(GRADUATION_REQUIREMENTS.map((requirement, index) => [requirement.key, index]));
    const order = course => requirementOrder.get(course.requirement_key) ?? requirementOrder.size;
    const courses = [
        ...entries.filter(hasPlannerEntry),
        ...finalCourses.map(course => ({ ...course, status: 'completed', gradebook: true }))
    ];
    const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
    for (const grade of GRADUATION_GRADES) {
        const gradeCourses = courses.filter(course => course.grade_level === grade);
        if (!gradeCourses.length) continue;
        const section = document.createElement('section');
        appendTextElement(section, 'h2', `Grade ${grade}`);
        const table = document.createElement('table');
        const heading = table.createTHead().insertRow();
        ['Requirement', 'Course and notes', 'Status', 'Credits', 'Final grade'].forEach(label => {
            appendTextElement(heading, 'th', label).scope = 'col';
        });
        const rows = table.createTBody();
        gradeCourses.sort((first, second) => order(first) - order(second));
        for (const course of gradeCourses) {
            const row = rows.insertRow();
            appendTextElement(row, 'td', requirements.get(course.requirement_key) || course.requirement_key || 'Unassigned');
            const courseCell = appendTextElement(row, 'td', '');
            appendTextElement(courseCell, 'strong', [course.course_name, course.term].filter(Boolean).join(' · ') || '—');
            if (course.notes) appendTextElement(courseCell, 'p', course.notes, 'planner-print-note');
            appendTextElement(row, 'td', course.gradebook ? 'Completed (gradebook)' : PLANNER_STATUSES[course.status] || 'Not started');
            appendTextElement(row, 'td', course.credits == null ? '—' : numberFormat.format(course.credits));
            appendTextElement(row, 'td', course.final_grade || '—');
        }
        section.appendChild(table);
        plan.appendChild(section);
    }
    if (!plan.querySelector('table')) appendTextElement(plan, 'p', 'No courses are on this plan yet.');

    const milestoneSection = document.createElement('section');
    appendTextElement(milestoneSection, 'h2', 'Other graduation requirements');
    const milestoneMap = buildMilestoneMap(milestones);
    for (const milestone of GRADUATION_MILESTONES) {
        const record = milestoneMap.get(milestone.key);
        const card = appendTextElement(milestoneSection, 'div', '', 'planner-print-milestone');
        appendTextElement(card, 'h3', milestone.label);
        appendTextElement(card, 'p', milestone.target);
        appendTextElement(card, 'p', [
            PLANNER_STATUSES[record?.status] || 'Not started',
            record?.completed_on ? formatPortalDate(`${record.completed_on}T12:00:00`) : ''
        ].filter(Boolean).join(' · '));
        if (record?.notes) appendTextElement(card, 'p', record.notes, 'planner-print-note');
    }
    plan.appendChild(milestoneSection);
    printGraduationDocument(plan, 'Graduation Plan');
}

function printGraduationDocument(article, title) {
    document.body.appendChild(article);
    const originalTitle = document.title;
    document.title = `Zion outSchool - ${title}`;
    const closeTranscript = () => {
        window.removeEventListener('afterprint', closeTranscript);
        article.remove();
        document.title = originalTitle;
    };
    window.addEventListener('afterprint', closeTranscript);
    try {
        window.print();
    } catch (error) {
        closeTranscript();
        throw error;
    }
}

async function loadPlannerStudents() {
    const { data, error } = await portalClient
        .from('students')
        .select('id, first_name, preferred_name, last_name, grade_level')
        .order('last_name', { ascending: true });

    if (error) throw error;
    return data || [];
}

async function populatePlannerStudentSelect(select, selectedStudentId = '') {
    const students = await loadPlannerStudents();
    select.innerHTML = '';

    if (!students.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No students found';
        select.appendChild(option);
        return students;
    }

    students.forEach(student => {
        const option = document.createElement('option');
        option.value = student.id;
        option.textContent = normalizeStudentName(student);
        option.selected = student.id === selectedStudentId;
        select.appendChild(option);
    });

    return students;
}

async function populateStudentFamilySelect(select) {
    const { data, error } = await portalClient
        .from('portal_users')
        .select('id, display_name, family_name')
        .eq('role', 'family')
        .eq('active', true)
        .order('family_name', { ascending: true });

    if (error) throw error;

    select.innerHTML = '';

    if (!data?.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No family logins found';
        select.appendChild(option);
        return;
    }

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Link a family login later';
    select.appendChild(placeholder);

    data.forEach(family => {
        const option = document.createElement('option');
        option.value = family.id;
        option.textContent = [...new Set([family.family_name, family.display_name].filter(Boolean))].join(' · ') || 'Family account';
        select.appendChild(option);
    });
}

async function initStudentFileForm(profile, onStudentCreated) {
    const form = document.querySelector('[data-student-file-form]');
    const familySelect = document.querySelector('[data-student-family-select]');
    const status = document.querySelector('[data-student-file-status]');

    if (!form || !familySelect || !portalClient || !isAdminPortalProfile(profile)) return;

    try {
        await populateStudentFamilySelect(familySelect);
    } catch (error) {
        console.error('Unable to load family logins:', error);
        familySelect.innerHTML = '';
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Link a family login later';
        familySelect.appendChild(option);
        setPortalMessage(status, portalActionMessage(error, 'load family logins', 'Check the family account in Portal Administration, then reload the planner.'), 'error');
    }

    if (form.dataset.bound === 'true') return;
    form.dataset.bound = 'true';

    form.addEventListener('submit', async event => {
        event.preventDefault();

        const submit = form.querySelector('[type="submit"]');
        const familyId = form.elements.family_id.value;
        const firstName = form.elements.first_name?.value.trim();
        const preferredName = form.elements.preferred_name?.value.trim();
        const lastName = form.elements.last_name?.value.trim();
        const gradeLevel = form.elements.grade_level?.value.trim();

        if (!firstName || !lastName) {
            setPortalMessage(status, 'Enter the student’s first and last name.', 'error');
            return;
        }

        if (submit) submit.disabled = true;
        setPortalMessage(status, 'Creating student file...', 'neutral');

        const { data, error } = await portalClient
            .from('students')
            .insert({
                family_id: familyId || null,
                first_name: firstName,
                preferred_name: preferredName || null,
                last_name: lastName,
                grade_level: gradeLevel || null
            })
            .select('id')
            .single();

        if (submit) submit.disabled = false;

        if (error) {
            console.error('Unable to create student:', error);
            setPortalMessage(status, portalActionMessage(error, 'create the student file', 'Check the required names and the selected family login in Portal Administration.'), 'error');
            return;
        }

        form.reset();
        try {
            await populateStudentFamilySelect(familySelect);
        } catch (error) {
            console.error('Unable to refresh family logins:', error);
        }
        setPortalMessage(status, 'Student file created.', 'success');
        await onStudentCreated?.(data.id);
    });
}

function renderFamilyAssignmentList(parent, assignments, { showFeedback = false } = {}) {
    const list = appendTextElement(parent, 'ul', '', 'family-grade-assignments');
    const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
    const status = { missing: 'Missing', excused: 'Waived', ungraded: 'Feedback posted' };
    for (const assignment of assignments) {
        const item = appendTextElement(list, 'li', '');
        const row = appendTextElement(item, 'div', '', 'family-grade-assignment-row');
        const title = appendTextElement(row, 'div', '');
        appendTextElement(title, 'strong', assignment.title);
        if (assignment.due_on) appendTextElement(title, 'p', `Due ${formatPortalDate(assignment.due_on + 'T00:00:00')}`);
        appendTextElement(row, 'span', assignment.state === 'scored'
            ? `${number.format(assignment.score)} / ${number.format(assignment.points)}`
            : status[assignment.state]);
        if (showFeedback && assignment.family_feedback?.trim()) {
            appendTextElement(item, 'p', assignment.family_feedback, 'family-grade-assignment-feedback');
        }
    }
}

function renderFamilyCourseAssignments(courseItem, course, isCurrent) {
    const recent = appendTextElement(courseItem, 'div', '');
    appendTextElement(recent, 'p', 'Recent assignments', 'family-grade-recent-label');
    renderFamilyAssignmentList(recent, course.recent_assignments);
    const details = appendTextElement(courseItem, 'details', '', 'family-grade-details');
    appendTextElement(details, 'summary', 'All posted assignments and feedback');
    const results = appendTextElement(details, 'div', '');
    const status = appendTextElement(details, 'p', '');
    status.setAttribute('role', 'status');
    const more = appendTextElement(details, 'button', 'Load more assignments');
    more.type = 'button';
    more.hidden = true;
    const pageSize = 50;
    let offset = 0;
    let loading = false;

    async function loadAssignments() {
        if (loading) return;
        loading = more.disabled = true;
        setPortalMessage(status, 'Loading assignments…');
        try {
            const { data, error } = await portalClient.rpc('gradebook_family_assignments', {
                target_enrollment: course.enrollment_id, page_offset: offset
            });
            if (!isCurrent()) return;
            if (error) throw error;
            const page = data.slice(0, pageSize);
            renderFamilyAssignmentList(results, page, { showFeedback: true });
            offset += page.length;
            more.textContent = 'Load more assignments';
            more.hidden = data.length <= pageSize;
            setPortalMessage(status, offset ? '' : 'No posted assignments.');
        } catch {
            if (!isCurrent()) return;
            setPortalMessage(status, 'Assignments couldn’t load. Try again.', 'error');
            more.hidden = false;
            more.textContent = 'Retry loading assignments';
        } finally {
            loading = more.disabled = false;
        }
    }

    details.addEventListener('toggle', () => {
        recent.hidden = details.open;
        if (details.open && offset === 0 && more.hidden) void loadAssignments();
    });
    more.onclick = loadAssignments;
}

function renderFamilyCourseGroups(section, courses, isCurrent) {
    if (!courses.length) {
        appendTextElement(section, 'p', 'No classes have been added for this student.');
        return;
    }
    const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
    for (const finalized of [false, true]) {
        const group = courses.filter(course => course.finalized === finalized);
        if (!group.length) continue;
        appendTextElement(section, 'h4', finalized ? 'Final grades' : 'Current classes', 'family-grade-group-label');
        const list = appendTextElement(section, 'ul', '', 'family-grade-courses');
        for (const course of group) {
            const item = appendTextElement(list, 'li', '');
            const heading = appendTextElement(item, 'div', '', 'family-grade-course-heading');
            const title = appendTextElement(heading, 'div', '');
            appendTextElement(title, 'h5', course.course_name);
            const credits = Number(course.earned_credits);
            const metadata = [course.term, course.earned_credits != null && `${number.format(credits)} ${credits === 1 ? 'credit' : 'credits'}`].filter(Boolean);
            if (metadata.length) appendTextElement(title, 'p', metadata.join(' · '));
            const grade = [course.letter, !finalized && course.percent != null && `${number.format(course.percent)}%`].filter(Boolean).join(' · ');
            appendTextElement(heading, 'span', grade || 'No grade yet', 'family-final-grade');
            if (course.recent_assignments.length) renderFamilyCourseAssignments(item, course, isCurrent);
            else appendTextElement(item, 'p', 'No posted assignments yet.');
        }
    }
}

function renderFamilyCourseCard(student, records, courseResult, feedbackResult, isCurrent) {
    const section = document.createElement('section');
    section.className = 'family-grade-card';
    const header = appendTextElement(section, 'div', '', 'family-grade-student-heading');
    appendTextElement(header, 'h3', normalizeStudentName(student));
    if (student.grade_level) appendTextElement(header, 'p', student.grade_level === 'K' ? 'Kindergarten' : `Grade ${student.grade_level}`);

    if (!courseResult.error) {
        renderFamilyCourseGroups(section, courseResult.data ?? [], isCurrent);
    } else {
        appendTextElement(section, 'p', 'Current grades are temporarily unavailable.');
    }

    if (courseResult.error && records.finalCourses.length) {
        const courses = appendTextElement(section, 'ul', '', 'family-final-courses');
        for (const course of records.finalCourses) {
            const item = appendTextElement(courses, 'li', '');
            const title = appendTextElement(item, 'div', '');
            appendTextElement(title, 'h4', course.course_name);
            const credits = Number(course.credits);
            const detail = [course.term, course.requirement_key && `${credits} ${credits === 1 ? 'credit' : 'credits'}`].filter(Boolean);
            if (detail.length) appendTextElement(title, 'p', detail.join(' · '));
            const grade = appendTextElement(item, 'span', '', 'family-final-grade');
            appendTextElement(grade, 'span', 'Final grade ', 'family-grade-sr-only');
            grade.append(course.final_grade);
        }
    } else if (courseResult.error) {
        appendTextElement(section, 'p', records.finalError ? 'Course grades couldn’t load. Try refreshing the page.'
            : 'No course grades have been finalized yet.');
    }

    if (feedbackResult.data?.length) {
        const details = appendTextElement(section, 'details', '', 'family-grade-details');
        appendTextElement(details, 'summary', 'Teacher feedback');
        const list = appendTextElement(details, 'ul', '', 'family-grade-feedback');
        for (const item of feedbackResult.data) {
            const entry = appendTextElement(list, 'li', '');
            appendTextElement(entry, 'h4', item.assignment_title);
            appendTextElement(entry, 'small', [item.course_name, item.term].filter(Boolean).join(' · '));
            appendTextElement(entry, 'p', item.feedback);
        }
    } else if (feedbackResult.error) {
        appendTextElement(section, 'p', 'Teacher feedback couldn’t load. Try refreshing the page.');
    }

    const entries = records.entries.filter(entry => (
        entry.course_name || entry.credits || entry.final_grade || entry.notes || (entry.status && entry.status !== 'not_started')
    ));
    const milestones = records.milestones.filter(milestone => (
        milestone.completed_on || milestone.notes || (milestone.status && milestone.status !== 'not_started')
    ));
    if (!records.plannerError && (entries.length || milestones.length || records.finalCourses.some(course => course.requirement_key))) {
        const details = appendTextElement(section, 'details', '', 'family-grade-details');
        appendTextElement(details, 'summary', 'Graduation planning worksheet');
        const planner = appendTextElement(details, 'div', '');
        renderGraduationPlannerTable(planner, entries, milestones, { finalCourses: records.finalCourses });
    }
    return section;
}

async function renderFamilyGraduationProgress(session, isCurrent) {
    const progressView = document.querySelector('[data-graduation-progress-view]');
    const container = document.querySelector('[data-graduation-planner-readonly]');
    const status = document.querySelector('[data-graduation-progress-status]');
    if (!progressView || !container) return;

    progressView.hidden = false;
    setPortalMessage(status, 'Loading course grades…');
    try {
        const { data: students, error } = await portalClient
            .from('students')
            .select('id, first_name, preferred_name, last_name, grade_level')
            .eq('family_id', session.user.id)
            .order('last_name', { ascending: true });
        if (!isCurrent()) return;
        if (error) throw error;
        if (!students?.length) {
            setPortalMessage(status, 'Course grades will appear here after a student is linked to this family login.');
            return;
        }

        const cards = await Promise.all(students.map(async student => {
            const [records, courses] = await Promise.all([
                loadGraduationRecords(student.id, { allowPartial: true }),
                portalClient.rpc('gradebook_family_courses', { target_student: student.id })
            ]);
            if (!isCurrent()) return null;
            const feedback = courses.error && records.finalCourses.length
                ? await portalClient.rpc('gradebook_family_feedback', { target_student: student.id }) : {};
            if (!isCurrent()) return null;
            return renderFamilyCourseCard(student, records, courses, feedback, isCurrent);
        }));
        if (!isCurrent()) return;
        container.replaceChildren(...cards.filter(Boolean));
        setPortalMessage(status, '');
    } catch (error) {
        if (!isCurrent()) return;
        console.error('Unable to load course grades:', error);
        setPortalMessage(status, 'Course grades couldn’t load. Try refreshing the page.', 'error');
    }
}

async function renderFamilyGradeAlerts(isCurrent) {
    const section = document.querySelector('[data-grade-alerts]');
    const form = section.querySelector('form');
    const frequency = form.elements.frequency;
    const submit = form.querySelector('button');
    const status = section.querySelector('[data-grade-alerts-status]');
    section.hidden = false;
    frequency.disabled = submit.disabled = true;
    frequency.value = 'off';
    setPortalMessage(status, 'Loading email preference…');
    try {
        const { data, error } = await portalClient.rpc('gradebook_family_alert_preference');
        if (!isCurrent()) return;
        if (error) throw error;
        frequency.value = data;
        frequency.disabled = submit.disabled = false;
        setPortalMessage(status, '');
    } catch {
        if (isCurrent()) setPortalMessage(status, 'Grade email settings are temporarily unavailable.', 'error');
        return;
    }

    form.onsubmit = async event => {
        event.preventDefault();
        if (!isCurrent() || submit.disabled) return;
        frequency.disabled = submit.disabled = true;
        setPortalMessage(status, 'Saving email preference…');
        try {
            const { error } = await portalClient.rpc('gradebook_family_set_alert_preference', { new_frequency: frequency.value });
            if (error) throw error;
            if (isCurrent()) setPortalMessage(status, 'Email preference saved.', 'success');
        } catch {
            if (isCurrent()) setPortalMessage(status, 'Email preference couldn’t be saved. Try again.', 'error');
        } finally {
            if (isCurrent()) frequency.disabled = submit.disabled = false;
        }
    };
}

let gradeReportVersion = 0;

async function renderFamilyGradeReportPage(session, profile) {
    const version = ++gradeReportVersion;
    const isCurrent = () => version === gradeReportVersion;
    const reports = document.querySelector('[data-grade-reports-list]');
    const empty = document.querySelector('[data-grade-reports-empty]');
    const progressView = document.querySelector('[data-graduation-progress-view]');
    const alerts = document.querySelector('[data-grade-alerts]');

    reports?.replaceChildren();
    if (empty) empty.hidden = true;
    if (progressView) progressView.hidden = true;
    if (alerts) {
        alerts.hidden = true;
        alerts.querySelector('form').onsubmit = null;
    }
    document.querySelector('[data-graduation-planner-readonly]')?.replaceChildren();
    const jobs = [renderGradeReports(session, profile, isCurrent).catch(error => {
        if (!isCurrent()) return;
        console.error('Unable to load published reports:', error);
        setPortalMessage(document.querySelector('[data-grade-reports-status]'), 'Published reports couldn’t load. Try refreshing the page.', 'error');
    })];
    if (profile.role === 'family') {
        jobs.push(renderFamilyGraduationProgress(session, isCurrent));
        if (alerts) jobs.push(renderFamilyGradeAlerts(isCurrent));
    }
    await Promise.all(jobs);
}

async function initGraduationPlanner(profile) {
    const select = document.querySelector('[data-planner-student-select]');
    const container = document.querySelector('[data-graduation-planner-editable]');
    const status = document.querySelector('[data-graduation-planner-status]');
    const saveButton = document.querySelector('[data-save-graduation-plan]');
    const planButton = document.querySelector('[data-export-graduation-plan]');
    const transcriptButton = document.querySelector('[data-export-graduation-transcript]');
    if (!select || !container || !saveButton || !portalClient || !isStaffPortalProfile(profile)) return;

    const actions = [saveButton, planButton, transcriptButton].filter(Boolean);
    const savedFields = new WeakMap();
    let students = [];
    let busy = false;
    let loadVersion = 0;

    function updateControls() {
        const ready = select.value && select.value === container.dataset.studentId;
        select.disabled = busy;
        container.inert = busy;
        for (const action of actions) action.disabled = busy || !ready;
    }

    function plannerGroups() {
        return [
            { table: 'graduation_plan_entries', key: 'student_id,requirement_key,grade_level',
                cells: [...container.querySelectorAll('td[data-requirement-key]')] },
            { table: 'graduation_milestones', key: 'student_id,milestone_key',
                cells: [...container.querySelectorAll('[data-milestone-key]')] }
        ];
    }

    function readFields(cell) {
        return Object.fromEntries([...cell.querySelectorAll('[name]')].map(field => [field.name, field.value.trim() || null]));
    }

    function changedFields() {
        return plannerGroups().map(group => ({
            ...group,
            changes: group.cells.map(cell => ({ cell, fields: readFields(cell) }))
                .filter(({ cell, fields }) => JSON.stringify(fields) !== savedFields.get(cell))
        }));
    }

    async function saveChanges(studentId) {
        const invalid = [...container.querySelectorAll('input, select, textarea')].find(field => !field.validity.valid);
        if (invalid) {
            const editor = invalid.closest('details');
            if (editor) editor.open = true;
            setPortalMessage(status, 'Check credit values and dates in the highlighted field.', 'error');
            return invalid;
        }
        const timestamp = new Date().toISOString();
        const groups = changedFields().filter(group => group.changes.length);
        const results = await Promise.allSettled(groups.map(async group => {
            const rows = group.changes.map(({ cell, fields }) => ({
                student_id: studentId,
                ...(cell.dataset.requirementKey ? { requirement_key: cell.dataset.requirementKey, grade_level: cell.dataset.gradeLevel }
                    : { milestone_key: cell.dataset.milestoneKey }),
                ...fields,
                updated_by: profile.id,
                updated_at: timestamp
            }));
            const { error } = await portalClient.from(group.table).upsert(rows, { onConflict: group.key });
            if (error) throw error;
            for (const { cell, fields } of group.changes) {
                const summary = cell.querySelector('.planner-course-editor > summary');
                if (summary) updatePlannerSummary(summary, fields);
                savedFields.set(cell, JSON.stringify(fields));
            }
        }));
        const failed = results.find(result => result.status === 'rejected');
        if (failed) throw failed.reason;
        return null;
    }

    async function loadSelectedStudent() {
        const studentId = select.value;
        const version = ++loadVersion;
        delete container.dataset.studentId;
        container.replaceChildren();
        updateControls();
        if (!studentId) return;
        setPortalMessage(status, 'Loading plan…');

        try {
            const records = await loadGraduationRecords(studentId);
            if (version !== loadVersion || select.value !== studentId) return;
            renderGraduationPlannerTable(container, records.entries, records.milestones, { editable: true, finalCourses: records.finalCourses });
            for (const { cells } of plannerGroups()) {
                for (const cell of cells) savedFields.set(cell, JSON.stringify(readFields(cell)));
            }
            container.dataset.studentId = studentId;
            updateControls();
            setPortalMessage(status, '');
        } catch (error) {
            if (version !== loadVersion) return;
            console.error('Unable to load planner records:', error);
            setPortalMessage(status, portalActionMessage(error, 'open this student’s plan', 'Confirm the student is on your classroom roster, then select them again.'), 'error');
        }
    }

    async function refreshStudents(selectedStudentId = '') {
        setPortalMessage(status, 'Loading students…');
        try {
            students = await populatePlannerStudentSelect(select, selectedStudentId);
            if (!students.length) {
                delete container.dataset.studentId;
                container.replaceChildren();
                updateControls();
                setPortalMessage(status, 'No students are available on your roster.');
                return;
            }
            await loadSelectedStudent();
        } catch (error) {
            console.error('Unable to load planner students:', error);
            setPortalMessage(status, portalActionMessage(error, 'load the planner roster', 'Check your classroom assignment in the gradebook or ask an administrator to review it.'), 'error');
        }
    }

    async function runPlannerAction(exportKind) {
        const student = students.find(record => record.id === select.value);
        if (busy || !student || container.dataset.studentId !== student.id) return;
        busy = true;
        updateControls();
        setPortalMessage(status, exportKind ? 'Preparing PDF…' : 'Saving plan…');
        let invalid;
        let saving = true;
        try {
            invalid = await saveChanges(student.id);
            if (invalid) return;
            saving = false;
            if (!exportKind) {
                setPortalMessage(status, 'Plan saved.', 'success');
                return;
            }
            const records = await loadGraduationRecords(student.id);
            const session = await getPortalSession();
            if (session?.user?.id !== profile.id || select.value !== student.id) return;

            if (exportKind === 'transcript') {
                const courses = completedTranscriptCourses(records.entries, records.finalCourses);
                if (!courses.length) {
                    setPortalMessage(status, 'Use Save plan as PDF to print this student’s plan. A transcript requires a completed course.');
                    return;
                }
                printGraduationTranscript(student, courses);
            } else {
                printGraduationPlan(student, records);
            }
            setPortalMessage(status, 'Choose Save as PDF in the print dialog.', 'success');
        } catch (error) {
            console.error('Unable to finish planner action:', error);
            setPortalMessage(status, saving
                ? portalActionMessage(error, 'save the plan', 'Check credit values and dates, and confirm the student is still assigned to you.')
                : portalActionMessage(error, 'export the PDF', 'Check that the student’s courses and plan load, then try again.'), 'error');
        } finally {
            busy = false;
            updateControls();
            invalid?.reportValidity();
        }
    }

    select.onchange = () => {
        const previous = container.dataset.studentId;
        if (previous && changedFields().some(group => group.changes.length)
            && !window.confirm('Switch students and discard the unsaved changes to this plan?')) {
            select.value = previous;
            return;
        }
        void loadSelectedStudent();
    };
    saveButton.onclick = () => void runPlannerAction();
    if (planButton) planButton.onclick = () => void runPlannerAction('plan');
    if (transcriptButton) transcriptButton.onclick = () => void runPlannerAction('transcript');

    await initStudentFileForm(profile, refreshStudents);
    await refreshStudents();
}

function canOpenPortalPage(requiredRole, profile) {
    if (!profile?.active) return false;
    if (requiredRole === 'active') return true;
    if (requiredRole === 'family') return profile.role === 'family';
    if (requiredRole === 'staff') return isStaffPortalProfile(profile);
    if (requiredRole === 'admin') return isAdminPortalProfile(profile);
    if (requiredRole === 'gradebook') return ['admin', 'teacher'].includes(profile.role);
    return false;
}

async function initPortalAuth() {
    const requiredRole = document.body.dataset.portalPageRole;
    const page = document.querySelector('[data-portal-page-content]');
    const unavailable = document.querySelector('[data-portal-unavailable]');
    const gradeReportPage = document.body.classList.contains('grade-reports-page');
    const pageSignOut = requiredRole && document.querySelector('[data-portal-sign-out]');
    let displayedUser;
    let displayedRole;

    function showPortal(session, profile) {
        togglePortalState(session);
        togglePortalProfileState(profile);
        if (unavailable) unavailable.hidden = !session || profile?.active === true;
        const review = window.location.search && new URLSearchParams(window.location.search).get(requiredRole ? 'request' : 'registration-review');
        const validReview = review && /^[a-f0-9-]{36}$/i.test(review);
        const newsletter = window.location.search && new URLSearchParams(window.location.search).get('newsletter');
        const validNewsletter = newsletter && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(newsletter);
        const gradeLink = window.location.search && new URLSearchParams(window.location.search).get('grade-reports');
        const returnToGrades = gradeLink === 'view' || gradeLink === 'emails';
        if (!requiredRole) {
            if (unavailable && returnToGrades && profile?.active && profile.role === 'family') {
                window.location.replace('grade-reports.html' + (gradeLink === 'emails' ? '#grade-email-settings' : ''));
                return;
            }
            if (unavailable && validNewsletter && profile?.active) {
                window.location.replace('portal-communications.html?newsletter=' + encodeURIComponent(newsletter) + '#newsletters');
                return;
            }
            if (unavailable && validReview && isAdminPortalProfile(profile)) {
                window.location.replace('registration-review.html?request=' + encodeURIComponent(review));
            }
            return;
        }
        if (!canOpenPortalPage(requiredRole, profile)) {
            if (gradeReportPage) gradeReportVersion++;
            if (page) page.hidden = true;
            if (pageSignOut) pageSignOut.hidden = true;
            let next = !session && document.body.dataset.portalRegistrationReview && validReview
                ? 'family-portal.html?registration-review=' + encodeURIComponent(review)
                : !session && document.body.dataset.portalNewsletter && validNewsletter
                    ? 'family-portal.html?newsletter=' + encodeURIComponent(newsletter) : 'family-portal.html';
            if (!session && gradeReportPage) {
                next += '?grade-reports=' + (window.location.hash === '#grade-email-settings' ? 'emails' : 'view');
            }
            window.location.replace(next);
            return;
        }
        if (page) page.hidden = false;
        if (pageSignOut) pageSignOut.hidden = false;
        if (displayedUser === session.user.id && displayedRole === profile.role) return;
        displayedUser = session.user.id;
        displayedRole = profile.role;
        if (gradeReportPage) {
            void renderFamilyGradeReportPage(session, profile).then(() => {
                if (window.location.hash === '#grade-email-settings' && !page.hidden) {
                    document.getElementById('grade-email-settings')?.scrollIntoView();
                }
            });
        }
        if (document.body.classList.contains('graduation-planner-page')) void initGraduationPlanner(profile);
    }

    bindPortalLogin();
    bindPortalSignOut();
    const session = await getPortalSession();
    const profile = await getPortalProfile(session);
    showPortal(session, profile);

    let currentUser = session?.user?.id;
    let authChangeVersion = 0;
    if (portalClient) {
        portalClient.auth.onAuthStateChange((_event, nextSession) => {
            const changeVersion = ++authChangeVersion;
            if (currentUser !== nextSession?.user?.id) {
                currentUser = nextSession?.user?.id;
                if (gradeReportPage) gradeReportVersion++;
                togglePortalState(nextSession);
                togglePortalProfileState(null);
                if (unavailable) unavailable.hidden = true;
                if (page) page.hidden = true;
                if (pageSignOut) pageSignOut.hidden = true;
            }
            // Supabase callbacks must release the auth lock before further requests.
            setTimeout(async () => {
                try {
                    const nextProfile = await getPortalProfile(nextSession);
                    if (changeVersion !== authChangeVersion) return;
                    showPortal(nextSession, nextProfile);
                } catch (error) {
                    console.error('Unable to refresh portal access:', error);
                }
            }, 0);
        });
    }
}

if (!isPortalPasswordResetPage) document.addEventListener('DOMContentLoaded', initPortalAuth);
