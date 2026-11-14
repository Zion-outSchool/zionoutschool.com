# Tuition, January enrollment, and preparation update

Implemented locally on November 14, 2026. **Nothing was published or deployed.**

## Pages changed

| Page | Change |
| --- | --- |
| `tuition.html` | Restructured into the requested nine sections, with the supplied copy, current-year fee explanations and full-year calculation, January-entry guidance, qualified EFA information, need-based scholarship link, included/purchased comparison, future-year notice, and inquiry-first invitation. |
| `what-to-expect.html` | New practical overview with daily life, midyear sequence, and preparation anchors. No existing overview route was found; the detailed FAQ and scrub guide remain the sources for their longer explanations. |
| `payment-calendar.html` | Preserved every current-year schedule cell. Added school-year context, a January-entry explanation, and a separate 2027–28 advance notice below the schedule. Removed the old prose asserting a $200 commitment for the coming year. |
| `faq.html` | Updated the funding cluster to remove expired deadlines, guaranteed coverage, $468 balances, and PIAK-availability implications. Added useful deep-link anchors to existing schedule and parent-responsibility answers. Other FAQ content remains. |
| `foundation.html` | Received the existing extended scripture-annotation explanation, with a new anchor. |
| `scrub-ordering.html` | Retained ordering/embroidery instructions and replaced the automatic-reimbursement instruction with a requirement to confirm funding and purchasing rules first. |
| `documents.html` | Added a tuition-policy card anchor and its scroll offset; retained existing policy files and links. |
| `scholarship-assistance.html` | Removed PIAK from the optional other-funding placeholder. Field name, validation, file upload, payload, and backend are unchanged. |
| `index.html` | Added What to Expect under Join ZION only. The homepage announcement, copy, layout, and styles are unchanged. |

What to Expect is also linked in the relevant existing navigation on tuition, payment calendar, FAQ, Foundation, Documents, and the scrub guide. `family-info.css` contains the scoped page styling; established colors, fonts, and shared navigation behavior remain.

## Content moved

- Laptop requirements, ASUS Vivobook and Acer Chromebook Plus recommendations, original images, and purchase links: `/tuition` → `/what-to-expect#technology`.
- Approved RMF scrub styles, vendor links, student-uniform image, and link to detailed embroidery/logo instructions: `/tuition` → `/what-to-expect#uniforms`. The existing `/scrub-ordering` guide retains the authoritative detailed instructions and related images; no second ordering process was created.
- Verified note that Zion provides its personal supply list before term: `/what-to-expect#personal-supplies`. No actual supply list was found in the repository, so no itemized list was invented. Families can ask for the current list through the existing inquiry form.
- Extended scripture-annotation explanation and existing scripture-partner link: `/tuition` → `/foundation#scripture-annotation`. Tuition still lists the scripture set as included; What to Expect briefly summarizes and links to the explanation.
- Old PIAK tuition implementation: retained in inert `template#tuition-piak-paused`, outside the live document and accessibility tree. It is not rendered and makes no public availability claim on tuition.

## Owner decisions and related changes still needed

