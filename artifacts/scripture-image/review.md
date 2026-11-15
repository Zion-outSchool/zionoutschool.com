# Wide-margin scripture image placement

Placed the supplied product photo in Foundation’s existing `#scripture-annotation` section, beside the explanation of the included Wide-Margin Quad set and Line Upon Line Co. This is the primary location for the fuller explanation, already linked from What to Expect.

The source image is 1200 × 1800. A reversible CSS square crop uses `object-fit: cover` and `object-position: 50% 70%` to reduce the empty space above the product while retaining the full book stack. The original hosted image is unchanged.

Desktop: a restrained 340px square to the right of the text. At widths up to 860px, it stacks below the text and scales to the available width. Added descriptive alt text and a short product caption. Existing paragraphs, partner link, page metadata, header, footer, and section anchor are preserved.

Checked in local Chrome at 1440, 900, 768, 390, and 320px: image loads at its expected intrinsic dimensions, displayed crop is square, placement switches correctly, no horizontal overflow, anchor clears the fixed header, one H1 remains, and no JavaScript errors. Inspected desktop/mobile screenshots. Existing scripture paragraphs were compared verbatim with the committed source; other page markup is unchanged except the new stylesheet link. `git diff --check` passed.

Changed files: `foundation.html` and new `foundation.css`. No other pages changed. No forms submitted or deployments performed.

Screenshots: [desktop](desktop.png), [mobile](mobile.png).
