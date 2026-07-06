# Receipt Scanner

Take a photo of a receipt in your browser and get back an editable list of items and prices. Runs entirely client-side — no server, no API keys, no photos ever leave your device.

## How it works

- [Tesseract.js](https://github.com/naptha/tesseract.js) runs OCR on the photo in-browser.
- A small heuristic parser scans each line of recognized text for a trailing price (e.g. `12.99`) and treats the rest of the line as the item name.
- Lines like subtotal/tax/tender/card are filtered out of the item list; the "total" line is captured separately for a sanity check against the summed item prices.
- Results are editable — fix any OCR misreads inline — then export as CSV or copy as plain text.

## Local development

No build step. Just serve the folder statically, e.g.:

```
npx serve .
```

Then open the printed URL. Camera capture (`capture="environment"`) works on mobile browsers; on desktop the file picker is used instead.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which publishes this folder to GitHub Pages via GitHub Actions.
