# Enrollment readiness review — November 15, 2026

Implemented locally. Not deployed. No production forms submitted, Google records written, student files created, or emails sent by this work.

## Changes completed

- **Fees:** `/tuition`, `/faq`, `/payment-calendar`, and prospective `/registration` now distinguish the **2026–27 Curriculum Fee ($200/student, including January)** from next year's separate Annual Enrollment & Curriculum Fee. Current coverage, participation-based $135 unit charges, additional ELA/math purchases, confirmation/refund terms, and tuition-credit exclusion are aligned. Tuition remains $600/month; the ten-payment full-year calculation remains $6,740, with family purchases separate and January pricing explicitly individualized.
- **May:** the clearly identified components are $600 May tuition + $534 April carry = **$1,134**. The unexplained $200 is no longer embedded in that displayed tuition subtotal. The row and surrounding notes require separate confirmation of any current-year Curriculum Fee balance under the family's existing agreement. Nothing declares an existing obligation waived or paid. The displayed tuition/unit payments total $6,540; adding a confirmed $200 current-year curriculum obligation would produce the established $6,740 full-year total. This arithmetic does not establish the original May charge's purpose.
- **Next year:** the payment-calendar re-enrollment section uses the approved advance-notice wording. No amount, deadline, waiver, or automatic charge was invented.
- **Parent partnership:** `/what-to-expect` contains the approved heading and four paragraphs, with space to read them. The prospective Parent Agreement, FAQ, and related academic copy welcome concerns, retain parent stewardship, identify teacher responsibility, and direct unresolved concerns to leadership. Daily reading, Friday oversight, attendance communication, and timely replies remain explicit.
- **Accuracy:** accreditation and records answers use the approved wording. Unsupported performance comparisons and transfer/admission assurances were removed. Inquiry and instruction are described as complementary. The universal Fibonacci examples were removed. The fundraising page's scientific-method claim was corrected too. Concrete classroom examples remain, without treating them as schoolwide results.
- **Credentials:** Sandy's faculty and fundraising biographies now state only the approved bachelor's degree in Biology and master's degree in Education. The two-graduate-degrees badge and unsupported specialty/coursework claims are removed. Faculty roles were not reassigned.
- **Enrollment:** Contact explicitly welcomes January 2027 inquiries. The optional Desired start select contains all four approved choices. Its value reaches column P and the plain-text notification in the local inquiry backend; the client also supplies the original neutral-notes alias for compatibility with the supplied older receiver. No spreadsheet columns were added.
- **Navigation/calendar:** header-bearing pages now expose exactly one What to Expect at Zion link. Nine obsolete registration-footer homepage anchors now use existing pages/sections. The unfinished printable-calendar invitation is removed. No January return date was inferred.
- **Accessibility/retry:** 77 existing registration labels are now associated with their controls. Input IDs, field schema, submission destinations, and payloads remain unchanged. A previous submission error is cleared before a valid final-registration retry, preventing it from remaining beside a successful confirmation.

The homepage/banner, paused carousel, existing scripture image, mixed-age explanation, January fresh-unit explanation, laptop requirement and native expandable recommendations, closing invitations, hidden PIAK section, and qualified EFA guidance remain. Source comparison confirmed the homepage and shared CSS are unchanged. Registration's 30-day notice, current-month tuition rule, $300 withdrawal fee, and existing 10% late-fee/5-day grace language remain. No signed agreements, invoices, or historical student records were edited.

## Checks and results

Passed:

- `node tests/inquiry-data.test.mjs`
- `node tests/inquiry-backend.test.mjs`
- `node tests/inquiry-integration-runner.test.mjs`
- `node tests/portal-auth.test.mjs`
- `git diff --check`
- Browser layout checks at **1440px and 390px across 20 reviewed pages**, with one H1 and no horizontal overflow. Inquiry also passed at 768px and 320px. Registration's Parent Agreement and financial-policy steps were checked at desktop/mobile widths.
- All **694 local links and named section anchors** resolve to existing files/IDs. FAQ parent-responsibilities deep linking expands its answer. Shared mobile menus open/close. No JavaScript exceptions were observed across the 20 pages.
- Keyboard-operated laptop and inquiry disclosures; visible 3px button focus; accessible, optional Desired start combobox; all registration controls have labels.
- Inquiry browser mocks cover blank/per-child validation, add/remove/re-add unique IDs, three students, optional fields, Desired start payload/legacy notes, network/server/non-JSON errors retaining entries, pending duplicate-send prevention, and success focus.
- Backend mocks execute the actual local `.gs`: all four desired-start values appear in existing notes and captured email, empty is allowed, unlisted choices are rejected before writes, historical rows stay untouched, and the 16-column contract remains intact.
- Registration browser mocks cover required-field rejection, folder-ID response handling, draft restoration without another folder call, final checklist, server/non-JSON failure recovery, retained folder references, success clearing the draft, and removal of a stale error on retry.

