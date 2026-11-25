# Firefox Add-ons (AMO)

What to fill in at https://addons.mozilla.org/developers/addon/submit/. The description, graphics and support links are shared with Chrome in [listing.md](./listing.md).

## Upload

- **Distribution:** On this site (listed).
- **File:** `newtab-mii-plaza-<version>-firefox.zip` from the GitHub release for the tag.
- **Platforms:** Firefox for desktop only, not Android.
- **Source code:** Yes. Upload `newtab-mii-plaza-<version>-sources.zip` from the same release. The build is bundled and minified, so reviewers rebuild it from this archive; it rebuilds byte for byte (checked for 1.0.1).

## Notes to reviewer

```text
Built with WXT (Vite + TypeScript). No login or setup is needed to test: open a new tab. Press ? or the gear in the bottom right corner for Settings.

Build from the source archive (the uploaded file is built the same way by GitHub Actions on Ubuntu):
1. Install Node.js 24, then pnpm 12.15.0: npm install -g pnpm@12.15.0
2. Unzip the source archive and run, inside it: pnpm install --frozen-lockfile
3. pnpm build
4. The add-on is in .output/firefox-mv3, identical to the uploaded file.

Third-party and binary files:
- public/ffl/ffl.wasm and src/components/mii/vendor/ffl-emscripten.js are FFL, the Mii face renderer, compiled with Emscripten. It runs locally under the extension's CSP ('wasm-unsafe-eval' only, for this module).
- public/ffl/FFLResHigh.dat is the face part data FFL reads; public/ffl/body-*.glb are the body models; public/media/plaza-voices.mp3 is an audio sprite of short Mii voice clips and sound effects.
- src/components/mii/vendor/ffl.js and FFLShaderMaterial.js are from github.com/ariankordi/FFL.js (AGPL-3.0-only); struct-fu.js is from github.com/natevw/struct-fu (BSD-2-Clause). THIRD_PARTY_NOTICES.md lists everything bundled.

Network:
- When the user pins a site, the extension fetches that one page with credentials: 'omit' to read its title, theme colour and icon, and stores them in storage.local. This is why it asks for http and https host access.
- At most every six hours it reads https://ankush.one/announcement.json, a public JSON file; its text is shown with textContent. No cookies or user data are sent.
- No remote code, analytics or tracking. data_collection_permissions is set to none.
```

## Listing

- **Name:** New Tab Mii Plaza
- **Add-on URL:** `newtab-mii-plaza`
- **Summary** (250 characters at most):

  ```
  Every new tab becomes the Wii U's Wara Wara Plaza. Your favourite sites float around the edge as blocks you can click, edit and spin, and Miis you add from 3DS or Wii U QR codes hang out in the middle. No account, no ads, no tracking.
  ```

- **Description:** the same text as Chrome, in [listing.md](./listing.md).
- **Categories** (up to three): Appearance, Tabs and Bookmarks.
- **Support email:** miiplaza@ankush.one
- **Support website:** https://ankush.one/newtab-mii-plaza/support/
- **Homepage:** https://ankush.one/newtab-mii-plaza/
- **License:** GNU Affero General Public License v3.0 only.
- **Privacy policy:** AMO takes the text, not a link. Paste the contents of `PRIVACY.md`.
- **Screenshots:** the four in `screenshots/`. AMO takes them at 1280x800 as they are.
- **Icon:** taken from the extension, nothing to upload.
