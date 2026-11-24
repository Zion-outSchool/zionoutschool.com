/* global portalClient, getPortalSession, getPortalProfile, isAdminPortalProfile,
    setPortalMessage, appendTextElement, formatPortalDate, normalizeStudentName, portalActionMessage, createSignedReportUrl */

function appendRegistrationFields(section, fields) {
    const entries = fields.filter(([, value]) => value);
    if (!entries.length) return;
    const list = document.createElement('dl');
    for (const [label, value] of entries) {
        appendTextElement(list, 'dt', label);
        appendTextElement(list, 'dd', value);
    }
    section.appendChild(list);
}

function appendRegistrationContacts(container, heading, contacts) {
    appendTextElement(container, 'h3', heading);
    for (const contact of contacts || []) {
        appendRegistrationFields(container, [
            ['Name', contact.name], ['Relationship', contact.relationship], ['Phone', contact.phone],
            ['Email', contact.email], ['Routine medical permission', contact.medicalPermission],
        ]);
    }
    if (!contacts?.length) appendTextElement(container, 'p', 'No contacts listed.');
}

function renderRegistrationDetails(container, record) {
    container.replaceChildren();
    const info = record.classroom_record;
    appendTextElement(container, 'h2', `${info.firstName} ${info.lastName}`);
    appendRegistrationFields(container, [
        ['Preferred name', info.preferredName], ['Grade', info.gradeLevel],
        ['Registration received', formatPortalDate(record.received_at)],
    ]);

    appendRegistrationContacts(container, 'Parents and guardians', info.guardians);
    appendRegistrationContacts(container, 'Emergency contacts', info.emergencyContacts);
    appendRegistrationContacts(container, 'Authorized pickup', info.authorizedPickup);
    appendRegistrationFields(container, [['Pickup restriction reported', info.pickupRestriction]]);
    if (info.pickupRestriction?.startsWith('Yes')) {
        appendTextElement(container, 'p', 'Confirm pickup arrangements with administration.');
    }

    appendTextElement(container, 'h3', 'School-day safety and permissions');
    appendRegistrationFields(container, [
        ['Life-threatening allergy or condition', info.allergyStatus], ['Emergency allergy instructions', info.allergyInstructions],
        ['Emergency medication', info.emergencyMedication], ['Emergency medication instructions', info.emergencyInstructions],
        ['Emergency treatment consent', info.treatmentConsent], ['Emergency treatment instructions', info.treatmentInstructions],
        ['Photo and media permission', info.mediaConsent],
    ]);

    if (record.administrator_record) {
        const admin = record.administrator_record;
        appendTextElement(container, 'h3', 'Administrator details');
        appendRegistrationFields(container, [
            ['Date of birth', admin.dateOfBirth], ['Previous school', admin.previousSchool],
            ['IEP reported', admin.iepStatus], ['Immunization status', admin.immunizationStatus],
            ['Guardian 1 address', admin.guardianAddresses?.[0]], ['Guardian 2 address', admin.guardianAddresses?.[1]],
            ['School roster', record.student_id ? 'Linked' : 'Needs review'],
        ]);
        if (record.drive_folder_id) {
            const link = appendTextElement(container, 'a', 'Open original registration folder');
            link.href = `https://drive.google.com/drive/folders/${encodeURIComponent(record.drive_folder_id)}`;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        }
    }
}

