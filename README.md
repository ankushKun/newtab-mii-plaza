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

## License

[AGPL-3.0-only](./LICENSE), because the bundled [FFL.js](https://github.com/ariankordi/FFL.js) is AGPL-3.0-only. Other bundled code, the font and the Nintendo files that are not covered by this license are listed in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). Both files ship inside every build. Mii, Wii U and Nintendo 3DS are trademarks of Nintendo, and this project is not affiliated with Nintendo.

## Before publishing

See [STORE_LISTING.md](./STORE_LISTING.md) and [PRIVACY.md](./PRIVACY.md) for Chrome Web Store and Firefox Add-ons submission copy, AMO source-archive steps, and asset considerations for `public/ffl/FFLResHigh.dat` and the body models.
