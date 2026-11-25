'use strict';

const CLASSROOM_COURSEWORK_SCOPE = 'https://www.googleapis.com/auth/classroom.coursework.students.readonly';
const CLASSROOM_ROSTER_PERMISSIONS = [
    ['classroom.courses.readonly', 'classes'],
    ['classroom.rosters.readonly', 'rosters']
].map(([scope, label]) => ({ scope: 'https://www.googleapis.com/auth/' + scope, label }));

let classroomIdentityLoad;
function loadClassroomIdentity() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (classroomIdentityLoad) return classroomIdentityLoad;
    classroomIdentityLoad = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.onload = () => window.google?.accounts?.oauth2 ? resolve() : reject(new Error('Google sign-in could not load.'));
        script.onerror = () => {
            script.remove();
            reject(new Error('Google sign-in could not load.'));
        };
        document.head.append(script);
    }).catch(error => {
        classroomIdentityLoad = null;
        throw error;
    });
    return classroomIdentityLoad;
}

async function classroomRows(path, key, query, token) {
    const url = new URL('https://classroom.googleapis.com/v1/' + path);
    url.search = new URLSearchParams({ pageSize: '100', ...query });
    const rows = [];
    const seenPages = new Set();
    for (;;) {
        const response = await fetch(url, {
            headers: { Authorization: 'Bearer ' + token },
            credentials: 'omit',
            redirect: 'error',
            signal: AbortSignal.timeout(20000)
        });
        if (response.status === 401) throw new Error('Your Google session expired. Connect Google Classroom again.');
        if (response.status === 403) {
            const { error } = await response.json().catch(() => ({}));
            const scopeDenied = error?.details?.some(detail => detail.reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')
                || error?.errors?.some(detail => detail.reason === 'insufficientPermissions')
                || /insufficient authentication scopes/i.test(error?.message || '');
            if (scopeDenied && path.includes('/courseWork')) {
                const failure = new Error('Google Classroom rejected access to coursework and grades. Choose Grant coursework and grades access to request it on its own.');
                failure.code = 'COURSEWORK_SCOPE';
                throw failure;
            }
            throw new Error('Google denied access. Choose the account that teaches this class or check with your Google Workspace administrator.');
        }
        if (!response.ok) throw new Error('Google Classroom couldn’t load. Try again in a moment.');
        const page = await response.json();
        rows.push(...(page[key] || []));
        const next = page.nextPageToken;
        if (!next) return rows;
        if (seenPages.has(next)) throw new Error('Google returned an incomplete class. Try loading it again.');
        seenPages.add(next);
        url.searchParams.set('pageToken', next);
    }
}

function classroomDueDate(date) {
    if (!date?.year || !date.month || !date.day) return null;
    return [date.year, String(date.month).padStart(2, '0'), String(date.day).padStart(2, '0')].join('-');
}

function classroomWorkItem(work) {
    const points = Math.round(work.maxPoints * 100) / 100;
    if (work.state !== 'PUBLISHED' || work.assigneeMode === 'INDIVIDUAL_STUDENTS'
        || !Number.isFinite(points) || points <= 0 || points > 9999999.99 || !work.title?.trim()) return null;
    return { source_id: work.id, title: work.title.trim().slice(0, 120), points, due_on: classroomDueDate(work.dueDate) };
}

function classroomReturnedScore(submission) {
    if (submission.state !== 'RETURNED' || !Number.isFinite(submission.assignedGrade)
        || submission.assignedGrade < 0 || !Number.isFinite(Date.parse(submission.updateTime))) return null;
    return {
        source_id: submission.courseWorkId, google_student: submission.userId,
        score: Math.round(submission.assignedGrade * 100) / 100, updated_at: submission.updateTime
    };
}

function initGradebookGoogleImport({ runImport, reload, canManageRoster, openRoster }) {
    const byId = suffix => document.getElementById('gradebook-google-' + suffix);
    const panel = document.getElementById('gradebook-google');
    const status = byId('status');
    const connect = byId('connect');
    const picker = byId('class-picker');
    const classInput = byId('class');
    const rosterView = byId('roster');
    const workView = byId('work');
    const preview = byId('preview');
    const selectAll = byId('select-all');
    const rosterButton = byId('open-roster');
    const rosterHelp = byId('roster-help');
    const importButton = preview.querySelector('button[type="submit"]');
    const readiness = byId('import-readiness');
    const report = (message, tone) => setPortalMessage(status, message, tone);
    let course;
    let roster = [];
    let context;
    let sessionToken;
    let googleClasses = new Map();
    let snapshot;
    let version = 0;
    let classVersion = 0;
    let courseworkOnly = false;

    function addOption(select, title, value) {
        const option = appendTextElement(select, 'option', title);
        option.value = value;
    }

    function clearPreview() {
        preview.hidden = true;
        rosterView.replaceChildren();
        workView.replaceChildren();
        snapshot = null;
        readiness.textContent = '';
        selectAll.textContent = 'Select all eligible assignments';
    }

    async function prepare() {
        if (!course || context || !panel.open) return;
        const turn = version;
        connect.disabled = true;
        report('Checking the school’s Google Classroom connection…');
        try {
            const { data, error } = await portalClient.rpc('gradebook_google_context', { target_course: course.id });
            if (turn !== version) return;
            if (error) throw error;
            context = data ?? {};
            if (!context.client_id) {
                report('Google Classroom setup is pending. Ask the school’s portal administrator to enable the connection.');
                return;
            }
            await loadClassroomIdentity();
            if (turn !== version) return;
            connect.disabled = false;
            report(context.source_name ? 'Linked to ' + context.source_name + '. Connect your Google account to check for new grades.'
                : 'Sign in with the Google account you teach with. Imports run when you choose them.');
        } catch (error) {
            if (turn !== version) return;
            context = null;
            report(['PGRST202', '42883'].includes(error.code)
                ? 'Google Classroom setup is pending. Ask the school’s portal administrator to enable it.'
                : (error.message || 'Google Classroom couldn’t load.'), 'error');
        }
    }

    function configure(nextCourse, nextRoster) {
        const changed = !nextCourse || nextCourse.id !== course?.id;
        course = nextCourse;
        roster = nextRoster;
        panel.hidden = !course;
        if (!changed) {
            if (snapshot) {
                for (const [id, input] of snapshot.inputs) refreshStudentOptions(id, input);
                updateImportAvailability();
            }
            return;
        }
        version++;
        classVersion++;
        context = null;
        sessionToken = null;
        courseworkOnly = false;
        googleClasses.clear();
        classInput.replaceChildren();
        picker.hidden = true;
        clearPreview();
        connect.disabled = true;
        connect.textContent = 'Connect Google Classroom';
        report('');
        if (!course) panel.open = false;
        else if (panel.open) void prepare();
    }

    async function loadClasses(token, turn, previousClass) {
        const rows = await classroomRows('courses', 'courses', {
            teacherId: 'me', fields: 'nextPageToken,courses(id,name,section)'
        }, token);
        if (turn !== version) return;
        googleClasses = new Map(rows.map(item => [item.id, item]));
        classInput.replaceChildren();
        addOption(classInput, 'Choose a class', '');
        for (const item of rows) {
            if (!context.source_course || item.id === context.source_course) {
                addOption(classInput, [item.name, item.section].filter(Boolean).join(' · '), item.id);
            }
        }
        picker.hidden = classInput.options.length < 2;
        if (picker.hidden) {
            report(context.source_course ? 'This Google account does not teach the linked class. Connect a different Google account.'
                : 'Google found no classes you teach.');
            return;
        }
        const selected = context.source_course || (googleClasses.has(previousClass) ? previousClass : '');
        if (selected) {
            classInput.value = selected;
            await loadClass();
        } else {
            report('Choose the Google class that matches this Zion gradebook.');
        }
    }

    connect.onclick = () => {
        if (!context?.client_id) return;
        const previousClass = courseworkOnly ? classInput.value : '';
        const turn = ++version;
        classVersion++;
        sessionToken = null;
        picker.hidden = true;
        clearPreview();
        connect.disabled = true;
        report('Complete Google’s permission screen, then return to the gradebook.');
        function requestPermissionReview() {
            connect.textContent = 'Review Google permissions';
        }
        function failed(error) {
            if (turn !== version) return;
            report(error.message || 'The Google connection was interrupted. Try connecting again.', 'error');
            connect.disabled = false;
        }
        try {
            const oauth = window.google.accounts.oauth2;
            const scope = courseworkOnly ? CLASSROOM_COURSEWORK_SCOPE
                : [...CLASSROOM_ROSTER_PERMISSIONS.map(permission => permission.scope), CLASSROOM_COURSEWORK_SCOPE].join(' ');
            const client = oauth.initTokenClient({
                client_id: context.client_id,
                scope,
                include_granted_scopes: courseworkOnly,
                error_callback: error => {
                    if (turn !== version) return;
                    requestPermissionReview();
                    failed(new Error(error.type === 'popup_failed_to_open'
                        ? 'Your browser blocked the Google window. Allow pop-ups for zionoutschool.com and try again.'
                        : 'The Google window closed before returning permissions. Choose Review Google permissions to open it again.'));
                },
                callback: async response => {
                    if (turn !== version) return;
                    if (response.error === 'access_denied') {
                        requestPermissionReview();
                        failed(new Error('Google denied access. Review the permissions with the Google account that teaches the class.'));
                        return;
                    }
                    if (response.error || !response.access_token) {
                        const code = /^[a-z0-9_]{1,50}$/.test(response.error ?? '') ? ' (' + response.error + ')' : '';
                        failed(new Error('Google sign-in did not finish' + code + '. Try again or share this message with your portal administrator.'));
                        return;
                    }
                    const missing = CLASSROOM_ROSTER_PERMISSIONS.filter(permission =>
                        !oauth.hasGrantedAllScopes(response, permission.scope)).map(permission => permission.label);
                    if (missing.length) {
                        courseworkOnly = false;
                        requestPermissionReview();
                        failed(new Error('Google did not grant access to ' + missing.join(', ') + '. Choose Review Google permissions to try again.'));
                        return;
                    }
                    // Google's consent receipt can use a differently reported scope. The coursework API checks access.
                    courseworkOnly = false;
                    connect.textContent = 'Connect Google Classroom';
                    sessionToken = response.access_token;
                    report('Loading classes from Google…');
                    try { await loadClasses(sessionToken, turn, previousClass); }
                    catch (error) { failed(error); }
                    finally { if (turn === version) connect.disabled = false; }
                }
            });
            client.requestAccessToken({ prompt: 'select_account consent' });
        } catch (error) { failed(error); }
    };

    function refreshStudentOptions(id, select) {
        const previous = select.value;
        const saved = context.matches?.[id];
        const hasSavedMatch = roster.some(enrollment => enrollment.id === saved);
        select.replaceChildren();
        addOption(select, roster.length ? 'Skip this student' : 'No students enrolled in this Zion course', '');
        for (const enrollment of roster) addOption(select, enrollment.name, enrollment.id);
        select.value = hasSavedMatch ? saved : roster.some(enrollment => enrollment.id === previous) ? previous : '';
        select.disabled = hasSavedMatch || !roster.length;
    }

    function updateImportAvailability() {
        if (!snapshot) return;
        const matches = [...snapshot.inputs.values()].map(input => input.value).filter(Boolean);
        const hasSelection = Boolean(preview.querySelector('[name="assignment"]:checked'));
        const managesRoster = canManageRoster();
        let reason = '';
        if (!roster.length) {
            reason = managesRoster
                ? 'This Zion course has no students. Add existing Zion student records to the course before importing grades.'
                : 'This Zion course has no students. Ask a portal administrator to add them before importing.';
        } else if (!snapshot.inputs.size) reason = 'Google did not return any students for this class.';
        else if (!snapshot.workItems.length) reason = 'Google did not return any eligible assignments for this class.';
        else if (!matches.length) reason = 'Match at least one Google student to a Zion student.';
        else if (new Set(matches).size !== matches.length) reason = 'Choose a different Zion student for each match.';
        else if (!hasSelection) reason = 'Select at least one assignment.';
        else if (!preview.elements.category.value) reason = 'Choose a gradebook category.';
        rosterHelp.textContent = roster.length
            ? 'Match each Google student to their existing record in this Zion course.'
            : reason;
        rosterButton.hidden = Boolean(roster.length) || !managesRoster;
        importButton.disabled = Boolean(reason);
        readiness.textContent = reason;
    }

    function renderPreview(googleStudents, work, submissions) {
        const workItems = work.map(classroomWorkItem).filter(Boolean);
        const workIds = new Set(workItems.map(item => item.source_id));
        const scoresByWork = new Map();
        for (const score of submissions.map(classroomReturnedScore).filter(Boolean)) {
            if (!workIds.has(score.source_id)) continue;
            const items = scoresByWork.get(score.source_id) || [];
            items.push(score);
            scoresByWork.set(score.source_id, items);
        }
        const students = new Map(googleStudents.map(student => [student.userId, student.profile?.name?.fullName || 'Google student']));
        const inputs = new Map();
        rosterView.className = 'gradebook-google-match-grid';
        for (const [id, name] of students) {
            const label = appendTextElement(rosterView, 'label', name);
            const select = appendTextElement(label, 'select', '');
            refreshStudentOptions(id, select);
            inputs.set(id, select);
        }

        const category = preview.elements.category;
        category.replaceChildren();
        const categories = Object.keys(course.categories);
        if (categories.length > 1) addOption(category, 'Choose a category', '');
        for (const name of categories) addOption(category, name, name);

        for (const item of workItems) {
            const block = appendTextElement(workView, 'div', '', 'gradebook-google-work-item');
            const label = appendTextElement(block, 'label', '');
            const checkbox = appendTextElement(label, 'input', '');
            checkbox.type = 'checkbox';
            checkbox.name = 'assignment';
            checkbox.value = item.source_id;
            label.append([item.title, item.points + ' points', item.due_on && formatPortalDate(item.due_on + 'T12:00:00')].filter(Boolean).join(' · '));
            const scores = scoresByWork.get(item.source_id) || [];
            const details = appendTextElement(block, 'details', '');
            appendTextElement(details, 'summary', scores.length + (scores.length === 1 ? ' returned grade' : ' returned grades'));
            details.addEventListener('toggle', () => {
                if (!details.open || details.children.length > 1) return;
                if (!scores.length) {
                    appendTextElement(details, 'p', 'No returned grades yet.');
                    return;
                }
                const list = appendTextElement(details, 'ul', '');
                for (const score of scores) {
                    appendTextElement(list, 'li', (students.get(score.google_student) || 'Google student') + ' · ' + score.score);
                }
            });
        }
        const excluded = work.length - workItems.length;
        byId('exclusions').textContent = excluded ? excluded + ' assignments were excluded because they are ungraded, individually assigned, or outside Zion’s point limits.' : '';
        selectAll.disabled = !workItems.length;
        if (!students.size) appendTextElement(rosterView, 'p', 'Google did not return a student roster.');
        if (!workItems.length) appendTextElement(workView, 'p', 'No eligible assignments were found.');
        snapshot = { inputs, workItems, scoresByWork, source: googleClasses.get(classInput.value) };
        updateImportAvailability();
        preview.hidden = false;
    }

    async function loadClass() {
        const turn = version;
        const selection = ++classVersion;
        clearPreview();
        if (!classInput.value || !sessionToken) return;
        const path = 'courses/' + encodeURIComponent(classInput.value) + '/';
        report('Loading the Google roster, assignments and returned grades…');
        try {
            const [students, work, submissions] = await Promise.all([
                classroomRows(path + 'students', 'students', { fields: 'nextPageToken,students(userId,profile(name(fullName)))' }, sessionToken),
                classroomRows(path + 'courseWork', 'courseWork', {
                    courseWorkStates: 'PUBLISHED', fields: 'nextPageToken,courseWork(id,title,maxPoints,dueDate,state,assigneeMode)'
                }, sessionToken),
                classroomRows(path + 'courseWork/-/studentSubmissions', 'studentSubmissions', {
                    states: 'RETURNED', fields: 'nextPageToken,studentSubmissions(courseWorkId,userId,state,assignedGrade,updateTime)'
                }, sessionToken)
            ]);
            if (turn !== version || selection !== classVersion) return;
            renderPreview(students, work, submissions);
            report('Match the roster and preview the returned grades before importing.');
        } catch (error) {
            if (turn !== version || selection !== classVersion) return;
            if (error.code === 'COURSEWORK_SCOPE') {
                courseworkOnly = true;
                connect.textContent = 'Grant coursework and grades access';
            }
            report(error.message || 'Couldn’t load this Google class.', 'error');
        }
    }

    panel.addEventListener('toggle', prepare);
    classInput.onchange = loadClass;
    preview.addEventListener('change', updateImportAvailability);
    rosterButton.onclick = openRoster;
    selectAll.onclick = () => {
        const choices = [...preview.querySelectorAll('[name="assignment"]')];
        const checked = !choices.every(choice => choice.checked);
        for (const choice of choices) choice.checked = checked;
        selectAll.textContent = checked ? 'Clear assignment selection' : 'Select all eligible assignments';
        updateImportAvailability();
    };
    preview.onsubmit = event => {
        event.preventDefault();
        if (!snapshot) return;
        const selected = new Set(new FormData(preview).getAll('assignment'));
        const matches = Object.fromEntries([...snapshot.inputs].filter(([, input]) => input.value).map(([id, input]) => [id, input.value]));
        if (!selected.size || !Object.keys(matches).length) {
            report('Match at least one student and select at least one assignment.', 'error');
            return;
        }
        if (new Set(Object.values(matches)).size !== Object.keys(matches).length) {
            report('Choose a different Zion enrollment for each Google student.', 'error');
            return;
        }
        const selectedWork = snapshot.workItems.filter(item => selected.has(item.source_id));
        const scores = selectedWork.flatMap(item => (snapshot.scoresByWork.get(item.source_id) || []).filter(score => matches[score.google_student]));
        if (selectedWork.length > 500 || scores.length > 10000) {
            report('Select fewer assignments to split this import into smaller groups.', 'error');
            return;
        }
        const courseId = course.id;
        const source = snapshot.source;
        const turn = version;
        const payload = {
            target_course: courseId, google_course: source.id, google_name: source.name.slice(0, 250),
            matched_students: matches, target_category: preview.elements.category.value,
            selected_assignments: selectedWork, returned_scores: scores
        };
        void runImport(async () => {
            report('Importing selected assignments and grades…');
            const { data, error } = await portalClient.rpc('gradebook_google_import', payload);
            if (turn !== version || !snapshot) return;
            if (error) {
                report(portalActionMessage(error, 'import the grades', 'Check the class, roster matches and selected assignments.'), 'error');
                return;
            }
            context = { ...context, source_course: source.id, source_name: source.name, matches: { ...context.matches, ...matches } };
            for (const [id, input] of snapshot.inputs) if (Object.hasOwn(matches, id)) input.disabled = true;
            for (const option of [...classInput.options]) if (option.value && option.value !== source.id) option.remove();
            const count = (amount, noun) => amount + ' ' + noun + (amount === 1 ? '' : 's');
            const result = [
                count(data.new_assignments, 'assignment') + ' added', count(data.updated_scores, 'grade') + ' saved',
                count(data.skipped_assignments, 'assignment') + ' skipped', count(data.skipped_scores, 'grade') + ' skipped or already current'
            ].join(' · ');
            try {
                await reload(courseId);
                if (turn === version) report(result, 'success');
            } catch {
                if (turn === version) report(result + '. Refresh the page to see the imported grades.', 'success');
            }
        });
    };
    return { configure };
}
