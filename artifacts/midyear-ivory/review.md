# Enrollment banner refinement

Changed the announcement background to the existing `--cream-dark` token (`#F0EDE6`), a pale warm ivory subtly deeper than the introduction’s `--cream` (`#F9F6F0`). Added a 2px gold bottom border. Retained the navy headline and navy button with cream text, exact wording, placement, typography, and natural mobile wrapping.

Reduced vertical padding from 34px to 28px on desktop and from 22px to 18px on mobile. Removed only the duplicate inquiry button in the cream introduction; its curriculum link and inquiry actions in navigation, banner, closing section, and footer remain.

Verified with local headless Chrome at 1440, 1101, 1024, 900, 768, 390, and 320px. No horizontal overflow. The band remains in normal document flow immediately below navigation, shares the introduction’s margins, and has visible keyboard focus. Contrast measured 9.17:1 for navy on ivory and 9.94:1 for cream on the navy button. The exact 2px gold border, remaining action destinations, mobile navigation, single H1, and preserved inert carousel passed checks. No JavaScript exceptions or inquiry submissions.

Compared HTML with the committed version: only the duplicate introduction button and stylesheet cache version changed. Other copy and metadata remain intact. `git diff --check` passed.

Screenshots: [desktop](desktop.png), [mobile](mobile.png).

Saved locally. Nothing deployed.
