import assert from 'node:assert/strict';
import { createInquiryPayload, validateInquiry, MAX_STUDENTS } from '../inquiry-data.mjs';

const family = { parentName: ' Test Guardian ', parentEmail: 'guardian@example.test', message: ' Is a future school year possible? ' };
const child = { studentAge: '4, not yet in school' };
const payload = createInquiryPayload(family, [child]);
assert.deepEqual(validateInquiry(payload), [], 'Only the specified required fields are needed');
assert.equal(payload.parentName, 'Test Guardian');
assert.equal(payload.message, 'Is a future school year possible?');
assert.equal(payload.anythingElse, payload.message, 'Legacy neutral notes retain the general message');
assert.equal(payload.students[0].studentName, '');
assert.equal(payload.schoolYear, '');
assert.equal(payload.parentPhone, '');
assert.equal(payload.heardAbout, '');
for (const key of ['lookingFor', 'readHowWeLearn', 'efaPlanning', 'faithQuestions']) {
    assert.equal(Object.hasOwn(payload, key), false, `${key} is no longer submitted`);
}
assert.deepEqual(validateInquiry(createInquiryPayload({}, [{}])), ['parentName', 'parentEmail', 'message', 'students.0.studentAge']);
assert.ok(validateInquiry(createInquiryPayload({ ...family, parentEmail: 'bad-address' }, [child])).includes('parentEmail'));
assert.ok(validateInquiry(createInquiryPayload({ ...family, message: '   ' }, [child])).includes('message'));
const multiple = createInquiryPayload({ ...family, schoolYear: 'Just exploring', parentPhone: '555-0100', heardAbout: 'Other' }, [
    { ...child, studentSubjects: ' Gardening ', studentLearning: ' Quiet time helps ' },
    { studentName: ' Optional name ', studentAge: '9, grade 4' },
    { studentAge: '12, grade 7' }
]);
assert.deepEqual(validateInquiry(multiple), []);
assert.equal(multiple.students.length, MAX_STUDENTS);
assert.equal(multiple.students[0].studentSubjects, 'Gardening');
assert.equal(multiple.students[0].studentLearning, 'Quiet time helps');
assert.equal(multiple.students[1].studentName, 'Optional name');
assert.equal(multiple.schoolYear, 'Just exploring');
assert.equal(multiple.message, payload.message, 'Message is family-level and not repeated for children');
assert.equal(multiple.students.some(s => Object.hasOwn(s, 'message')), false);
assert.ok(validateInquiry(createInquiryPayload(family, [])).includes('students'));
assert.ok(validateInquiry(createInquiryPayload(family, [child, child, child, child])).includes('students'));
assert.deepEqual(validateInquiry(createInquiryPayload(family, [child, {}])), ['students.1.studentAge']);
assert.equal(child.studentName, undefined, 'Serialization does not mutate input records');
console.log('Passed: minimal inquiry, optional values, message compatibility alias, obsolete fields absent, per-child validation, multiple children, limits, and non-mutating serialization.');
