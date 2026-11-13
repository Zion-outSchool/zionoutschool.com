# Published-site verification

The owner reports successful Apps Script deployment and publication of the website changes. The website was independently checked at https://zionoutschool.com/ and https://zionoutschool.com/inquiry-form using fresh HTTP requests and headless Chrome.

Passed:

- Both pages and all required new CSS/JavaScript assets return HTTP 200. `inquiry-data.mjs` is served as JavaScript.
- Published homepage includes the shortened academic introduction, concrete Karen Phillips preview, unnumbered previews, and right-arrow inquiry links.
- All four homepage “Begin a Family Inquiry” links use `/inquiry-form`.
- Homepage and inquiry form fit 1440px and 390px widths without horizontal overflow.
- Homepage grades and schedule use 15px text at both widths.
- Carousel remains in its inert template, absent from the live document layout.
- Mobile navigation and submenu expanded states work; Escape closes the menus.
- Inquiry form loads its JavaScript and renders four required inputs for a one-child inquiry. Student name and school year are optional; the funding question is absent.
- Optional inquiry section responds to Enter and updates its expanded state.
- `/inquiry-form`, `/curriculum`, and `/family-portal` return HTTP 200.
- No browser JavaScript exceptions.

The web reader initially returned older cached content. Fresh uncached requests and an actual browser confirmed the latest release; no missing-file issue was found.

No form was submitted. Google Apps Script submission URLs were blocked in the verification browser, with an additional submission-event guard. No admissions email was sent or production record created.

The deployed backend version, live email delivery, and live spreadsheet row storage were not independently verified. The isolated `IntegrationTest.gs` run and receipt of its two notifications at `admin@zionoutschool.com` remain unconfirmed.

## Live screenshots

- [Homepage desktop](homepage-desktop.png)
- [Homepage mobile](homepage-mobile.png)
- [Inquiry desktop](inquiry-desktop.png)
- [Inquiry mobile](inquiry-mobile.png)
