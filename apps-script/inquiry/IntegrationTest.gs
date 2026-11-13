/**
 * Add as a separate Apps Script file alongside the saved Code.gs.
 * Run runInquiryIntegrationTest from the editor, without deploying.
 * Creates one NEW test spreadsheet and sends two labeled messages ONLY to
 * admin@zionoutschool.com. Never calls doPost or accesses the active sheet.
 */
function runInquiryIntegrationTest() {
  var recipient = 'admin@zionoutschool.com';
  var testId = 'ZION inquiry test ' + new Date().toISOString();
  // Check that the saved handler's helpers exist before creating any artifacts.
  assertInquiryIntegration_(typeof normalizeInquiry_ === 'function' &&
    typeof inquiryRow_ === 'function' && typeof inquiryEmail_ === 'function',
    'Save the prepared Code.gs with its helper functions first.');

  var spreadsheet = SpreadsheetApp.create(testId);
  console.log('TEST SPREADSHEET (no production records): ' + spreadsheet.getUrl());
  var sheet = spreadsheet.getSheets()[0];
  sheet.setName('Student Inquiry Form (Responses)');
  sheet.appendRow([
    'Timestamp', 'Parent Name', 'Parent Email', 'Phone', 'Referral Source',
    'Student Name', 'Age & Grade', 'Legacy Description', 'Interests',
    'Learning Considerations', 'Legacy Context', 'Legacy Reading Status',
    'Legacy Faith Questions', 'School Year', 'Legacy Funding Status', 'Family Message'
  ]);

  var fixtures = [
    {
      label: 'minimal inquiry — optional fields blank',
      data: {
        parentName: 'TEST ONLY — Minimal Inquiry', parentEmail: recipient,
        message: testId + ': Could you explain a future school year?',
        students: [{ studentAge: '4, not yet in school' }]
      }
    },
    {
      label: 'three children — one family message',
      data: {
        parentName: 'TEST ONLY — Multiple Children', parentEmail: recipient,
        schoolYear: 'Just exploring',
        message: testId + ': How would the schedule work for these three children?',
        students: [
          { studentAge: '6, grade 1', studentSubjects: 'Gardening', studentLearning: 'Quiet time helps' },
          { studentName: 'TEST CHILD — Optional Name', studentAge: '9, grade 4' },
          { studentAge: '12, grade 7' }
        ]
      }
    }
  ];
  var notificationsSubmitted = 0;
  fixtures.forEach(function(fixture) {
    // Match the actual frontend's legacy neutral-notes alias.
    fixture.data.anythingElse = fixture.data.message;
    var inquiry = normalizeInquiry_(fixture.data);
    var firstRow = sheet.getLastRow() + 1;
    var timestamp = new Date();
    inquiry.students.forEach(function(student) {
      sheet.appendRow(inquiryRow_(inquiry, student, timestamp));
    });
    SpreadsheetApp.flush();
    var rows = sheet.getRange(firstRow, 1, inquiry.students.length, 16).getValues();
    rows.forEach(function(row, index) {
      assertInquiryIntegration_(row[1] === inquiry.parentName, 'Parent name storage mismatch.');
      assertInquiryIntegration_(row[2] === recipient, 'Parent email storage mismatch.');
      assertInquiryIntegration_(row[5] === inquiry.students[index].studentName, 'Optional name storage mismatch.');
      assertInquiryIntegration_(row[6] === inquiry.students[index].studentAge, 'Age/grade storage mismatch.');
      assertInquiryIntegration_(row[8] === inquiry.students[index].studentSubjects, 'Interests storage mismatch.');
      assertInquiryIntegration_(row[9] === inquiry.students[index].studentLearning, 'Learning context storage mismatch.');
      assertInquiryIntegration_(row[13] === inquiry.schoolYear, 'Optional school year storage mismatch.');
      assertInquiryIntegration_(row[15] === inquiry.message, 'Family message must be stored in column P.');
    });
    var body = inquiryEmail_(inquiry);
    assertInquiryIntegration_(body.split(inquiry.message).length - 1 === 1,
      'Family message must appear exactly once in each email.');
    MailApp.sendEmail({
      to: recipient,
      subject: '[ZION TEST ONLY] ' + fixture.label,
      body: 'ISOLATED INTEGRATION TEST — no production inquiry was created.\n' +
        'Test spreadsheet: ' + spreadsheet.getUrl() + '\n\n' + body
    });
    notificationsSubmitted++;
  });

  // Invalid input must fail normalization before any sheet writes or email.
  var invalid = [
    {},
    { parentName: 'TEST', parentEmail: 'invalid-email', message: 'Test', students: [{ studentAge: '9, grade 4' }] },
    { parentName: 'TEST', parentEmail: recipient, message: 'Test', students: [{ studentAge: '9, grade 4' }, {}] }
  ];
  var rejected = 0;
  invalid.forEach(function(data) {
    try { normalizeInquiry_(data); }
    catch (error) {
      assertInquiryIntegration_(error.name === 'InquiryValidationError', 'Unexpected validation error.');
      rejected++;
    }
  });
  assertInquiryIntegration_(rejected === invalid.length, 'Invalid inquiries were not all rejected.');
  assertInquiryIntegration_(sheet.getLastRow() === 5, 'Expected header plus four test student rows.');
  var report = {
    result: 'passed',
    spreadsheetUrl: spreadsheet.getUrl(),
    testStudentRows: 4,
    invalidInquiriesRejected: rejected,
    notificationRecipient: recipient,
    notificationsSubmitted: notificationsSubmitted,
    deliveryStatus: 'Check the recipient inbox; API acceptance alone does not confirm delivery.',
    coverage: 'Saved helper functions and live Google services; not the deployed web-app endpoint.',
    productionEndpointCalled: false
  };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

function assertInquiryIntegration_(condition, message) {
  if (!condition) throw new Error('Integration test failed: ' + message);
}
