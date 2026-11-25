# Store Publishing Guide: New Tab Mii Plaza

This checklist covers preparing and submitting **New Tab Mii Plaza** to the **Chrome Web Store** and **Firefox Add-ons (AMO)**.

---

## 1. Build Packages

```sh
pnpm check          # TypeScript check
pnpm build          # Production bundles in .output/chrome-mv3 and .output/firefox-mv3
pnpm zip            # Uploadable store zips
pnpm zip:sources    # Store zips + source archives (needed for AMO review)
```

---

## 2. Store Listing and Chrome Web Store Answers

- [`store/listing.md`](./store/listing.md): summary, description, category, URLs and which graphic goes where.
- [`store/cws-privacy.md`](./store/cws-privacy.md): single purpose, permission justifications, remote code and data usage for the Chrome Web Store privacy tab.
- Privacy policy URL: `https://ankush.one/newtab-mii-plaza/privacy/`, built from `PRIVACY.md` by the Pages workflow.

"Mii", "Wii U" and "3DS" are Nintendo trademarks and the name uses "Mii". Reviewers may flag this, so be ready to rename (for example "New Tab Plaza") if either store asks.

---

## 3. Firefox Add-ons (AMO) Submission Notes

Because WXT/Vite outputs minified JavaScript bundles (`.output/firefox-mv3/chunks/*.js`) and includes Emscripten WebAssembly glue, AMO requires submitting the **source code zip** produced by `pnpm zip:sources`.

### Reviewer Build Notes (paste into AMO "Notes to Reviewer")

```text
This extension is built with WXT (Vite + TypeScript).

Build environment:
- Node.js 20+ and pnpm 9+

Build steps from the uploaded source archive:
1. pnpm install --frozen-lockfile
2. pnpm build
3. Output directory: .output/firefox-mv3

Notes on vendored files and WebAssembly:
- public/ffl/ffl.wasm and src/components/mii/vendor/ffl-emscripten.js are the compiled FFL WebAssembly library (Emscripten build from github.com/ankushKun/mii-creator), executed locally under CSP "wasm-unsafe-eval".
- src/components/mii/vendor/ffl.js and FFLShaderMaterial.js are from github.com/ariankordi/FFL.js (AGPL-3.0-only), and struct-fu.js is from github.com/natevw/struct-fu (BSD-2-Clause). LICENSE and THIRD_PARTY_NOTICES.md list every third-party component.
- No remote code is executed. Network requests occur only when pinning a site to fetch its page title, theme color, and favicon directly with `credentials: 'omit'` and cache them locally, and at most every six hours to read https://ankush.one/announcement.json, plain JSON whose text is shown with textContent.
```

---

## 4. Pre-Submission Checklist

- [ ] Pick **GNU Affero General Public License v3.0** as the license on AMO, and keep the GitHub repo public with each released version tagged. The AGPL requires that anyone who gets the extension can get its source. `homepage_url` and the GitHub link in Settings point there.
- [ ] Review third-party binary assets in `public/ffl/` (`FFLResHigh.dat`, `body-m.glb`, `body-f.glb`) against store IP policies before publishing publicly.
- [ ] Paste `https://ankush.one/newtab-mii-plaza/privacy/` into both CWS and AMO listings.
- [ ] Upload the versioned zips from the GitHub release for the tag (`-chrome.zip` to CWS; `-firefox.zip` and `-sources.zip` to AMO).
- [ ] Capture clean `1280x800` screenshots in light and dark mode.
- [ ] Load `.output/chrome-mv3` in Chrome (`chrome://extensions`) and measure live boot time, heap, and FPS in DevTools per `AGENTS.md`.
- [ ] Load `.output/firefox-mv3/manifest.json` in Firefox (`about:debugging#/runtime/this-firefox`) and test:
  - Pinning a site (verify instant save, then title, icon and accent color load)
  - Removing a site (verify its cached icon and metadata are cleaned up)
  - Uploading a batch of Mii QR codes and opening the Miis tab in Settings
  - Announcements: a live one is said once on the second tab (the first shows the welcome), then never again
  - Reordering pins via drag-and-drop and Prev/Next buttons, JSON export/import, zoom controls, optional clock, and light/dark switching
