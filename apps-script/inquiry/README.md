# Inquiry Apps Script

`Code.gs` is the prepared replacement for the handler supplied by the owner. The owner reports saving it to the remote Apps Script project. Remote source readback remains unavailable; no deployment update has been reported or performed here.

## Verified from the supplied source

- The receiver uses the spreadsheet bound to the script and the tab `Student Inquiry Form (Responses)`.
- It appends one row per child in a 16-column layout, then sends one plain-text family notification to `hello@zionoutschool.com`.
- The original handler had no required-field validation and no visible CAPTCHA, honeypot, rate limiting, or other anti-spam code. No such existing mechanism was removed. External platform settings were not inspected.
- The original neutral `anythingElse` field maps to column P. Thus the frontend’s message alias already reaches that field in the supplied original code, although the original email still uses stale headings and prompts. Live deployment/source correspondence has not been independently verified.

## Changes

The replacement validates parent name, email, a family message, and each child’s combined age/grade field before any writes. It accepts one to three children. Names, phone, school year, referral source, descriptions, interests, and learning considerations are optional. “4, not yet in school” is valid free text.

The general message is read from `message`, falling back to the frontend’s neutral `anythingElse` alias. A final `lookingFor` fallback accepts older form submissions during a transition. Distinct legacy values are retained, not relabeled as the new general message or discarded.

The notification labels the message **Family questions and context**, prints it once, includes every child, and omits empty optional lines. It remains plain text. The admissions recipient is unchanged.

Spreadsheet positions remain:

| Column | Value |
| --- | --- |
| A | Timestamp |
| B–E | Parent name, email, phone, referral source |
| F–J | Student name, age/grade, legacy description, interests, learning considerations |
| K–M | Legacy context, reading status, faith questions if provided by an older client |
| N | Optional school year |
| O | Legacy funding answer if provided by an older client |
| P | General family message, plus distinct legacy extra notes if present |

The handler only appends rows. It does not edit headers, rename/delete columns, clear the sheet, or modify historical records. Text that could be interpreted as a spreadsheet formula is written as literal text. Google documents formula interpretation for spreadsheet values in its [Range reference](https://developers.google.com/apps-script/reference/spreadsheet/range).

Malformed input and missing required fields return the existing JSON error contract. Internal service errors return a generic visitor-facing message. The existing write-then-email ordering is retained: a mail failure can occur after rows were stored, and retrying may produce duplicate rows. Cross-service transaction guarantees and retry deduplication are not added in this focused change.

## Local checks

From the repository root, run:

```sh
node tests/inquiry-backend.test.mjs
node tests/inquiry-data.test.mjs
node tests/portal-auth.test.mjs
```

The backend test executes the actual `.gs` source with mocked `SpreadsheetApp`, `MailApp`, and `ContentService`. It feeds the actual frontend serializer’s payload into `doPost`, captures appended rows and email content, verifies historical rows remain untouched, and exercises optional fields, three children, validation, legacy messages, literal text, and service failures.

These checks do not prove live email delivery, spreadsheet permissions, quotas, runtime configuration, or the mapping from the supplied script project to the website’s `/exec` deployment.

## Applying the change later

Once separately authorized, use this file to replace the supplied inquiry handler in its existing spreadsheet-bound Apps Script project. Preserve unrelated project files and project settings. The original empty `myFunction` stub is unnecessary. Saving source and updating a deployed web-app version are separate operations; no deployed version has been updated here.

Use an isolated test spreadsheet and a specifically configured test recipient before a live release. Verify the received email and stored row, then retain the existing web-app deployment URL/settings when publishing an approved version. Do not run the current handler with synthetic data against the production sheet or admissions address.

## Isolated live test for the designated recipient

The owner designated `admin@zionoutschool.com` for test notifications.

1. Add a separate script file named `IntegrationTest` to the same Apps Script project; paste `IntegrationTest.gs` into it. Keep the saved `Code.gs` in place.
2. Save, select `runInquiryIntegrationTest` in the editor, and run it. Approve the Google permissions required for the test spreadsheet and email if prompted.
3. Inspect the execution log for the new test spreadsheet URL and JSON report. Check that the test spreadsheet contains a header and four student rows and that column P contains the family message.
4. Confirm that `admin@zionoutschool.com` received the two `[ZION TEST ONLY]` notifications: one minimal inquiry and one three-child inquiry. Each notification should contain its family message once.

This runner calls the saved handler’s normalization, row-construction, and notification-template helpers with live Google services. It creates a brand-new spreadsheet; it never uses the bound production spreadsheet, invokes `doPost`, or calls a deployed endpoint. It does not change `Code.gs`, the production recipient, or deployment settings. It logs the isolated sheet URL immediately so it can be found even if a later step fails. Running it again creates another isolated sheet and sends two more labeled test messages.

The runner is locally tested by `node tests/inquiry-integration-runner.test.mjs` with Google services mocked, including hard failures on any production-sheet access or production-handler invocation. **It has not yet been run in Google, and inbox delivery is unverified.** A passing editor run verifies helpers and Google services, not deployed HTTP behavior.