async function initStudentRecords() {
    const get = id => document.getElementById(id);
    const status = get('student-records-status');
    const panel = get('student-records');
    const search = get('student-records-search');
    const roster = get('student-directory-select');
    const studentDetail = get('student-directory-detail');
    const editor = get('student-directory-edit');
    const reportList = get('student-directory-reports');
    const select = get('student-records-select');
    const detail = get('student-record-detail');
    const linkForm = get('student-record-link');
    const session = await getPortalSession();
    const profile = await getPortalProfile(session);
    const admin = isAdminPortalProfile(profile);
    if (!admin && !(profile?.active && profile.role === 'teacher')) return;

    let students = [];
    let registrations = [];
    let families = [];
    let currentRegistration;
    let registrationError;
    let familyError;
    let active = true;
    let studentVersion = 0;
    let recordVersion = 0;
    const links = () => new URLSearchParams(location.search);
    const initialStudent = links().get('student') || '';

    portalClient.auth.onAuthStateChange((_event, current) => {
        if (current?.user?.id === session.user.id) return;
        active = false;
        panel.hidden = true;
        detail.replaceChildren();
    });

    function option(select, label, value) {
        appendTextElement(select, 'option', label).value = value;
    }

    function message(error, action, next, element = status) {
        setPortalMessage(element, portalActionMessage(error, action, next), 'error');
    }

    async function readPages(query) {
        const entries = [];
        const pageSize = 200;
        for (let start = 0; active; start += pageSize) {
            const { data, error } = await query().range(start, start + pageSize - 1);
            if (error) throw error;
            entries.push(...data);
            if (data.length < pageSize) break;
        }
        return entries;
    }

    async function loadData() {
        const results = await Promise.allSettled([
            readPages(() => portalClient.from('students')
                .select('id, first_name, preferred_name, last_name, grade_level, family_id')
                .order('last_name').order('first_name').order('id')),
            readPages(() => portalClient.rpc('list_registration_records')),
            admin ? readPages(() => portalClient.rpc('portal_list_family_logins')) : Promise.resolve([])
        ]);
        if (results[0].status === 'rejected') throw results[0].reason;
        students = results[0].value;
        registrations = results[1].value || [];
        families = results[2].value || [];
        registrationError = results[1].reason;
        familyError = results[2].reason;
    }

    function setStudentOptions(keep = '') {
        roster.replaceChildren();
        option(roster, admin ? 'Choose a student or review unlinked registrations' : 'Choose a student', '');
        const term = search.value.trim().toLowerCase();
        const matches = students.filter(student => [
            normalizeStudentName(student), student.first_name, student.last_name, student.grade_level
        ].join(' ').toLowerCase().includes(term) || student.id === keep);
        for (const student of matches) option(roster,
            [normalizeStudentName(student), student.grade_level && 'Grade ' + student.grade_level].filter(Boolean).join(' · '), student.id);
        roster.value = keep;
        get('student-directory-count').textContent = matches.length
            ? `${matches.length} ${matches.length === 1 ? 'student' : 'students'}${term ? ' found' : ''}.`
            : term ? 'No students match this search.' : admin ? 'No students have been added to the roster.' : 'No students are assigned to your classrooms yet. Ask an administrator to review your roster.';
    }

    function fillEditor(student) {
        for (const key of ['first_name', 'last_name', 'preferred_name', 'grade_level']) {
            editor.elements[key].value = student[key] || '';
        }
        const familyField = editor.elements.family_id;
        familyField.replaceChildren();
        option(familyField, 'No family login linked', '');
        for (const family of families) {
            if (family.active || family.id === student.family_id) {
                option(familyField, [family.display_name, family.email, !family.active && 'Inactive'].filter(Boolean).join(' · '), family.id);
            }
        }
        if (student.family_id && !families.some(family => family.id === student.family_id)) {
            option(familyField, 'Current family login', student.family_id);
        }
        familyField.value = student.family_id || '';
        familyField.disabled = Boolean(familyError);
        if (familyError) message(familyError, 'load family logins', 'Use Portal Administration to check the login, then reload this page to change the link.', get('student-directory-save-status'));
    }

    async function loadReports(student, version) {
        const column = 'id,title,school_year,term,file_url,storage_bucket,storage_path';
        try {
            const reports = await readPages(() => portalClient.from('grade_reports').select(column)
                .eq('student_id', student.id).eq('status', 'published').order('published_at', {ascending:false}).order('id'));
            if (!active || version !== studentVersion) return;
            if (!reports.length) appendTextElement(reportList, 'li', 'No reports or transcripts have been published for this student.');
            for (const report of reports) {
                const item = appendTextElement(reportList, 'li', '');
                const button = appendTextElement(item, 'button', [report.title, report.school_year, report.term].filter(Boolean).join(' · '));
                button.type = 'button';
                button.onclick = async () => {
                    button.disabled = true;
                    try {
                        const url = await createSignedReportUrl(report);
                        if (!url || new URL(url).protocol !== 'https:') throw new Error('Missing document');
                        if (active && version === studentVersion) location.assign(url);
                    } catch (error) {
                        if (version === studentVersion) message(error, 'open the published file', 'Check that a document was attached to the report, or ask the school administrator for the original.');
                    } finally {
                        button.disabled = false;
                    }
                };
            }
        } catch (error) {
            if (version === studentVersion) message(error, 'load published reports', 'Confirm that the student is still on your roster, then reopen their record.');
        }
    }

    function showStudent(preferredRegistration = '') {
        const version = ++studentVersion;
        const student = students.find(item => item.id === roster.value);
        studentDetail.hidden = !student;
        editor.hidden = !admin;
        reportList.replaceChildren();
        setPortalMessage(get('student-directory-save-status'), '');
        if (student) {
            get('student-directory-name').textContent = normalizeStudentName(student);
            get('student-directory-summary').textContent = [
                student.grade_level && `Grade ${student.grade_level}`,
                admin && (student.family_id ? 'Family login linked' : 'No family login linked')
            ].filter(Boolean).join(' · ');
            get('student-directory-messages').href = 'portal-communications.html?student=' + encodeURIComponent(student.id) + '#student-messages';
            if (admin) fillEditor(student);
            void loadReports(student, version);
        }

        const matching = student ? registrations.filter(record => record.student_id === student.id)
            : admin ? registrations.filter(record => !record.student_id) : [];
        const note = get('student-registration-note');
        select.replaceChildren();
        option(select, student ? 'Choose a linked registration' : 'Choose an unlinked registration', '');
        for (const record of matching) option(select, [
            record.student_name,
            record.grade_level && `Grade ${record.grade_level}`,
            formatPortalDate(record.received_at)
        ].filter(Boolean).join(' · '), record.id);
        select.disabled = !matching.length;
        if (registrationError) {
            note.textContent = portalActionMessage(registrationError, 'load registration records', 'Reload this page. If the roster loads but registrations still fail, ask a school administrator to check the registration sync.');
        } else if (student) {
            note.textContent = matching.length ? 'Select a registration to view its details.' : 'No registration is linked to this student yet.';
        } else {
            note.textContent = admin ? (matching.length ? `${matching.length} awaiting a roster link.` : 'There are no unlinked registrations to review.') : 'Select a student to see their registration.';
        }
        if (matching.some(record => record.id === preferredRegistration)) select.value = preferredRegistration;
        else if (student && matching.length) select.value = matching[0].id;
        void openRegistration();
    }

    async function openRegistration() {
        const version = ++recordVersion;
        const id = select.value;
        currentRegistration = null;
        detail.hidden = true;
        detail.replaceChildren();
        linkForm.hidden = true;
        if (!id) return;
        try {
            const { data, error } = await portalClient.rpc('read_registration_record', { target_record: id }).maybeSingle();
            if (!active || version !== recordVersion) return;
            if (error) throw error;
            if (!data) {
                setPortalMessage(status, 'This registration has moved or you no longer have access. Reload the roster and choose the student again.', 'error');
                return;
            }
            currentRegistration = data;
            renderRegistrationDetails(detail, data);
            detail.hidden = false;
            if (!admin) return;
            const destination = linkForm.elements.student_id;
            destination.replaceChildren();
            option(destination, 'Choose a student', '');
            if (!data.student_id) option(destination, 'Create a new student from this registration', 'new');
            for (const student of students.filter(student => student.id !== data.student_id)) {
                option(destination, [normalizeStudentName(student), student.grade_level && `Grade ${student.grade_level}`]
                    .filter(Boolean).join(' · '), student.id);
            }
            const moving = Boolean(data.student_id);
            get('student-record-link-title').textContent = moving ? 'Correct this registration link' : 'Link to the school roster';
            get('student-record-link-description').textContent = moving
                ? 'Move the registration and its document link to the correct student. This does not change either family login.'
                : 'Choose an existing student or create one with the name and grade on the registration.';
            linkForm.querySelector('button').textContent = moving ? 'Move registration' : 'Link registration';
            linkForm.hidden = false;
        } catch (error) {
            if (version === recordVersion) message(error, 'open the registration', 'Confirm the student is on your roster or reload the list before selecting it again.');
        }
    }

    async function runForm(form, work, onError) {
        const button = form.querySelector('button[type="submit"]');
        if (button.disabled) return;
        button.disabled = true;
        try { await work(); } catch (error) { onError(error); }
        finally { button.disabled = false; }
    }

    search.oninput = () => setStudentOptions(roster.value);
    roster.onchange = () => {
        setPortalMessage(status, '');
        showStudent();
    };
    select.onchange = () => {
        setPortalMessage(status, '');
        void openRegistration();
    };

    editor.onsubmit = event => {
        event.preventDefault();
        if (!admin) return;
        const student = students.find(item => item.id === roster.value);
        if (!student) return;
        const fields = editor.elements;
        const output = get('student-directory-save-status');
        const nextFamily = fields.family_id.value || null;
        const changes = ['first_name', 'last_name', 'preferred_name', 'grade_level']
            .reduce((values, key) => ({ ...values, [key]: fields[key].value.trim() || null }), {});
        if (!changes.first_name || !changes.last_name) {
            setPortalMessage(output, 'Enter the student’s first and last name.', 'error');
            return;
        }
        if (student.family_id !== nextFamily && !familyError) {
            if (!window.confirm(`Change the family login for ${normalizeStudentName(student)}? The previous login will lose access to this student’s records.`)) return;
            changes.family_id = nextFamily;
        }
        void runForm(editor, async () => {
            const update = portalClient.from('students').update(changes).eq('id', student.id);
            const request = student.family_id ? update.eq('family_id', student.family_id) : update.is('family_id', null);
            const { data, error } = await request.select('id').maybeSingle();
            if (error) throw error;
            if (!data) throw { code:'PGRST116' };
            Object.assign(student, changes);
            if (!active || roster.value !== student.id) return;
            setStudentOptions(student.id);
            showStudent(select.value);
            setPortalMessage(output, 'Student record saved.', 'success');
        }, error => message(error, 'save this student record', 'Make sure the family login is still active. If the link changed, reload the record before saving again.', output));
    };

    linkForm.onsubmit = event => {
        event.preventDefault();
        if (!admin || !currentRegistration) return;
        const record = currentRegistration;
        const target = linkForm.elements.student_id.value;
        if (!target) return;
        const targetStudent = students.find(student => student.id === target);
        if (record.student_id && !window.confirm(`Move this registration and its document link to ${normalizeStudentName(targetStudent)}?`)) return;
        if (target === 'new' && !window.confirm('Create a new roster entry from this registration?')) return;
        void runForm(linkForm, async () => {
            const request = record.student_id
                ? portalClient.rpc('move_registration_record', { target_record: record.id, previous_student: record.student_id, next_student: target })
                : portalClient.rpc('link_registration_record', { target_record: record.id, existing_student: target === 'new' ? null : target });
            const { data, error } = await request;
            if (error) throw error;
            const linkedStudent = record.student_id ? target : data;
            try {
                await loadData();
            } catch {
                setPortalMessage(status, 'Link saved. Reload Student Records to see the new placement.', 'success');
                return;
            }
            if (!active) return;
            search.value = '';
            setStudentOptions(linkedStudent);
            showStudent(record.id);
            const savedStudent = students.find(student => student.id === linkedStudent);
            setPortalMessage(status, savedStudent ? 'Registration linked to ' + normalizeStudentName(savedStudent) + '.'
                : 'Registration linked. Reload the roster to see the updated student.', 'success');
        }, error => message(error, 'link the registration', 'Check the selected student and current registration link, then reopen the record before retrying.'));
    };

    try {
        await loadData();
        if (!active) return;
        setStudentOptions(students.some(student => student.id === initialStudent) ? initialStudent : '');
        panel.hidden = false;
        if (initialStudent && !roster.value) {
            setPortalMessage(status, 'That student is no longer on your roster. Choose a student below or ask an administrator to check the assignment.', 'error');
        } else setPortalMessage(status, '');
        showStudent();
    } catch (error) {
        message(error, 'load the student directory', 'Confirm you are signed in with your school account. Teachers can ask an administrator to check their assigned classrooms.');
    }
}

document.addEventListener('DOMContentLoaded', initStudentRecords);
