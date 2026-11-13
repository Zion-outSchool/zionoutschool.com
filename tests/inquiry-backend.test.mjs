import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createInquiryPayload, validateInquiry } from '../inquiry-data.mjs';

const source = await readFile(new URL('../apps-script/inquiry/Code.gs', import.meta.url), 'utf8');
function harness({ noSheet = false, failMail = false, failWrite = false } = {}) {
    const history = [['existing historical record']];
    const emails = [];
    const sheet = { appendRow(row) { if (failWrite) throw Error('private sheet failure'); history.push(Array.from(row)); } };
    const context = vm.createContext({
        SpreadsheetApp: { getActiveSpreadsheet() { return { getSheetByName(name) { assert.equal(name, 'Student Inquiry Form (Responses)'); return noSheet ? null : sheet; } }; } },
        MailApp: { sendEmail(email) { if (failMail) throw Error('private mail failure'); emails.push(email); } },
        ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput(text) { return { setMimeType(type) { assert.equal(type, 'application/json'); return JSON.parse(text); } }; } }
    });
    vm.runInContext(source, context);
    return {
        history, emails,
        submit(data) { return context.doPost({ postData: { contents: JSON.stringify(data) } }); },
        malformed() { return context.doPost({ postData: { contents: 'not-json' } }); }
    };
}
const fields = { parentName: 'Test Guardian', parentEmail: 'guardian@example.test', message: 'May we ask about a future school year?' };
const child = { studentAge: '4, not yet in school' };
const minimal = createInquiryPayload(fields, [child]);
assert.deepEqual(validateInquiry(minimal), []);
let h = harness();
assert.equal(h.submit(minimal).result, 'success');
assert.equal(h.history.length, 2);
assert.deepEqual(h.history[0], ['existing historical record']);
const row = h.history[1];
assert.equal(row.length, 16);
assert.equal(row[1], fields.parentName);
assert.equal(row[2], fields.parentEmail);
assert.equal(row[5], ''); // Student name is genuinely optional.
assert.equal(row[6], child.studentAge);
for (const index of [3, 4, 7, 8, 9, 10, 11, 12, 13, 14]) assert.equal(row[index], '');
assert.equal(row[15], fields.message, 'General message is stored in existing P column');
assert.equal(h.emails.length, 1);
assert.equal(h.emails[0].to, 'hello@zionoutschool.com'); // Captured only; no real MailApp exists here.
assert.equal(h.emails[0].body.split(fields.message).length - 1, 1, 'Message alias is not rendered twice');
assert.match(h.emails[0].body, /FAMILY QUESTIONS AND CONTEXT/);
assert.doesNotMatch(h.emails[0].body, /WHAT THEY ARE LOOKING FOR|EFA planning|Read How We Learn|Description:/);

const three = createInquiryPayload({ ...fields, parentPhone: '555-0100', schoolYear: 'Just exploring', heardAbout: 'Other' }, [
    { ...child, studentSubjects: 'Gardening', studentLearning: 'Quiet time helps' },
    { studentName: 'Optional Name', studentAge: '9, grade 4' },
    { studentAge: '12, grade 7' }
]);
h = harness();
assert.equal(h.submit(three).result, 'success');
assert.equal(h.history.length, 4);
assert.equal(h.emails.length, 1, 'One family notification for three children');
for (const row of h.history.slice(1)) assert.equal(row[15], fields.message);
assert.equal(h.history[1][8], 'Gardening');
assert.equal(h.history[1][9], 'Quiet time helps');
assert.equal(h.history[2][5], 'Optional Name');
assert.match(h.emails[0].body, /STUDENT 3/);
assert.match(h.emails[0].body, /School year of interest: Just exploring/);
assert.match(h.emails[0].body, /Learning considerations: Quiet time helps/);

const invalid = [
    {}, null, [], { ...minimal, parentName: '' }, { ...minimal, parentEmail: 'bad-email' },
    { ...minimal, message: '', anythingElse: '' }, { ...minimal, students: [] },
    { ...minimal, students: [child, child, child, child] }, { ...minimal, students: [{ studentAge: '  ' }] },
    { ...minimal, students: [child, {}] }, { ...minimal, students: {} }, { ...minimal, students: [null] },
    { ...minimal, students: [{ studentAge: { nested: 'no' } }] }, { ...minimal, message: { nested: 'no' } }
];
for (const data of invalid) {
    h = harness();
    assert.equal(h.submit(data).result, 'error');
    assert.equal(h.history.length, 1, 'Validation failure never appends even a partial family');
    assert.equal(h.emails.length, 0);
}
h = harness();
assert.equal(h.malformed().result, 'error');
assert.equal(h.history.length, 1);
assert.equal(h.emails.length, 0);

// Transitional clients retain the neutral alias and all distinct legacy information.
h = harness();
assert.equal(h.submit({ ...minimal, message: undefined }).result, 'success');
assert.equal(h.history[1][15], fields.message);
h = harness();
const old = { parentName: fields.parentName, parentEmail: fields.parentEmail, lookingFor: 'Smaller class', readHowWeLearn: 'Not yet', faithQuestions: 'What is the school foundation?', schoolYear: '2026–2027', efaPlanning: 'Not sure yet', anythingElse: 'Please email me', students: [{ ...child, studentDescribe: 'Enjoys reading' }] };
assert.equal(h.submit(old).result, 'success');
assert.equal(h.history[1][10], old.lookingFor);
assert.equal(h.history[1][11], old.readHowWeLearn);
assert.equal(h.history[1][12], old.faithQuestions);
assert.equal(h.history[1][14], old.efaPlanning);
assert.equal(h.history[1][7], 'Enjoys reading');
assert.match(h.emails[0].body, /Smaller class/);
assert.match(h.emails[0].body, /Please email me/);
h = harness();
assert.equal(h.submit({ ...minimal, anythingElse: 'Distinct extra notes' }).result, 'success');
assert.match(h.history[1][15], /Distinct extra notes/);
assert.match(h.emails[0].body, /Distinct extra notes/);
h = harness();
assert.equal(h.submit(createInquiryPayload({ ...fields, message: '=IMPORTXML("example", "x")' }, [child])).result, 'success');
assert.ok(h.history[1][15].startsWith("'="), 'Message stored as literal text');
assert.ok(h.emails[0].body.includes('=IMPORTXML'), 'Plain-text email keeps the original message');
for (const config of [{ noSheet: true }, { failWrite: true }, { failMail: true }]) {
    h = harness(config);
    const response = h.submit(minimal);
    assert.equal(response.result, 'error');
    assert.doesNotMatch(response.message, /private|sheet failure|mail failure/);
}
console.log('Passed: frontend-to-backend contract, minimal and 3-child inquiries, 16-column storage, untouched history, captured email content, optional fields, legacy compatibility, validation before writes, literal sheet text, and service errors. All Google services mocked; no real emails or records.');
