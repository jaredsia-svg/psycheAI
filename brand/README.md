# Brand artwork

The supplied source files for the PsycheAI mark. **Nothing in `docs/` loads these** —
the app inlines the geometry instead, so the mark can be stroked identically by the
browser, the PDF writer and a canvas. They are kept here as the reference the inlined
version was derived from.

`psycheai-icon.svg` is the mark: three ellipses — one rotated 60° — plus a filled
centre circle. `docs/copy.js` carries the same shape with each ellipse written out as
four cubic Béziers, pre-rotated, because every renderer downstream already parses `C`
commands natively; going through arc commands would mean trusting three separate arc
implementations to agree. The conversion was verified by rendering both versions and
diffing the pixels — the only differences are antialiasing along the curve edges.

`psycheai-logo.svg` also sets the wordmark in Space Grotesk with "AI" in the accent
colour. The site uses its own system font stack, and the PDF is limited to the base-14
fonts it can rely on every viewer having, so neither picks that face up.

The artwork's purple is `#5B3FA6`; the site's accent is `#7b3fa0`. The mark inherits
the site accent via `currentColor` so it stays consistent with the text beside it.
