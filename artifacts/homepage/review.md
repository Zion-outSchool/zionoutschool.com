# Homepage redesign review

Implemented locally on November 13, 2026. Nothing was published or deployed.

## Changes

- Replaced the homepage with the supplied text-led opening, academic example, four linked previews, compact tuition section, and closing inquiry invitation.
- Kept the navy, gold, cream, Cormorant Garamond, and Inter design system. Added homepage-only styles and disclosure navigation behavior; supporting pages and shared source files were not changed by this work.
- Retained all six carousel images, controls, shared CSS, and shared carousel JavaScript. The original markup is inside `template#home-carousel-paused` in `index.html`. Template contents are inert: no visible space, accessibility-tree entries, image loading, event listeners, or carousel timer. To restore it later, move the section out of the template.
- Removed the old homepage promotions, modal, quotation bands, repeated marketing sections, and duplicate nondiscrimination notice. The retained footer policy is unchanged verbatim; the removed duplicate matched after whitespace normalization.
- Added consistent “Begin a Family Inquiry” links to `/inquiry-form`, kept Family Portal at `/family-portal`, and retained registration under Join ZION at `/registration`.
- Preserved the existing logo and supporting-page navigation. Added a skip link, visible focus styles, mobile expanded/collapsed states, keyboard-operated dropdowns, and Escape dismissal/focus return.
- Updated the homepage title and description. No existing structured data was removed.
- Included the consistently published Kindergarten–12th grade range, the supplied schedule, existing general email, and the school address confirmed in contact, registration, and partnership content.

## Verification

- Headless Chrome layout checks at 1440, 1101, 1024, 768, 390, and 320 pixels: no horizontal overflow; one H1; two preview columns on desktop and one on narrow screens.
- Inspected full-page desktop and mobile screenshots; refined the inherited footer partnership button to a plain link with readable contrast.
- Verified mobile navigation, submenu visibility and ARIA states, Escape dismissal/focus return, desktop Enter activation and Tab access to submenu links.
- All 23 unique local page destinations returned HTTP 200 in the local preview, including `/inquiry-form`, `/curriculum`, `/family-portal`, and `/registration`.
- Local preview mapped extensionless paths to the existing `.html` files. Production hosting configuration was not changed or tested.
- Confirmed no carousel image requests and no browser JavaScript exceptions.
- JavaScript syntax checks passed for `script.js` and `home-navigation.js`.
- Existing `tests/portal-auth.test.mjs` passed: roles, deferred auth reads, sign-in/out, inactive staff, and sign-out race.
- Static checks passed for unique IDs, link targets, preserved legal notice, and `git diff --check`.
- No package manifest, build command, or lint configuration exists in this static HTML repository. No forms were submitted or real family/student data altered.

## Owner decisions and supporting-page follow-up

- Admissions phone numbers conflict: the previous homepage contact modal used **706-363-0492**; the registration footer uses **509-380-6364**. No phone number was selected for the new homepage. The existing `hello@zionoutschool.com` email and `519 Latham Dr, Lowell, AR` address are retained.
- Partnership email spelling differs: `partners@zionoutschool.com` in `build-with-us.html` and `partner@zionoutschool.com` in `partners.html`. Supporting pages remain unchanged.
- The retired “Your child was born to seek truth” phrase remains in the following supporting-page locations, intentionally unchanged:
  - `inquiry-form.html:212` — success message.
  - `interest-registry.html:207` — success message; `:230` — quotation band.
  - `scholarship-assistance.html:320` — success message.
  - `registration.html:857` — success message.
  - `tuition.html:180` — quotation band.
- No grade-range conflict was found. The approved Bednar excerpt was not added; the later `/how-we-learn` update remains outside this task.
- Existing uncommitted edits in `script.js` and `style.css` were preserved.

## Screenshots

- [Desktop, 1440px](desktop.png)
- [Mobile, 390px](mobile.png)