1. **Confirm the $200 fee’s curriculum-cost sufficiency.** The requested 2026–27 amount remains $200. Confirm that it supports the stated initial ELA and mathematics curricula plus full-year science/history resources. No increase or next-year price was invented.
2. **Resolve the existing May schedule entry.** `payment-calendar.html:177–178` still shows **$1,334**, including **$200 enrollment commitment fee**, because the brief explicitly requires preserving the current schedule. The former explanatory text described this as reserving the coming school year. The revised page does not establish a 2027–28 price and clearly says next year’s fee is unannounced. Confirm the May entry’s actual application and any existing-family transition terms before publication; no amount or invoice logic was silently changed.
3. **Prospective registration policy needs an owner-approved update.** `registration.html:666` still says “Annual Curriculum Fee: $200 — charged once per year, all students”; `:668` says $135 × four units/year; `:674` makes the fee nonrefundable once enrollment is finalized. These should be reconciled with the new fee name, January participation, place-confirmation timing, stated coverage, and school-unable-to-provide-place refund. The signed acknowledgement control is at `:685`, and its payload key is at `:1293`. The agreement and all stored/signed records remain untouched.
4. **Parent agreement and financial-policy PDFs need inspection.** The existing Tuition & Attendance Policy and Parent Agreement downloads referenced in `documents.html:69` and `:136` returned HTTP 403 from the asset host during read-only checks. Their text could not be verified. Connected Drive search found only older 2025 Fusion-branded versions, which were not treated as replacements. No PDF, agreement, permission, or historical record was modified. Please verify the current downloadable originals and their hosting access.
5. **Generated registration documents/backend remain external.** `registration.html:928` identifies its external Apps Script receiver; calls at `:1155` and `:1308` and signature data at `:1293` are unchanged. Its document-generation source and any billing configuration are not in this checkout. Check generated agreement packets against the approved fee terms separately; no backend schema, signatures, payment integration, or automatic billing was changed.
6. **Confirm official EFA guidance.** The existing detailed [Arkansas Department of Education EFA destination](https://dese.ade.arkansas.gov/Offices/office-of-school-choice-and-parent-empowerment/education-freedom-accounts) returned HTTP 200 in a fresh read-only request and remains the public reference. The short `dese.link/efa` destination was unreliable in the web reader, so the verified detailed destination is used. January 2027 new-funding availability and transfers still need confirmation. The supplied March 1–June 1, 2027 window remains visibly labeled an estimate; official 2027–28 dates were not verified.
7. **2027–28 pricing and transition terms remain unannounced.** Confirm the future Annual Enrollment & Curriculum Fee amount, due date, coverage, refund terms, other next-year pricing, and any current-family transition arrangements before publishing specific terms. No waiver, January total, or remaining-payment/unit count was invented.

## Verification

- Static checks: all new/affected internal destinations and anchors exist, unique IDs, one H1 per page, correct tuition-section order, $6,740 calculation, no public PIAK on tuition, qualified EFA estimates in the same paragraph/panel as the dates, and no next-year fee amount.
- Byte comparisons: current-year payment-table body, homepage banner, footer legal notices, registration/inquiry form code, shared JavaScript, and portal integration are unchanged. Moved laptop and annotation content no longer appears on tuition.
- Headless Chrome: tuition, What to Expect, payment calendar, FAQ, Foundation, Documents, scrub guide, scholarship form, and homepage at 1440px and 390px. No horizontal overflow or browser JavaScript exceptions. New primary-page links and buttons have visible keyboard focus; mobile navigation works; FAQ anchor targets expand; preparation anchors exist; PIAK is absent from tuition’s live DOM.
- Inspected desktop/mobile screenshots. Corrected a mobile caption-wrapping issue caused by the existing payment table’s card layout, without changing any schedule values. Existing laptop and uniform images loaded successfully.
- Browser inquiry regression: required/optional fields, three children, removing/re-adding children, accessible optional disclosures, input preservation after network/server/JSON failures, duplicate-send prevention, and mocked success passed.
- Browser scholarship regression: required validation, unchanged upload/payload/anti-spam fields, error preserving inputs, and mocked success passed using synthetic local data and a synthetic local file.
- `node tests/inquiry-data.test.mjs`, `node tests/inquiry-backend.test.mjs`, and `node tests/portal-auth.test.mjs` passed. `git diff --check` passed.
- No package manifest, build command, or lint configuration exists in this static repository.
- **No real forms were submitted, no real family/student data was changed, and no production email or record was created.** Google Apps Script submission URLs were blocked during browser checks. Local extensionless routes map to the existing HTML files; production hosting was not changed or tested for the new route.

## Screenshots

- Tuition: [desktop](tuition-desktop.png), [mobile](tuition-mobile.png).
- What to Expect: [desktop](what-to-expect-desktop.png), [mobile](what-to-expect-mobile.png).
- Payment calendar: [desktop](payment-calendar-desktop.png), [mobile](payment-calendar-mobile.png), [mobile caption detail](payment-caption-mobile.png).
