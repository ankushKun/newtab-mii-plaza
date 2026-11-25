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

## 3. Firefox Add-ons (AMO)

[`store/amo.md`](./store/amo.md): which files to upload, notes for the reviewer with the exact build steps, and the listing fields.

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
