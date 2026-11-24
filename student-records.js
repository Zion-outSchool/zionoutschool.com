/* global portalClient, getPortalSession, getPortalProfile, isAdminPortalProfile,
    setPortalMessage, appendTextElement, formatPortalDate, normalizeStudentName, loadPlannerStudents */

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
    const status = document.getElementById('student-records-status');
    const panel = document.getElementById('student-records');
    const select = document.getElementById('student-records-select');
    const detail = document.getElementById('student-record-detail');
    const linkForm = document.getElementById('student-record-link');
    const session = await getPortalSession();
    const profile = await getPortalProfile(session);
    const admin = isAdminPortalProfile(profile);
    if (!admin && !(profile?.active && profile.role === 'teacher')) {
        setPortalMessage(status, 'Sign in with an administrator or teacher account to open student records.', 'error');
        return;
    }

    let viewVersion = 0;
    let active = true;
    let rows = [];
    portalClient.auth.onAuthStateChange((_event, current) => {
        if (current?.user?.id === session.user.id) return;
        active = false;
        ++viewVersion;
        panel.hidden = true;
        detail.replaceChildren();
        location.replace('family-portal.html');
    });
    document.querySelector('[data-portal-sign-out]').hidden = false;

    async function openRecord() {
        const version = ++viewVersion;
        const id = select.value;
        detail.hidden = true;
        detail.replaceChildren();
        linkForm.hidden = true;
        linkForm.reset();
        if (!id) {
            setPortalMessage(status, rows.length ? 'Choose a registration record.' : 'No registration records are available.');
            return;
        }
        setPortalMessage(status, 'Loading registration…');
        const { data, error } = await portalClient.rpc('read_registration_record', { target_record: id }).maybeSingle();
        if (version !== viewVersion) return;
        if (error || !data) {
            setPortalMessage(status, 'This record could not be opened.', 'error');
            return;
        }
        renderRegistrationDetails(detail, data);
        if (data.student_id) {
            const link = document.createElement('a');
            link.href = 'portal-communications.html?student=' + encodeURIComponent(data.student_id) + '#student-messages';
            link.textContent = 'Open student conversations';
            detail.append(link);
        }
        detail.hidden = false;
        linkForm.hidden = !admin || Boolean(data.student_id);
        setPortalMessage(status, '');
    }

    async function loadRecords(selectedId = '') {
        const { data, error } = await portalClient.rpc('list_registration_records');
        if (error) throw error;
        if (!active) return;
        rows = data;
        select.replaceChildren();
        appendTextElement(select, 'option', 'Choose a student record').value = '';
        for (const record of rows) {
            appendTextElement(select, 'option', [
                record.student_name, `Grade ${record.grade_level}`, formatPortalDate(record.received_at),
                admin && !record.student_id ? 'Needs review' : ''
            ].filter(Boolean).join(' · ')).value = record.id;
        }
        select.value = selectedId;
        await openRecord();
    }

    async function loadRoster() {
        const students = await loadPlannerStudents();
        if (!active) return;
        const roster = linkForm.elements.student_id;
        roster.replaceChildren();
        appendTextElement(roster, 'option', 'Choose an option').value = '';
        appendTextElement(roster, 'option', 'Create a new student').value = 'new';
        for (const student of students) {
            appendTextElement(roster, 'option', [normalizeStudentName(student), student.grade_level && `Grade ${student.grade_level}`]
                .filter(Boolean).join(' · ')).value = student.id;
        }
        roster.required = true;
    }

    select.onchange = () => { void openRecord(); };
    linkForm.addEventListener('submit', async event => {
        event.preventDefault();
        const id = select.value;
        const student = linkForm.elements.student_id.value;
        if (!id || !student) return;
        if (student === 'new' && !window.confirm('Create a new student record from this registration?')) return;
        const button = linkForm.querySelector('[type="submit"]');
        button.disabled = true;
        try {
            const { error } = await portalClient.rpc('link_registration_record', {
                target_record: id, existing_student: student === 'new' ? null : student,
            });
            if (error) throw error;
            if (student === 'new') await loadRoster();
            await loadRecords(select.value === id ? id : select.value);
            setPortalMessage(status, 'Registration linked to the school roster.', 'success');
        } catch (error) {
            setPortalMessage(status, error.code === '22023' ? error.message : 'The registration could not be linked. Reload to check the latest status.', 'error');
        } finally {
            button.disabled = false;
        }
    });

    try {
        if (admin) await loadRoster();
        await loadRecords();
        if (active) panel.hidden = false;
    } catch {
        setPortalMessage(status, 'Student records are unavailable. Try again or contact the school administrator.', 'error');
    }
}

document.addEventListener('DOMContentLoaded', initStudentRecords);
