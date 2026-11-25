/* global portalClient, getPortalSession, getPortalProfile, isAdminPortalProfile, setPortalMessage, normalizeStudentName, portalActionMessage, appendTextElement */

async function initPortalAdministration() {
    const byId = id => document.getElementById(id);
    const status = byId('portal-admin-status');
    const panel = byId('portal-admin-panel');
    const invite = byId('portal-admin-invite');
    const studentForm = byId('portal-admin-student');
    const list = byId('portal-admin-students');
    const filter = byId('portal-admin-filter');
    const selection = byId('portal-admin-selection');
    const inviteStatus = byId('portal-admin-result');
    const accountDetails = byId('portal-admin-account-details');
    const linkRepairs = byId('portal-admin-link-repairs');
    const roleNames = { admin: 'Administrator', teacher: 'Teacher', staff: 'Staff', family: 'Family' };
    const picked = new Set();
    let students = [];
    let checkedAccount = null;
    let checkVersion = 0;

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
    function renderAccount() {
        const value = checkedAccount?.record;
        const requested = invite.elements.role.value;
        const mismatch = value?.role && value.role !== requested;
        accountDetails.hidden = !value;
        byId('portal-admin-use-role').hidden = !mismatch || !value.active || !['family', 'teacher'].includes(value.role);
        byId('portal-admin-reactivate').hidden = !value?.role || value.active;
        byId('portal-admin-change-role').hidden = !mismatch || !value.active || !value.confirmed
            || value.is_current_account || value.student_count > 0 || value.course_count > 0;
        if (!value) return;
        byId('portal-admin-account-summary').textContent = [
            value.display_name || checkedAccount.email,
            roleNames[value.role] || 'Portal profile pending',
            value.role ? (value.active ? 'Active' : 'Inactive') : '',
            value.confirmed ? 'Email verified' : 'Email verification pending',
            `${value.student_count} linked students`,
            `${value.course_count} assigned classrooms`
        ].filter(Boolean).join(' · ');
        const guidance = byId('portal-admin-account-guidance');
        if (!value.role) {
            guidance.textContent = 'Submit the invitation to finish setting up this account. Check Resend only if the invitation needs to be sent again.';
        } else if (!value.active) {
            guidance.textContent = 'Reactivate this login to restore its existing access, or use a different email.';
        } else if (value.is_current_account && mismatch) {
            guidance.textContent = 'This is your current login. Use a different email for the invitation to keep your own access.';
        } else if (value.student_count && mismatch) {
            guidance.textContent = 'Move the linked students in Student Records before changing this login’s role.';
        } else if (value.course_count && mismatch) {
            guidance.textContent = 'Reassign the classrooms in the gradebook before changing this login’s role.';
        } else if (!value.confirmed && mismatch) {
            guidance.textContent = 'Have the account owner verify this email before changing its role, or use a different email.';
        } else if (mismatch) {
            guidance.textContent = `This email already signs in as ${roleNames[value.role]}. Use a different email to keep that access, or explicitly switch it to ${roleNames[requested]}. A role change replaces the access this email has now.`;
            if (value.school_admin_email) guidance.textContent += value.school_admin_confirmed
                ? ` A school administrator login with the same name is verified at ${value.school_admin_email}.`
                : ` The school administrator login at ${value.school_admin_email} is still waiting for activation. Verify it works before switching this address to Family.`;
        } else {
            guidance.textContent = requested === 'family' ? 'Select the students to link and submit. An existing link to a different family can be moved in Student Records.'
                : 'This login already has the selected role. Assign its classes in the gradebook.';
        }
    }

    function updateInviteRole() {
        byId('portal-admin-student-picker').hidden = invite.elements.role.value !== 'family';
        renderAccount();
    }

    function showLinkRepairs(code) {
        linkRepairs.replaceChildren();
        if (code === 'PA003') {
            for (const student of students.filter(student => picked.has(student.id) && student.family_id)) {
                const item = appendTextElement(linkRepairs, 'li', '');
                const link = appendTextElement(item, 'a', 'Review family link for ' + normalizeStudentName(student));
                link.href = 'student-records.html?student=' + encodeURIComponent(student.id);
            }
        }
        linkRepairs.hidden = !linkRepairs.childElementCount;
    }

    async function checkAccount(showResult = false) {
        const input = invite.elements.email;
        const email = input.value.trim().toLowerCase();
        if (!email || !input.checkValidity()) {
            if (showResult) input.reportValidity();
            return;
        }
        const version = ++checkVersion;
        const { data, error } = await portalClient.rpc('portal_lookup_account', { target_email: email }).maybeSingle();
        if (version !== checkVersion) return;
        if (error) throw error;
        checkedAccount = data ? { record: data, email } : null;
        renderAccount();
        if (showResult) setPortalMessage(inviteStatus, data
            ? 'Review the account below before continuing.'
            : 'No account uses this email. Complete the name and role to send a new invitation.');
    }

    async function handleAccountAction(button, action, task) {
        if (button.disabled) return;
        button.disabled = true;
        try {
            await action();
        } catch (error) {
            setPortalMessage(inviteStatus, portalActionMessage(error, task, 'Check the email and account details, then try the action again.'), 'error');
        } finally {
            button.disabled = false;
        }
    }

    invite.elements.email.addEventListener('input', () => {
        ++checkVersion;
        checkedAccount = null;
        renderAccount();
    });
    invite.elements.role.addEventListener('change', updateInviteRole);
    byId('portal-admin-check-account').onclick = event => handleAccountAction(event.currentTarget, () => checkAccount(true), 'check this login');
    byId('portal-admin-different-email').onclick = () => {
        invite.elements.email.value = '';
        invite.elements.email.dispatchEvent(new Event('input'));
        invite.elements.email.focus();
        setPortalMessage(inviteStatus, 'Enter the address for this invitation. Your student selection is still here.');
    };
    byId('portal-admin-use-role').onclick = () => {
        if (!checkedAccount) return;
        invite.elements.role.value = checkedAccount.record.role;
        updateInviteRole();
        setPortalMessage(inviteStatus, 'The form now uses this login’s existing role. Review the selection before submitting.');
    };
    byId('portal-admin-reactivate').onclick = event => handleAccountAction(event.currentTarget, async () => {
        if (!checkedAccount) return;
        const { email, record } = checkedAccount;
        if (!window.confirm(`Restore ${roleNames[record.role]} access for ${email}?`)) return;
        const { error } = await portalClient.rpc('portal_reactivate_account', { target_email: email, expected_role: record.role });
        if (error) throw error;
        await checkAccount();
        setPortalMessage(inviteStatus, 'Login reactivated. Review its role before submitting the invitation form.', 'success');
    }, 'reactivate this login');
    byId('portal-admin-change-role').onclick = event => handleAccountAction(event.currentTarget, async () => {
        if (!checkedAccount) return;
        const { email, record } = checkedAccount;
        const newRole = invite.elements.role.value;
        const selected = newRole === 'family' ? students.filter(student => picked.has(student.id)) : [];
        if (newRole === 'family' && !selected.length) {
            setPortalMessage(inviteStatus, 'Select a student first. If the student is missing, create their record above or link their registration in Student Records.', 'error');
            filter.focus();
            return;
        }
        const names = selected.map(normalizeStudentName).join(', ');
        const links = names ? ` Link this login to ${names}.` : '';
        if (!window.confirm(`Change ${email} from ${roleNames[record.role]} to ${roleNames[newRole]}?${links} This removes its current role. If they still need staff access, verify their other login first.`)) return;
        const { data, error } = await portalClient.rpc('portal_change_invitation_role', {
            target_email: email, expected_role: record.role, new_role: newRole, selected_students: selected.map(student => student.id)
        });
        if (error) {
            showLinkRepairs(error.code);
            throw error;
        }
        await checkAccount();
        await loadStudents();
        setPortalMessage(inviteStatus, `Role changed to ${roleNames[newRole]}.${data ? ` Linked ${data} student ${data === 1 ? 'record' : 'records'}.` : ''} The owner can use their existing password.`, 'success');
    }, 'change this login’s role');

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
                setPortalMessage(result, portalActionMessage(error, 'create the student record', 'Check the student names and grade. Search Student Records before creating a duplicate.'), 'error');
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
            setPortalMessage(result, 'Select a student to link. If they’re missing, create their record above or link their registration in Student Records.', 'error');
            return;
        }
        button.disabled = true;
        showLinkRepairs();
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
                setPortalMessage(result, details?.message || 'The invitation request did not finish. Check this email before resending so you can see whether the account was created.', 'error');
                showLinkRepairs(details?.code);
                await checkAccount().catch(() => {});
                return;
            }
            const linked = data.linked ? ` ${data.linked} student ${data.linked === 1 ? 'record linked' : 'records linked'}.` : '';
            const message = data.sent ? 'Invitation sent.' : data.pending ? 'The account has a pending invitation.' : 'Existing account is ready.';
            setPortalMessage(result, message + linked, 'success');
            invite.reset();
            picked.clear();
            checkedAccount = null;
            updateInviteRole();
            try {
                await loadStudents();
            } catch {
                renderStudents();
            }
        } catch {
            setPortalMessage(result, 'The invitation request did not finish. Select Check this email before resending so you can see whether the account was created.', 'error');
        } finally {
            button.disabled = false;
        }
    });

    panel.hidden = false;
    try {
        await loadStudents();
        status.hidden = true;
    } catch {
        setPortalMessage(status, 'The invitation roster could not load. Open Student Records to check the roster, then reload this page before inviting a family.', 'error');
    }
}

document.addEventListener('DOMContentLoaded', initPortalAdministration);
