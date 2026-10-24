import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

export async function runPortalTests() {
    const source = await readFile(new URL('../supabase-portal.js', import.meta.url), 'utf8');
    let listener;
    let insideAuthCallback = false;
    let profileReads = 0;
    let profile = { role: 'admin', active: true };
    const timers = [];
    const staffControl = { hidden: true };
    const authPanel = { hidden: true };
    const guestPanel = { hidden: false };
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
            querySelector: () => null,
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
    await evaluate('initPortalAuth()');
    assert.equal(typeof listener, 'function');
    const session = { user: { id: 'test-admin', email: 'admin@example.test' } };
    insideAuthCallback = true;
    const callbackResult = listener('SIGNED_IN', session);
    insideAuthCallback = false;
    assert.equal(callbackResult, undefined, 'Auth callback must be synchronous');
    assert.equal(profileReads, 0);
    await timers.shift()();
    assert.equal(staffControl.hidden, false, 'Active staff get staff tools');
    assert.equal(authPanel.hidden, false);
    listener('SIGNED_OUT', null);
    assert.equal(staffControl.hidden, true, 'Sign-out hides staff tools immediately');
    assert.equal(authPanel.hidden, true);
    assert.equal(guestPanel.hidden, false);
    await timers.shift()();
    profile = { role: 'admin', active: false };
    listener('SIGNED_IN', session);
    await timers.shift()();
    assert.equal(staffControl.hidden, true, 'Inactive staff cannot see staff tools');
    profile = { role: 'admin', active: true };
    listener('SIGNED_IN', session);
    const pendingSignIn = timers.shift()();
    listener('SIGNED_OUT', null);
    await pendingSignIn;
    assert.equal(staffControl.hidden, true, 'Stale profile results must not restore staff tools after sign-out');
    await timers.shift()();
    return 'Passed: role checks, deferred auth reads, sign-in, sign-out, inactive staff, and sign-out race.';
}

console.log(await runPortalTests());
