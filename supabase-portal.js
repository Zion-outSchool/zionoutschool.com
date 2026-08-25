/* ============================================================
   ZION outSchool - Supabase Family Portal
   ============================================================ */

const ZION_SUPABASE_URL = 'https://zwoivkqmnriwtokpbmdo.supabase.co';
const ZION_SUPABASE_KEY = 'sb_publishable_Phy4E8oKXWHcIfJZnDhxAA_DXEAyZ5g';

const portalClient = window.supabase
    ? window.supabase.createClient(ZION_SUPABASE_URL, ZION_SUPABASE_KEY)
    : null;

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

async function initPortalAuth() {
    const session = await getPortalSession();
    togglePortalState(session);

    bindPortalLogin();
    bindPortalSignOut();

    if (document.body.dataset.requiresAuth === 'true' && !session) {
        window.location.href = 'family-portal.html';
        return;
    }

    if (document.body.classList.contains('grade-reports-page')) {
        renderGradeReports(session);
    }

    if (portalClient) {
        portalClient.auth.onAuthStateChange((_event, nextSession) => {
            togglePortalState(nextSession);

            if (document.body.classList.contains('grade-reports-page')) {
                if (nextSession) {
                    renderGradeReports(nextSession);
                } else {
                    window.location.href = 'family-portal.html';
                }
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', initPortalAuth);
