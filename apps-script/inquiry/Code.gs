/**
 * Replacement for the supplied, spreadsheet-bound inquiry handler.
 * Preserves the existing sheet, recipient, 16-column order, and JSON response.
 * Prepare/review locally; updating a live web-app deployment is a separate step.
 */
function doPost(e) {
  try {
    var data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (error) {
      throw inquiryValidationError_('Please send a valid inquiry.');
    }
    // Validate every child before writing any rows or sending notification email.
    var inquiry = normalizeInquiry_(data);
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = spreadsheet && spreadsheet.getSheetByName('Student Inquiry Form (Responses)');
    if (!sheet) throw new Error('Inquiry response sheet is unavailable.');

    var submittedAt = new Date();
    inquiry.students.forEach(function(student) {
      sheet.appendRow(inquiryRow_(inquiry, student, submittedAt));
    });

    // Keep the existing admissions recipient and plain-text notification format.
    MailApp.sendEmail({
      to: 'hello@zionoutschool.com',
      subject: 'New Student Inquiry — ' + inquiry.parentName.replace(/[\r\n]+/g, ' '),
      body: inquiryEmail_(inquiry)
    });
    return inquiryJson_({ result: 'success' });
  } catch (error) {
    // Do not return internal spreadsheet or mail-service details to the visitor.
    return inquiryJson_({
      result: 'error',
      message: error.name === 'InquiryValidationError'
        ? error.message
        : 'Unable to send your inquiry. Please try again or email hello@zionoutschool.com.'
    });
  }
}

function inquiryValidationError_(message) {
  var error = new Error(message);
  error.name = 'InquiryValidationError';
  return error;
}

function inquiryText_(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw inquiryValidationError_('Please use text for inquiry fields.');
  return value.trim();
}

function normalizeInquiry_(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw inquiryValidationError_('Please send a valid inquiry.');
  }
  var inquiry = {};
  [
    'parentName', 'parentEmail', 'parentPhone', 'heardAbout', 'schoolYear',
    'lookingFor', 'readHowWeLearn', 'faithQuestions', 'efaPlanning', 'anythingElse', 'message'
  ].forEach(function(key) { inquiry[key] = inquiryText_(data[key]); });

  // The new client sends the message and its legacy neutral-notes alias.
  // The lookingFor fallback also accepts in-flight submissions from the old form.
  inquiry.message = inquiry.message || inquiry.anythingElse || inquiry.lookingFor;
  if (!inquiry.parentName) throw inquiryValidationError_('Please enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inquiry.parentEmail)) {
    throw inquiryValidationError_('Please enter a valid email address.');
  }
  if (!inquiry.message) {
    throw inquiryValidationError_('Please tell us what you would like us to know or help you understand.');
  }
  if (!Array.isArray(data.students) || data.students.length < 1 || data.students.length > 3) {
    throw inquiryValidationError_('Please include between one and three students.');
  }
  inquiry.students = data.students.map(function(student) {
    if (!student || typeof student !== 'object' || Array.isArray(student)) {
      throw inquiryValidationError_('Please include each student’s age and current grade.');
    }
    var normalized = {};
    ['studentName', 'studentAge', 'studentDescribe', 'studentSubjects', 'studentLearning'].forEach(function(key) {
      normalized[key] = inquiryText_(student[key]);
    });
    // Keep the existing combined free-text age/grade convention, including
    // entries such as “4, not yet in school.” A student's name is optional.
    if (!normalized.studentAge) {
      throw inquiryValidationError_('Please include each student’s age and current grade, or age and “not yet in school.”');
    }
    return normalized;
  });
  return inquiry;
}

function inquiryNotes_(inquiry) {
  // Preserve distinct legacy notes if an older client supplies both fields.
  if (inquiry.anythingElse && inquiry.anythingElse !== inquiry.message) {
    return inquiry.message + '\n\nAdditional family context:\n' + inquiry.anythingElse;
  }
  return inquiry.message;
}

function inquirySheetText_(value) {
  // User text must remain literal text rather than a spreadsheet formula.
  return typeof value === 'string' && /^[=+\-@]/.test(value) ? "'" + value : value;
}

function inquiryRow_(inquiry, student, submittedAt) {
  // A–P stay in the exact original order. No headers or historical rows change.
  // K/L/M/O retain legacy values only when an old client supplies them.
  // P is the existing neutral “Anything else” column, now holding the message.
  return [
    submittedAt,
    inquiry.parentName,
    inquiry.parentEmail,
    inquiry.parentPhone,
    inquiry.heardAbout,
    student.studentName,
    student.studentAge,
    student.studentDescribe,
    student.studentSubjects,
    student.studentLearning,
    inquiry.lookingFor,
    inquiry.readHowWeLearn,
    inquiry.faithQuestions,
    inquiry.schoolYear,
    inquiry.efaPlanning,
    inquiryNotes_(inquiry)
  ].map(inquirySheetText_);
}

function inquiryEmail_(inquiry) {
  var lines = [
    'New family inquiry from the ZION outSchool website.', '',
    '── PARENT / GUARDIAN ──',
    'Name: ' + inquiry.parentName,
    'Email: ' + inquiry.parentEmail
  ];
  function optional(label, value) {
    if (value) lines.push(label + ': ' + value);
  }
  optional('Phone', inquiry.parentPhone);
  optional('Heard about us', inquiry.heardAbout);
  optional('School year of interest', inquiry.schoolYear);
  lines.push('', '── FAMILY QUESTIONS AND CONTEXT ──', inquiry.message);
  if (inquiry.anythingElse && inquiry.anythingElse !== inquiry.message) {
    lines.push('', 'Additional family context:', inquiry.anythingElse);
  }
  // Retain distinct context from old form submissions without mislabeling the
  // new general message or printing the alias a second time.
  if (inquiry.lookingFor && inquiry.lookingFor !== inquiry.message) {
    lines.push('', 'Earlier form context:', inquiry.lookingFor);
  }
  optional('Faith questions', inquiry.faithQuestions);
  optional('Read How We Learn (earlier form)', inquiry.readHowWeLearn);
  optional('EFA planning (earlier form)', inquiry.efaPlanning);
  inquiry.students.forEach(function(student, index) {
    lines.push('', '── STUDENT ' + (index + 1) + ' ──');
    optional('Name', student.studentName);
    lines.push('Age & Grade: ' + student.studentAge);
    optional('Description', student.studentDescribe);
    optional('Interests / subjects', student.studentSubjects);
    optional('Learning considerations', student.studentLearning);
  });
  return lines.join('\n');
}

function inquiryJson_(result) {
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
