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

## 2. Store Listing Copy

"Mii", "Wii U" and "3DS" are Nintendo trademarks, and the name and description below use "Mii". Reviewers may flag this, so be ready to rename (for example "New Tab Plaza") if either store asks.

- **Name:** `New Tab Mii Plaza`
- **Short description (132 chars max for CWS):**
  `Your favorite sites in floating 3D glass blocks over a lively plaza, on every new tab.`
- **Detailed description:**
  ```text
  New Tab Mii Plaza replaces your default new tab page with a calm, interactive 3D plaza and ten floating glass blocks for your favorite sites.

  Features:
  - Pin up to 10 sites in glossy glass blocks. Enter any URL or domain to autofetch its title, icon, and brand color, or pick your own custom PNG, JPG, or animated GIF for any block. Click a pinned block to dive straight in, or right-click to edit or remove it.
  - Manage and reorder all 10 blocks visually on a spatial plaza layout in Settings, upload Mii QR code images to populate the plaza alongside your default Mii, switch between Auto, Light, and Dark themes, or export and import pins as JSON.
  - Interact with the plaza: drag blocks to spin them, scroll or pinch (or press + and -) to zoom, and click or drag characters walking around the floor.
  - Automatic light and dark themes following your system appearance, plus an optional minimal corner clock.
  - Built to stay lightweight on tab open: starts straight into the live scene, pauses when idle, and releases GPU memory when hidden.
  - Local-first privacy: your pins sync only through your browser account, with zero analytics or tracking.
  ```

---

## 3. Chrome Web Store Disclosures

- **Category:** Productivity (or Photos / Appearance)
- **Single Purpose Description:**
  `Replaces the browser New Tab page with a 3D interactive plaza displaying up to 10 user-pinned site shortcuts as glass blocks.`
- **Permission Justifications:**
  - `storage`: Stores and syncs the user's pinned site URLs, titles, accent colors, and clock preference across signed-in browser profiles, and caches fetched 256x256 PNG favicons and site metadata locally.
  - `favicon`: Reads favicons from Chrome's local favicon cache as an offline fallback.
  - `host_permissions` (`http://*/*`, `https://*/*`): Automatically fetches a pinned site's page title, `theme-color`, and highest-resolution favicon directly from the target URL when added, without prompting or contacting external third-party icon proxies. Cached locally in `storage.local` and pruned when unpinned. Also reads the developer's public announcement file (`https://ankush.one/announcement.json`) at most every six hours, without cookies or identifiers.
  - `chrome_url_overrides.newtab`: Replaces the New Tab page with the New Tab Mii Plaza interface.
- **Remote Code:** `No, I am not using remote code` (Three.js, WebAssembly, and shaders are bundled inside the extension package; `'wasm-unsafe-eval'` only enables local WebAssembly execution).
- **Privacy Policy URL:** `https://ankush.one/newtab-mii-plaza/privacy/`, built from `PRIVACY.md` by the Pages workflow.
- **Homepage URL:** `https://ankush.one/newtab-mii-plaza/`
- **Required Store Graphics:**
  - Extension icon: 128x128 PNG (`public/icon/128.png`)
  - Screenshots: 1280x800 PNG/JPEG (recommended 4 shots: populated light mode, populated dark mode, pin editor modal, manage/reorder sheet)
  - Small promo tile: 440x280 PNG/JPEG

---

## 4. Firefox Add-ons (AMO) Submission Notes

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

## 5. Pre-Submission Checklist

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
