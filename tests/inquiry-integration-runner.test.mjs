import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const base = new URL('../apps-script/inquiry/', import.meta.url);
const handler = await readFile(new URL('Code.gs', base), 'utf8');
const runner = await readFile(new URL('IntegrationTest.gs', base), 'utf8');
const rows = [], emails = [], logs = [];
let created = 0;
const sheet = {
    setName(name) { assert.equal(name, 'Student Inquiry Form (Responses)'); },
    appendRow(row) { rows.push(Array.from(row)); },
    getLastRow() { return rows.length; },
    getRange(start, column, height, width) {
        assert.equal(column, 1); assert.equal(width, 16);
        return { getValues() { return rows.slice(start - 1, start - 1 + height); } };
    }
};
const context = vm.createContext({
    SpreadsheetApp: {
        create(name) {
            assert.match(name, /^ZION inquiry test /); created++;
            return { getUrl() { return 'https://example.test/isolated-sheet'; }, getSheets() { return [sheet]; } };
        },
        getActiveSpreadsheet() { throw Error('Test must never access the production bound sheet'); },
        openById() { throw Error('Test must never open an existing sheet'); },
        flush() {}
    },
    MailApp: { sendEmail(email) { emails.push(email); } },
    console: { log(message) { logs.push(message); } }
});
vm.runInContext(handler, context);
// Make accidental use of the production handler an immediate hard failure.
context.doPost = () => { throw Error('Test must never invoke production doPost'); };
vm.runInContext(runner, context);
const report = context.runInquiryIntegrationTest();
assert.equal(created, 1);
assert.equal(rows.length, 5);
assert.equal(emails.length, 2);
for (const email of emails) {
    assert.equal(email.to, 'admin@zionoutschool.com');
    assert.ok(email.subject.startsWith('[ZION TEST ONLY]'));
    assert.match(email.body, /ISOLATED INTEGRATION TEST/);
}
assert.equal(report.result, 'passed');
assert.equal(report.testStudentRows, 4);
assert.equal(report.invalidInquiriesRejected, 3);
assert.equal(report.productionEndpointCalled, false);
assert.equal(rows[1][5], '');
assert.equal(rows[1][13], '');
assert.equal(rows[2][8], 'Gardening');
assert.equal(rows[2][9], 'Quiet time helps');
assert.equal(rows[3][5], 'TEST CHILD — Optional Name');
assert.ok(logs.some(l => l.includes('https://example.test/isolated-sheet')));
console.log('Passed: integration runner creates only a new isolated sheet, checks saved helpers, targets only the authorized test recipient, and never calls production doPost or opens an existing sheet. All services mocked; live run still pending.');
