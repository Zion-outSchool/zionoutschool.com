# Midyear enrollment announcement

Added a text-only, gold announcement band immediately below the homepage navigation and above the cream introduction. It uses the exact supplied announcement and supporting copy, with a navy button linking to `/inquiry-form`.

The band follows the existing content margins, uses the established serif font, and remains in normal document flow. It is about 141px high at 1440px wide, with no fixed height. Below 900px the content stacks naturally; the announcement is 28px on narrow screens. The opening top padding was modestly reduced from 58px to 44px on desktop and from 32px to 26px on mobile.

The band is a named announcement region with a paragraph, preserving the existing single H1. It has no images, motion, dismissal controls, sticky positioning, or JavaScript. Its HTML section and scoped CSS are marked for easy removal after the campaign.

Checks passed:

- Headless Chrome at 1440, 1101, 1024, 900, 768, 390, and 320px: natural layout with no horizontal overflow.
- Banner begins immediately below the fixed navigation and aligns with the opening’s content margin.
- Desktop text/action layout and mobile stacking; inspected screenshots at 1440px and 390px.
- Measured contrast: navy on gold 4.69:1; cream on navy button 9.94:1. Both meet AA normal-text contrast.
- Keyboard navigation reaches the banner action and displays its 3px focus outline.
- Announcement appears as a named region in Chrome’s accessibility tree; the existing opening remains the only H1.
- The `/inquiry-form` destination returns HTTP 200 in the local preview. No inquiry was submitted.
- Mobile navigation still opens/closes correctly; the preserved carousel remains inert and loads no carousel images.
- Existing homepage markup, copy, and metadata were compared with the committed version and are unchanged apart from the added band and stylesheet cache version. No shared navigation or JavaScript changes.
- No browser JavaScript exceptions; `git diff --check` passes.

Local implementation only. Nothing deployed.

Screenshots: [desktop](desktop.png), [mobile](mobile.png).