Browser QA blocked Google Apps Script network destinations and replaced form fetches with local responses. These are local checks, not proof of deployed Google services. The owner previously supplied a passing isolated Google integration log (four student rows, three rejected invalid inquiries, two notifications) and confirmed receipt for the earlier version. That run predates Desired start.

## External updates required before release

### Inquiry Apps Script

Local source: [Code.gs](../../apps-script/inquiry/Code.gs), [IntegrationTest.gs](../../apps-script/inquiry/IntegrationTest.gs), and [instructions](../../apps-script/inquiry/README.md).

Owner-supplied editor project: `1FA11sPSVWcIJ0NK_CeUTic7kG9BsK74ldQPPQ83QQvp5RTkUcWcyjaHe`.

Website endpoint, unchanged:
`https://script.google.com/macros/s/AKfycby4UgELLE6qIz3ggT14LKnHjxrgb-PCdqvV5U2Sjgl2nZLkiE18Bl4QAJ9ClG2uNQii/exec`

Remote source and its mapping to that endpoint could not be read back. Apply the updated local Code.gs in the correct bound project, preserve the `Student Inquiry Form (Responses)` tab, A–P column order, and production recipient `hello@zionoutschool.com`. Update the existing web-app deployment when approved; saving alone does not update a versioned deployment. Use the updated isolated runner to verify Desired start in column P and the designated admin test inbox. The frontend legacy alias protects the value with the originally supplied handler, but does not establish the identity or behavior of an unknown deployed receiver.

### Registration document generation

`registration.html` posts step `1` (folder setup) and step `2` (final registration) to:
`https://script.google.com/macros/s/AKfycbx3up73W2Q9DzGzqxMOjW50hzkgaRr0Mm7Rpj2W3--Udy3Am37ENTps9AqusUia7dnEOg/exec`

Its Apps Script source and generated-document templates are not in this repository and were unavailable for inspection. The browser sends field values/signatures, not the complete displayed policy text; changing HTML does **not** update an external document template.

For newly generated documents, update the financial template to match **Section 11** of the local registration form (current-year name, coverage, participating-unit fees, refund terms, separate future-year fee). Update its Parent Agreement template to match **Section 7** (parent stewardship, welcomed observations, teacher decisions, concerns process, and practical responsibilities). Preserve withdrawal/late-payment rules. Version templates for future registrations; do not regenerate or overwrite previously signed documents. Check external processing for legal-status, accreditation, records, and performance wording too. No template IDs can be supplied without the backend source.

### Downloadable policies

Both current links in `documents.html` returned **HTTP 403** on inspection, so their contents and any conflicts could not be verified:

