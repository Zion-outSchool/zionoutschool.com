/* Inquiry contract. Keep optional values empty; never invent enrollment or funding answers. */
const clean = value => String(value ?? '').trim();
export const MAX_STUDENTS = 3;

export function createInquiryPayload(fields, students) {
    const message = clean(fields.message);
    const desiredStart = clean(fields.desiredStart);
    return {
        parentName: clean(fields.parentName),
        parentEmail: clean(fields.parentEmail),
        parentPhone: clean(fields.parentPhone),
        heardAbout: clean(fields.heardAbout),
        schoolYear: clean(fields.schoolYear),
        desiredStart,
        students: students.map(student => ({
            studentName: clean(student.studentName),
            studentAge: clean(student.studentAge),
            studentDescribe: '',
            studentSubjects: clean(student.studentSubjects),
            studentLearning: clean(student.studentLearning)
        })),
        message,
        // Preserve both values for older receivers that only store/email neutral notes.
        // The updated backend recognizes this alias and renders each value once.
        anythingElse: desiredStart ? `${message}\n\nDesired start: ${desiredStart}` : message
    };
}

export function validateInquiry(payload) {
    const errors = [];
    if (!payload.parentName) errors.push('parentName');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.parentEmail)) errors.push('parentEmail');
    if (!payload.message) errors.push('message');
    payload.students.forEach((student, index) => {
        if (!student.studentAge) errors.push(`students.${index}.studentAge`);
    });
    if (payload.students.length < 1 || payload.students.length > MAX_STUDENTS) errors.push('students');
    return errors;
}
