import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

export async function runPortalTests() {
    const source = await readFile(new URL('../supabase-portal.js', import.meta.url), 'utf8');
    let listener;
    let insideAuthCallback = false;
    let profileReads = 0;
    let profile = { role: 'admin', active: true, display_name: '  Avery Lewis  ' };
    const timers = [];
    const staffControl = { hidden: true };
    const authPanel = { hidden: true };
    const guestPanel = { hidden: false };
    const welcome = { textContent: '' };
    const client = {
        auth: {
            getSession: async () => ({ data: { session: null } }),
            onAuthStateChange: callback => { listener = callback; }
        },
        from: () => {
            assert.equal(insideAuthCallback, false, 'Database reads must run outside the auth callback');
            profileReads++;
            const query = {
                select: () => query,
                eq: () => query,
                maybeSingle: async () => ({ data: profile })
            };
            return query;
        }
    };
    const context = vm.createContext({
        window: { supabase: { createClient: () => client }, location: {} },
        document: {
            addEventListener: () => {},
            body: { dataset: {}, classList: { contains: () => false } },
            querySelector: selector => selector === '[data-portal-welcome]' ? welcome : null,
            querySelectorAll: selector => ({
                '[data-portal-staff]': [staffControl],
                '[data-portal-authenticated]': [authPanel],
                '[data-portal-guest]': [guestPanel]
            })[selector] || []
        },
        setTimeout: callback => { timers.push(callback); },
        console
    });
    vm.runInContext(source, context);
    const evaluate = code => vm.runInContext(code, context);
    for (const role of ['admin', 'teacher', 'staff']) {
        assert.equal(evaluate(`isStaffPortalProfile({ role: '${role}', active: true })`), true);
        assert.equal(evaluate(`isStaffPortalProfile({ role: '${role}', active: false })`), false);
    }
    assert.equal(evaluate("isAdminPortalProfile({ role: 'teacher', active: true })"), false);
    assert.equal(evaluate("isStaffPortalProfile({ role: 'family', active: true })"), false);
    assert.equal(evaluate('isStaffPortalProfile(null)'), false);
    assert.equal(evaluate("canOpenPortalPage('staff', { role: 'family', active: true })"), false);
    assert.equal(evaluate("canOpenPortalPage('gradebook', { role: 'staff', active: true })"), false);
    assert.equal(evaluate("canOpenPortalPage('admin', { role: 'teacher', active: true })"), false);
    assert.equal(evaluate("canOpenPortalPage('gradebook', { role: 'teacher', active: true })"), true);
    assert.equal(evaluate("canOpenPortalPage('active', { role: 'family', active: true })"), true);
    assert.equal(evaluate("canOpenPortalPage('admin', { role: 'admin', active: false })"), false);
    await evaluate('initPortalAuth()');
    assert.equal(typeof listener, 'function');
    assert.equal(welcome.textContent, 'Welcome to the Family Portal');
    const session = { user: { id: 'test-admin', email: 'admin@example.test' } };
    insideAuthCallback = true;
    const callbackResult = listener('SIGNED_IN', session);
    insideAuthCallback = false;
    assert.equal(callbackResult, undefined, 'Auth callback must be synchronous');
    assert.equal(profileReads, 0);
    await timers.shift()();
    assert.equal(staffControl.hidden, false, 'Active staff get staff tools');
    assert.equal(authPanel.hidden, false);
    assert.equal(welcome.textContent, 'Welcome, Avery Lewis!');
    listener('SIGNED_OUT', null);
    assert.equal(staffControl.hidden, true, 'Sign-out hides staff tools immediately');
    assert.equal(authPanel.hidden, true);
    assert.equal(guestPanel.hidden, false);
    assert.equal(welcome.textContent, 'Welcome to the Family Portal', 'Sign-out clears the personal greeting immediately');
    await timers.shift()();
    profile = { role: 'admin', active: false, display_name: 'Inactive User' };
    listener('SIGNED_IN', session);
    await timers.shift()();
    assert.equal(staffControl.hidden, true, 'Inactive staff cannot see staff tools');
    assert.equal(welcome.textContent, 'Welcome to the Family Portal');
    profile = { role: 'admin', active: true };
    listener('SIGNED_IN', session);
    const pendingSignIn = timers.shift()();
    listener('SIGNED_OUT', null);
    await pendingSignIn;
    assert.equal(staffControl.hidden, true, 'Stale profile results must not restore staff tools after sign-out');
    await timers.shift()();
    for (const role of ['teacher', 'family']) {
        evaluate(`togglePortalProfileState({ role: '${role}', active: true, display_name: 'Taylor Lee' })`);
        assert.equal(welcome.textContent, 'Welcome, Taylor Lee!');
    }
    evaluate("togglePortalProfileState({ role: 'teacher', active: true, display_name: ' ' })");
    assert.equal(welcome.textContent, 'Welcome back!');
    return 'Passed: role checks, deferred auth reads, sign-in, sign-out, personal greetings, inactive staff, and sign-out race.';
}

console.log(await runPortalTests());