- [Attendance & Tuition Policy 2026–27](https://pub-8e75cf97b77a401381bf81d6b7464bf6.r2.dev/assets/PDFs/ATTENDANCE%20%26%20TUITION%20POLICY%2026_27.pdf)
- [Parent Agreement 2026–27](https://pub-8e75cf97b77a401381bf81d6b7464bf6.r2.dev/assets/PDFs/Parent%20Agreement%2026_27.pdf)

No editable current policy originals were available locally. Connected Drive inspection found older Fusion-branded files, not authoritative editable 2026–27 replacements. Prepare revised prospective versions using the matching local registration sections above, preserve prior signed versions and source history, publish accessible versioned PDFs, and update these two links only when the replacements exist. Confirm access in a signed-out browser and read both PDFs before release. `/documents` also describes the place as held “all year,” whereas the registration introduction describes it as held “all month”; reconcile that wording only after owner policy confirmation.

## Owner decisions and source confirmations

1. **May $200:** confirm whether it is a current-year curriculum balance under an existing agreement or something else. Restore a fixed combined total only when its purpose is documented. The local implementation does not cancel it or assign it to 2027–28.
2. **2027–28:** approve amount, deadline, coverage, refund terms, and any transition arrangement/waiver before announcing or billing them. None is established by this update.
3. **January return:** the linked public Master Calendar ICS lists Christmas break through its Jan. 1 event boundary and an MLK holiday Jan. 18, 2027, but no explicit January return event. A calendar event's exclusive end date is not a confirmed first day back. Supply the authoritative return date before adding it to page copy.
4. **Legal status:** the vague “formal private school registration in process” wording was removed. School leadership must confirm an accurate status description; none was inferred from EFA participation or accreditation work.
5. **Reading target:** existing pages disagreed between 12 and a minimum of 20 books annually. Those counts are omitted until the owner confirms the target by age/grade; OWL study remains described.
6. **Quotations:** four curriculum quotations (C.S. Lewis/first nebula, Columbus/light of the sun, Galileo/language of mathematics, Webster/gift of language) are retained in inert templates, outside rendered content, pending primary-source verification of wording and attribution. Secondary references did not establish original editions/locations; the [MAA discussion of Galileo's wording](https://old.maa.org/press/periodicals/convergence/quotations-in-context-galileo-2) specifically distinguishes the popular paraphrase. Restore only with a checked original source or an accurately identified paraphrase. The “framework meets every student” founder band and “teacher holds the map but does not show it” band are also inactive because they conflict with this brief's fit/instruction guidance. No replacement quotation or founder attribution was invented. Other existing belief statements were not represented as empirically verified results.
7. **Policy versions:** downloaded policies and generated documents still need comparison with the live agreements. The payment calendar describes a due-on-the-8th / late-on-the-13th schedule while registration uses a five-day grace period; preserve these until the owner confirms their relationship and any external differences. Statutory/record-retention claims in registration were not newly validated or rewritten in this copy update.

## Safe end-to-end acceptance checklist — still unverified

Use an isolated spreadsheet, test folders, versioned test templates, and a separate test deployment/recipient configuration. Do not send synthetic registrations to the production endpoint or real families.

- **Inquiry receipt:** submit minimal and multi-child inquiries to that test deployment, with blank and each listed Desired start. Confirm one row per student, correct existing A–P mapping, one copy of the family message plus chosen start in P, and no historical/header changes. Reject invalid input without writes.
- **Staff notification:** route only to the designated test inbox `admin@zionoutschool.com`. Confirm actual delivery, each child's details, the message once, Desired start once, and no blank optional/obsolete prompts. API acceptance alone does not prove inbox delivery.
- **Student folders:** exercise registration step 1 in the isolated deployment. Confirm exactly one student root and expected documents/immunization/IEP/custody folders; returned IDs must match the created folders. Refresh/resume must retain them without creating another root. Use no real medical, custody, or identity documents.
- **Sharing:** inspect every test folder and generated file's permissions. Verify only intended test guardians and authorized staff have access, unrelated accounts are denied, and no unintended public/link access or inherited broad sharing exists.
- **Generated documents:** run step 2, inspect every generated PDF/document and signature/date association. Verify current-year Curriculum Fee/refund terms, participating units, separate future fee, and approved Parent Agreement; compare against the actual revised downloadable PDFs. Old signed documents must remain unchanged.
- **Final confirmation:** verify durable save, staff notification, the test guardian confirmation and attachments, then browser confirmation and draft clearing. Simulate quota, permissions, malformed responses, and mail failures; verify the UI does not claim completion when processing failed.
- **Duplicates/retries:** test rapid clicks, refresh, lost response after a successful server write, and retry after partial completion. Confirm backend idempotency or document the actual manual recovery process. Inquiry's existing write-then-email ordering can leave rows after an email failure; retrying may duplicate them. Registration disables normal submit buttons, but the unavailable server's folder/document duplication controls are unverified. No new server deduplication system was invented.

## Screenshots

| Page | Desktop | Mobile |
| --- | --- | --- |
| Tuition | [1440px](tuition-desktop.png) | [390px](tuition-mobile.png) |
| What to Expect | [1440px](what-to-expect-desktop.png) | [390px](what-to-expect-mobile.png) |
| Payment calendar | [1440px](payment-calendar-desktop.png) | [390px](payment-calendar-mobile.png) |
| Inquiry | [1440px](inquiry-desktop.png) | [390px](inquiry-mobile.png) |
| Registration Parent Agreement | [1440px](registration-step-7-desktop.png) | [390px](registration-step-7-mobile.png) |
| Registration financial terms | [1440px](registration-step-8-desktop.png) | [390px](registration-step-8-mobile.png) |
