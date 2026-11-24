/* global portalClient, getPortalSession, getPortalProfile, isAdminPortalProfile, setPortalMessage, normalizeStudentName */

async function initPortalAdministration() {
    const byId = id => document.getElementById(id);
    const status = byId('portal-admin-status');
    const panel = byId('portal-admin-panel');
    const invite = byId('portal-admin-invite');
    const studentForm = byId('portal-admin-student');
    const list = byId('portal-admin-students');
    const filter = byId('portal-admin-filter');
    const selection = byId('portal-admin-selection');
    const picked = new Set();
    let students = [];

    function renderStudents() {
        list.replaceChildren();
        const search = filter.value.trim().toLowerCase();
        for (const student of students) {
            const name = normalizeStudentName(student);
            if (!picked.has(student.id) && !name.toLowerCase().includes(search)) continue;
            const check = document.createElement('input');
            check.type = 'checkbox';
            check.value = student.id;
            check.checked = picked.has(student.id);
            check.addEventListener('change', () => {
                if (check.checked) picked.add(student.id);
                else picked.delete(student.id);
                updateSelection();
            });
            const caption = document.createElement('span');
            caption.textContent = [
                name, student.grade_level ? `Grade ${student.grade_level}` : '',
                student.family_id ? 'Family login linked' : ''
            ].filter(Boolean).join(' · ');
            const label = document.createElement('label');
            label.className = 'portal-account-checkbox';
            label.append(check, caption);
            list.appendChild(label);
        }
        if (!list.childElementCount) list.textContent = 'No matching student records.';
        updateSelection();
    }

    function updateSelection() {
        selection.textContent = picked.size === 1 ? '1 student selected.' : `${picked.size} students selected.`;
    }

    async function loadStudents() {
        const { data, error } = await portalClient.from('students')
            .select('id, first_name, preferred_name, last_name, grade_level, family_id')
            .order('last_name').order('first_name');
        if (error) throw error;
        students = data;
        renderStudents();
    }

    const session = await getPortalSession();
    const profile = await getPortalProfile(session);
    if (!isAdminPortalProfile(profile)) {
        byId('portal-admin-login').hidden = Boolean(session);
        setPortalMessage(status, session ? 'Administrator access is required.' : 'Sign in as an administrator to continue.', 'error');
        return;
    }

    portalClient.auth.onAuthStateChange((_event, nextSession) => {
        if (nextSession?.user?.id === session.user.id) return;
        panel.hidden = true;
        location.replace('family-portal.html');
    });

    document.querySelector('[data-portal-sign-out]').hidden = false;
    filter.addEventListener('input', renderStudents);
    invite.elements.role.addEventListener('change', () => {
        byId('portal-admin-student-picker').hidden = invite.elements.role.value !== 'family';
    });

    studentForm.addEventListener('submit', async event => {
        event.preventDefault();
        const result = byId('portal-admin-student-result');
        const button = studentForm.querySelector('[type="submit"]');
        const fields = studentForm.elements;
        const first = fields.first_name.value.trim();
        const last = fields.last_name.value.trim();
        if (!first || !last) {
            setPortalMessage(result, 'Enter the student’s first and last name.', 'error');
            return;
        }
        button.disabled = true;
        try {
            const { error } = await portalClient.from('students').insert({
                first_name: first, last_name: last, preferred_name: fields.preferred_name.value.trim() || null,
                grade_level: fields.grade_level.value.trim() || null,
            });
            if (error) {
                setPortalMessage(result, 'The student record could not be created. Try again.', 'error');
                return;
            }
            studentForm.reset();
            setPortalMessage(result, 'Student record created.', 'success');
            try {
                await loadStudents();
            } catch {
                setPortalMessage(result, 'Student record created. Reload to refresh the invitation roster.', 'success');
            }
        } finally {
            button.disabled = false;
        }
    });

    invite.addEventListener('submit', async event => {
        event.preventDefault();
        const result = byId('portal-admin-result');
        const button = invite.querySelector('[type="submit"]');
        const fields = invite.elements;
        const role = fields.role.value;
        const studentIds = role === 'family' ? [...picked] : [];
        if (role === 'family' && !studentIds.length) {
            setPortalMessage(result, 'Select at least one student to link.', 'error');
            return;
        }
        button.disabled = true;
        setPortalMessage(result, 'Checking the account…');
        try {
            const { data, error } = await portalClient.functions.invoke('portal-invite', {
                body: {
                    name: fields.display_name.value.trim(), email: fields.email.value.trim(), role,
                    students: studentIds, resend: fields.resend.checked,
                },
            });
            if (error) {
                const details = await error.context?.json?.().catch(() => null);
                setPortalMessage(result, details?.message || 'The invitation service is unavailable. Try again.', 'error');
                return;
            }
            const linked = data.linked ? ` ${data.linked} student ${data.linked === 1 ? 'record linked' : 'records linked'}.` : '';
            const message = data.sent ? 'Invitation sent.' : data.pending ? 'The account has a pending invitation.' : 'Existing account is ready.';
            setPortalMessage(result, message + linked, 'success');
            invite.reset();
            picked.clear();
            byId('portal-admin-student-picker').hidden = false;
            try {
                await loadStudents();
            } catch {
                renderStudents();
            }
        } catch {
            setPortalMessage(result, 'The invitation service is unavailable. Try again.', 'error');
        } finally {
            button.disabled = false;
        }
    });

    try {
        await loadStudents();
        panel.hidden = false;
        status.hidden = true;
    } catch {
        setPortalMessage(status, 'The administrator roster could not load. Refresh and try again.', 'error');
    }
}

document.addEventListener('DOMContentLoaded', initPortalAdministration);
