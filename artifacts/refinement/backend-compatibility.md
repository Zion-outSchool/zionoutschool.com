# Inquiry backend compatibility

The owner supplied the handler source after the initial frontend handoff. A replacement is now prepared in [Code.gs](../../apps-script/inquiry/Code.gs), with [integration notes](../../apps-script/inquiry/README.md). The owner reports saving the replacement to the remote project. Remote source readback remains unavailable; no deployment update has been reported or performed here.

## Confirmed from the supplied handler

The script appends one row per child to `Student Inquiry Form (Responses)` in its bound spreadsheet, using 16 columns, and sends one plain-text notification to `hello@zionoutschool.com`. It had no required-field validation or visible anti-spam code. It already stored the frontend’s neutral `anythingElse` alias in column P; its email wording needed updating.

## Prepared and locally tested

- Require parent/guardian name, email, one family message, and each child’s age/grade; allow one to three children.
- Leave student name, phone, school year, referral source, interests, and learning considerations optional.
- Use `message`, falling back to `anythingElse`, with an additional fallback for older form submissions. The general message is stored in existing column P and printed once under “Family questions and context.”
- Retain the original sheet name, recipient, 16-column order, one-row-per-child storage, and response contract. Do not modify historical rows or headers.
- Preserve distinct legacy field values during the transition. Do not send the new general message as a complaint about the current school.
- Validate every child before writing rows. Keep text literal in the spreadsheet and return accessible JSON errors without internal service details.

`tests/inquiry-backend.test.mjs` passes using the actual replacement `.gs` source and actual frontend serializer with all Google services mocked. It verifies exact column placement, captured notification text, minimal optional data, three children, old/new field compatibility, validation before writes, unchanged mock history, and service failures. Frontend contract tests and existing portal-auth tests also pass.

## Remaining live verification

No real email was sent, no production row created, and no historical record read or changed. Live delivery, sheet permissions, deployment settings, runtime quotas, and whether the candidate script project corresponds to the website’s `/exec` URL remain unverified.

The original write-then-email ordering remains: a mail error may occur after row creation, so a retry can duplicate records. This pre-existing cross-service limitation is documented in the integration notes.

The supplied project link is:

https://script.google.com/u/2/home/projects/1FA11sPSVWcIJ0NK_CeUTic7kG9BsK74ldQPPQ83QQvp5RTkUcWcyjaHe/edit

Direct connected access was unavailable, so this work used the source pasted by the owner. The owner reports that the replacement has now been saved. Updating the live deployment remains outside the authorization provided; it has not been done here.
