# Homepage and inquiry refinement

Implemented locally; nothing deployed.

## Changes

- Preserved the homepage headline, colors, fonts, section order, kidney-preservation example, and paused carousel code.
- Removed the redundant academic introduction paragraph; adjusted the desktop columns and mobile gap.
- Increased grades/schedule text to 15px with comfortable line spacing and separate mobile rows.
- Removed preview numbers and reclaimed their columns. Replaced diagonal inquiry arrows with right arrows; all four homepage inquiry actions retain `/inquiry-form`.
- Made the faculty preview concrete: “Karen Phillips brings experience in early childhood and special education.” This is explicitly documented in her current `teachers.html` profile and is attributed only to her.
- Replaced the inquiry introduction, reassurance, button, supporting text, and success message with the supplied welcoming copy.
- Required only parent/guardian name, email, each child’s age/current grade, and one family-level message. Student name, phone, year, referral source, interests, and learning considerations are optional.
- Kept up to three children, the existing limit. Fixed ID collisions when removing a middle child and adding another. Additional children do not repeat the family message.
- Moved longer optional context into native `details` disclosures, with keyboard operation and expanded state. Removed the funding, “How We Learn,” dissatisfaction, redundant description, faith-question, and “Anything else?” prompts.
- Added associated validation errors, focus on the first invalid field, accessible submission errors/success, preserved inputs on failure, and prevention of duplicate pending submissions.
- Left registration, authentication, shared styles, unrelated pages, and legal notice wording unchanged.

## Checks

- Homepage browser checks at 1440, 1101, 1024, 768, 390, and 320px; inquiry form at 1440, 768, 390, and 320px. No horizontal overflow.
- Inspected full-page desktop/mobile screenshots. Grades/schedule are 15px; form inputs use 16px text.
- Homepage mobile navigation, ARIA states, Escape/focus return, desktop Enter and Tab access; 23 unique local page destinations returned HTTP 200. Extensionless routes are mapped to existing HTML files by the local preview server; production hosting was not altered.
- Optional inquiry disclosures operated by keyboard and exposed expanded state through Chrome’s accessibility tree.
- Mocked browser checks: required-only fields; validation before any request; optional names/year; age required for each child; three children; remove/re-add with unique IDs; optional context included in payload; one family message; network failure, server rejection, and invalid JSON preserve inputs; retry; duplicate-send prevention; success state/focus.
- All production inquiry URLs were blocked during browser tests and fetch was mocked. **No real inquiry emails or production records were created. Email delivery and stored records were not verified.**
- `node tests/inquiry-data.test.mjs` passed. Existing `node tests/portal-auth.test.mjs` passed. JavaScript syntax checks and `git diff --check` passed.
- Both footer legal notices were compared with the committed versions and are unchanged verbatim. The carousel remains inert and requested no carousel images.
- No package manifest, build command, or lint configuration exists in this static site.

## Backend follow-up after the source was supplied

The owner subsequently pasted the Apps Script handler. It appends one row per child to the bound sheet, stores `anythingElse` in column P, and notifies `hello@zionoutschool.com`. It had no server-side required-field validation or visible anti-spam checks. The original handler therefore accepts the new payload alias, but retains obsolete email headings.

A replacement is prepared in `apps-script/inquiry/Code.gs`. It validates the simplified requirements, stores the general message in the existing notes column, updates notification wording, preserves all 16 columns and historical records, and accepts old/new submissions. Tests execute the actual `.gs` source with all Google services mocked and pass the actual frontend serializer output into it. Captured email bodies and rows contain the message correctly.

The owner reports saving the code to the remote project. We have not independently read back that source or updated its deployment. Live delivery, spreadsheet permissions, runtime configuration, and deployment correspondence remain unverified. No real inquiry was sent. See [the updated compatibility handoff](backend-compatibility.md) and `apps-script/inquiry/README.md` for details and the existing write-then-email retry limitation.

## Screenshots

- Homepage: [desktop](homepage-desktop.png), [mobile](homepage-mobile.png).
- Inquiry form: [desktop](inquiry-desktop.png), [mobile](inquiry-mobile.png).
