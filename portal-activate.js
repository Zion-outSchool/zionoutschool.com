/* global portalClient, getPortalSession, setPortalMessage */

const invitation = new URLSearchParams(location.hash.slice(1));
const invitationToken = invitation.get('type') === 'invite' ? invitation.get('access_token') : null;

document.addEventListener('DOMContentLoaded', async () => {
    const status = document.getElementById('portal-activate-status');
    const form = document.getElementById('portal-activate-form');
    const session = invitationToken ? await getPortalSession() : null;
    if (!session || session.access_token !== invitationToken) {
        setPortalMessage(status, 'Open the invitation link from your email. If it has expired, ask the school to resend it.', 'error');
        return;
    }

    document.getElementById('portal-activate-email').textContent = session.user.email || '';
    setPortalMessage(status, 'Choose a password for your portal account.');
    form.hidden = false;
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const { password, confirm } = form.elements;
        if (password.value !== confirm.value) {
            setPortalMessage(status, 'The passwords do not match.', 'error');
            return;
        }
        const button = form.querySelector('button');
        button.disabled = true;
        try {
            const current = await getPortalSession();
            if (current?.user?.id !== session.user.id) {
                setPortalMessage(status, 'The signed-in account changed. Reopen your invitation.', 'error');
                return;
            }
            const { error } = await portalClient.auth.updateUser({ password: password.value });
            if (error) {
                setPortalMessage(status, error.message, 'error');
                return;
            }
            location.replace('family-portal.html');
        } catch {
            setPortalMessage(status, 'The password could not be saved. Try again.', 'error');
        } finally {
            button.disabled = false;
        }
    });
});
