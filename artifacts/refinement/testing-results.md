# Testing results after the owner saved Code.gs

The owner reports saving the prepared handler to Apps Script. Remote readback and live deployment correspondence could not be verified from this environment.

## Passed locally

- `tests/inquiry-backend.test.mjs`: executes the prepared `.gs` handler with mocked Google services and actual frontend serializer output. Checks the family message in column P and notification content, optional names/year/phone, three-child storage, unchanged historical mock rows, legacy field compatibility, malformed input, validation before writes, and service errors.
- `tests/inquiry-data.test.mjs`: required/optional field contract, general message alias, per-child validation, child limits, and non-mutating serialization.
- `tests/portal-auth.test.mjs`: existing authentication regression checks.
- JavaScript syntax check and `git diff --check`.
- Headless Chrome inquiry form checks at 1440, 768, 390, and 320px: no horizontal overflow.
- Browser keyboard disclosure, accessibility-tree expanded state, first-invalid-field focus, optional student names, required ages for additional children, three children, removal/re-addition without duplicate IDs, optional context in submitted payload, duplicate-send prevention, and success focus.
- Simulated network errors, server rejections, and invalid JSON retain entered data and allow retry.

The browser test blocked Google Apps Script production URLs and replaced submission requests with local mocks. No real email was sent or production record created. The screenshots in this directory were refreshed during the browser run.

## Still pending

Live Google execution, spreadsheet permissions and actual stored rows, actual received notification, and the production endpoint's deployed version have not been tested. The owner designated `admin@zionoutschool.com` as the test recipient. `apps-script/inquiry/IntegrationTest.gs` now provides an editor-run test that creates its own isolated spreadsheet and submits two labeled notifications only to that address. Its isolation and recipient behavior passed local mocked tests. It has not yet run in Google; execution output and inbox confirmation are pending.

No deployment was performed.
