# BrickGift Studio

Design custom LEGO sets as gifts: concept art, a buildable model, a printable instruction booklet, a BrickLink parts order, and packaging. Everything runs in the browser; projects are saved in the browser's local storage (use **Back up** / **Restore** to move them).

1. **Idea**: describe the gift, press **Copy image prompt**, paste it into ChatGPT, Gemini or any image tool, then upload, paste or drop the picture back in. No API key needed. (Optional: generate in-app with your own OpenAI key.)
2. **Model**: load an LDraw `.ldr`/`.mpd` with `0 STEP` lines (BrickLink Studio: File → Export As → LDraw), or pick a sample. Drag the slider to watch it build piece by piece.
3. **Instructions**: renders every step with a parts callout, bag pages, cover, parts list and back cover. Print or save as PDF.
4. **Buy parts**: BrickLink Wanted List XML (bricklink.com → Wanted → Upload, then Buy All) and a CSV.
5. **Package**: box front/back art and bag labels showing each bag's parts.

Part geometry is loaded at runtime from the LDraw library mirror at github.com/gkjohnson/ldraw-parts-library.

## Develop

```sh
npm install
npm run dev        # local dev server
npm test           # unit tests (parser, bags, BrickLink export)
npm run build      # production build in dist/
npm run e2e        # end-to-end smoke test against the build (needs network)
```

`node scripts/export-stepper.mjs model.mpd out.json` exports per-piece geometry for standalone build previews.

## Deploy

`npm run build` produces a static site in `dist/` with no server code. Any static host works:

- **Netlify / Vercel / Cloudflare Pages**: import the repo, build command `npm run build`, output directory `dist`.
- **GitHub Pages**: build with `BASE=/<repo-name>/ npm run build` so asset paths resolve under the repo path.

CI (`.github/workflows/ci.yml`) runs the unit tests, the build and the end-to-end test on every push.
