# New Tab Mii Plaza

A browser extension for Chrome and Firefox that replaces the new tab with an interactive 3D plaza and ten floating glass blocks. Each block holds a site you pin. Click an empty block to add one, right-click a full one to edit or remove it, drag a block to spin it, and click a pinned block to dive into the site.

```sh
pnpm install
pnpm dev           # Chrome with the extension loaded, reloading on change
pnpm dev:firefox   # the same in Firefox
pnpm check         # type check
pnpm build         # .output/chrome-mv3 and .output/firefox-mv3
pnpm zip           # store uploads for both
pnpm zip:sources   # store uploads + source archives for AMO review
pnpm site          # the project page into .site/
```

To try a build by hand, load `.output/chrome-mv3` with Load unpacked on `chrome://extensions` (Developer mode on), or `.output/firefox-mv3/manifest.json` with Load Temporary Add-on on `about:debugging#/runtime/this-firefox`.

## Where things are

- `src/components/` is the plaza and character engine, maintained independently in this repo. `public/ffl/` holds FFL's WebAssembly, its resource file and the two body models.
- `src/data/music.ts` is a stand-in for the track type, which the crowd imports.
- `src/newtab/` holds the new tab features:
  - `plaza.ts` runs the crowd, the floor and the blocks, with none of the site's opening, sound, bubbles or DJ.
  - `pins.ts` keeps the pins and display preferences in sync storage, plus URL validation, slot swapping and JSON export/import.
  - `miis.ts` and `qr.ts` keep the undeletable default My Mii plus user-uploaded 3DS/Wii U Mii QR code scans in local storage (lazy-loaded only when Settings opens).
  - `manage.ts` lazily builds the Manage, reorder, backup, Miis QR manager and shortcut sheet only when opened.
  - `tiles.ts` draws what is inside each block: a faint plus when empty, a custom image/GIF when chosen, the site's favicon suspended transparently inside the refracting glass, or a muted faint version of the extension's logo when no icon is available.
  - `icons.ts` automatically fetches a site's title, theme color, and best icon directly from the page once (`credentials: 'omit'`), caches a 256x256 PNG and metadata in local storage (falling back to Chrome's favicon cache if offline), and cleans up stale entries when sites are removed.
  - `announce.ts` reads the newest announcement from `https://ankush.one/announcement.json` at most every six hours (one tab at a time), keeps it and its icon in local storage, and your Mii says it once on a tab that isn't showing the first-run welcome. Publishing one is documented in the ankush.one repo's README, under Announcements. To try one locally, run the site with `pnpm dev` and build this with `WXT_ANNOUNCE_URL=http://localhost:4321/announcement.json pnpm dev`.
  - `db.ts` and `custom.ts` store custom block images (PNG, JPG, WebP, SVG) in IndexedDB and stream animated GIF frames onto block textures via `ImageDecoder`.
- `src/entrypoints/newtab/` is the page: markup, styles and the wiring between pins, the editor, the manage sheet and the plaza.
- `src/entrypoints/background.ts` handles toolbar icon clicks by opening a new tab.

## Keeping it light

A new tab stays fast without holding back the live scene:

- **Immediate live boot.** The plaza starts immediately with no fixed-frame boot delay.
- **Lazy overlays.** The Settings, spatial reorder, backup and controls sheet is dynamically imported only when opened, adding zero parse or DOM cost on normal tab opens.
- **Fewer visitors.** 40 on a desktop, 24 on a phone or a weak device, against the site's 110. Each one costs build time on every tab.
- **The display's own pace**, on the low-power GPU, with the resolution governor stepping down if frames run slower than the display.
- **Idle pause.** After five minutes without input it stops drawing, and any input starts it again.
- **Hidden tabs let go.** A tab hidden for three minutes frees its WebGL context and memory, and reloads when shown again. Chrome runs all of an extension's pages in one process with a limit of 16 WebGL contexts, so this also keeps many open new tabs from running out.

## Releases

A release is a version tag. `npm version patch` (or `minor`, `major`) bumps `package.json`, commits and tags `v1.0.1`, and `git push --follow-tags` sends both. The tag starts `.github/workflows/release.yml`, which checks that the tag matches `package.json`, type checks, runs `pnpm zip:sources` and publishes a GitHub release with the Chrome zip, the Firefox zip and the source archive for AMO, plus copies named without the version so `releases/latest/download/newtab-mii-plaza-chrome.zip` always gets the newest. Store uploads take the versioned zips from the release.

## Project page

`site/` is the project page at [ankush.one/newtab-mii-plaza](https://ankush.one/newtab-mii-plaza/): download buttons that put the visitor's browser first (logos from developer-icons, MIT, as on mixtunes), a light and dark screenshot with a link to the live plaza on [ankush.one](https://ankush.one/), what it does, install steps, common questions, and support links (Simple Icons, CC0). `site/support.html` becomes `/support/` and `PRIVACY.md` is rendered into `site/privacy.html` as `/privacy/`, so the stores' privacy link always matches this repo. The questions on the home page are the one source for its FAQPage structured data and for `llms-full.txt`, so edit them there. `pnpm site` builds it all into `.site/`, and `.github/workflows/pages.yml` deploys it whenever `site/`, `PRIVACY.md` or the icon change on `main`. It is served under ankush.one because GitHub Pages puts project sites under the user site's custom domain, and ankush.one's own `robots.txt` lists this sitemap, since crawlers only read the one at the root. Keep the copy plain and true to what the extension does. The download buttons follow the stores on their own: each build asks the Chrome Web Store (Chrome's update check) and Firefox Add-ons (its public API) whether the extension is live and writes that into the page, and the Pages workflow reruns every three hours to notice an approval. Firefox's API answers web pages, so the page also asks it again when it loads. A live store turns its button into "Add to ..." with its version under the buttons; until then the button downloads the release zip, the line says "coming soon" and the install steps for that browser stay. The store ids are at the top of `scripts/site.mjs`.

`site/analytics.js` is the same PostHog setup as 3dsDL and sh23ds: one project for all of ankush.one, sent through `p1.ankush.one`, with autocapture, heatmaps, Web Vitals, error capture and session replay, and `site: "newtab-mii-plaza"` on every event. Nothing loads on localhost or with Global Privacy Control, and an opt-out on ankush.one/privacy holds here since the origin is shared. Custom events go through `window.track(name, props)`: `download_clicked` (which build, store or zip, and whether it was the one suggested for the visitor's browser), `screenshot_theme` and `faq_opened`. The extension itself never sends anything.

## License

[AGPL-3.0-only](./LICENSE), because the bundled [FFL.js](https://github.com/ariankordi/FFL.js) is AGPL-3.0-only. Other bundled code, the font and the Nintendo files that are not covered by this license are listed in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). Both files ship inside every build. Mii, Wii U and Nintendo 3DS are trademarks of Nintendo, and this project is not affiliated with Nintendo.

## Before publishing

See [STORE_LISTING.md](./STORE_LISTING.md) and [PRIVACY.md](./PRIVACY.md) for Chrome Web Store and Firefox Add-ons submission copy, AMO source-archive steps, and asset considerations for `public/ffl/FFLResHigh.dat` and the body models.
