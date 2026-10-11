# BrickGift Studio

Design custom LEGO sets as gifts: concept renders, a buildable LDraw model, a printable instruction booklet, a BrickLink parts order, and packaging.

1. **Idea** – describe the gift; generate concept renders with the OpenAI Images API (your key, stored only in your browser).
2. **Model** – load an LDraw `.ldr`/`.mpd` (with `0 STEP` lines; BrickLink Studio can export LDraw). Submodels become their own instruction sequences.
3. **Instructions** – renders every step with a parts callout, bag pages, cover, parts inventory and back cover. Print / save as PDF.
4. **Buy parts** – BrickLink Wanted List XML (upload at bricklink.com → Wanted → Upload, then Easy Buy) and a CSV.
5. **Package** – box front/back art and bag labels showing each bag's parts.

Parts geometry comes from the LDraw library mirror at github.com/gkjohnson/ldraw-parts-library.

```sh
npm install
npm run dev
```
