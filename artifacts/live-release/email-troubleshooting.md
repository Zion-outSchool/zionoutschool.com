# Missing isolated-test email

The owner reports that Apps Script Executions shows only a `doPost` web-app execution today and no `runInquiryIntegrationTest` execution.

The isolated test runner therefore has not been confirmed to run. Deploying the project does not itself invoke that runner. In the supplied/prepared source:

- `Code.gs` → `doPost` sends admissions notifications to `hello@zionoutschool.com`.
- `IntegrationTest.gs` → `runInquiryIntegrationTest` sends two labeled test messages to the designated `admin@zionoutschool.com` address, while writing only to a newly created test spreadsheet.

The observed absence of a test-runner execution explains why its two emails should not yet be expected. It does not establish an email-delivery fault. The status/outcome of the reported production `doPost` execution remains unknown.

Connected Drive search found no accessible spreadsheet with the test runner’s `ZION inquiry test` name. This is corroborating but not conclusive because the connected account may differ from the executing account. Gmail tools requested authentication; no successful mailbox search result was obtained, so no inbox/delivery conclusion is based on Gmail.

Next action: add/save `IntegrationTest.gs` alongside `Code.gs`, select `runInquiryIntegrationTest` in the editor and run it. Review the execution log and its isolated spreadsheet URL. If it fails, capture the exact error. If it passes with two notifications submitted but neither arrives, investigate the designated mailbox and mail routing using those execution details.

No new email, production submission, or deployment was performed during troubleshooting.
