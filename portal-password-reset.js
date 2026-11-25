/* global portalClient, setPortalMessage */

const resetRedirect = 'https://zionoutschool.com/portal-password-reset.html';
const resetParams = new URLSearchParams(location.hash.slice(1));
const openedResetLink = resetParams.has('type') || resetParams.has('error') || resetParams.has('error_code');
if (location.hash) history.replaceState(null, '', location.pathname + location.search);

document.addEventListener('DOMContentLoaded', async () => {
    const status = document.getElementById('portal-reset-status');
    const requestForm = document.getElementById('portal-reset-request');
    const passwordForm = document.getElementById('portal-reset-password');
    if (!portalClient) {
        setPortalMessage(status, 'Password reset is unavailable. Refresh the page to try again.', 'error');
        return;
    }

    requestForm.addEventListener('submit', async event => {
        event.preventDefault();
        const button = requestForm.querySelector('button');
        button.disabled = true;
        try {
            await portalClient.auth.resetPasswordForEmail(requestForm.elements.email.value.trim(), {
                redirectTo: resetRedirect
            });
            setPortalMessage(status, 'If this email is registered, you’ll receive a reset link. Check your inbox and spam folder.', 'success');
        } catch {
            setPortalMessage(status, 'We couldn’t request a reset link. Please try again.', 'error');
        } finally {
            button.disabled = false;
        }
    });

    const accessToken = resetParams.get('access_token');
    const refreshToken = resetParams.get('refresh_token');
    let session;
    if (resetParams.get('type') === 'recovery' && accessToken && refreshToken) {
        setPortalMessage(status, 'Checking your reset link…');
        try {
            const { data, error } = await portalClient.auth.setSession({
                access_token: accessToken, refresh_token: refreshToken
            });
            if (!error) session = data.session;
        } catch {
            // Let the user request a fresh link if verification fails.
        }
    }
    if (!session) {
        requestForm.hidden = false;
        if (openedResetLink) {
            setPortalMessage(status, 'This reset link is invalid or expired. Request a new one below.', 'error');
        }
        return;
    }

    document.getElementById('portal-reset-email').textContent = session.user.email || '';
    setPortalMessage(status, 'Choose a new password with at least 8 characters.');
    passwordForm.hidden = false;
    passwordForm.addEventListener('submit', async event => {
        event.preventDefault();
        const { password, confirm } = passwordForm.elements;
        if (password.value !== confirm.value) {
            setPortalMessage(status, 'The passwords do not match.', 'error');
            return;
        }
        const button = passwordForm.querySelector('button');
        button.disabled = true;
        try {
            const { error } = await portalClient.auth.updateUser({ password: password.value });
            if (error) {
                const message = {
                    same_password: 'Choose a password different from your current password.',
                    weak_password: 'Choose a stronger password and try again.',
                    session_not_found: 'This reset session expired. Reload this page to request a new link.'
                }[error.code] || 'We couldn’t save your password. Please try again.';
                setPortalMessage(status, message, 'error');
                return;
            }
            passwordForm.reset();
            passwordForm.hidden = true;
            setPortalMessage(status, 'Your password was updated. Return to the Family Portal to sign in.', 'success');
            await portalClient.auth.signOut({ scope: 'local' });
        } catch {
            if (!passwordForm.hidden) setPortalMessage(status, 'We couldn’t save your password. Please try again.', 'error');
        } finally {
            button.disabled = false;
        }
    });
});
