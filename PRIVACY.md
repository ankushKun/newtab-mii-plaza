# Privacy Policy for New Tab Mii Plaza

Effective date: November 25, 2026

New Tab Mii Plaza does not collect, transmit, sell, or share personal information, browsing history, or analytics with the developer or any third party.

## What data is stored and where

1. **Pinned sites and display preferences (`storage.sync`)**
   - Site URLs, custom block titles, tile color/style preferences, and optional clock settings that you create are saved using your browser's `storage.sync` API so they can sync across browsers signed in to your own browser account.
   - This data stays under your browser account's control and is never sent to any developer server.

2. **Custom block media (IndexedDB) and Miis (`storage.local`)**
   - Custom block images or GIFs you pick from your computer are saved locally in your browser's IndexedDB (`plaza`).
   - Mii QR code images you upload are scanned locally inside your browser, and the decoded Mii data is saved locally in `browser.storage.local`. None of these files ever leave your device.

3. **Site titles, icons, and theme colors**
   - When you pin an `http:` or `https:` site, the extension automatically fetches that site's page metadata (`<title>`, `theme-color`, and favicon link) once using `credentials: 'omit'` and caches a `256x256` PNG icon and title/accent locally in `browser.storage.local` (with Chrome's local `/_favicon/` cache as an offline fallback).
   - No pinned URLs or browsing data are sent to any developer or third-party server. When a site is unpinned, its cached icon and metadata are automatically removed.

4. **Announcements from ankush.one**
   - Every six hours at most, the extension reads `https://ankush.one/announcement.json`, a public file listing the developer's newest announcement, and your Mii says it once in the plaza. The request carries no cookies, identifiers, pins or browsing data. Like any web request, it reveals your IP address and browser to the site's hosts (GitHub Pages and Cloudflare).
   - The announcement, its icon and the ids of announcements already shown are kept in `browser.storage.local` so each one appears only once.

## Permissions summary

- `storage`: Save and sync your pinned sites and display preferences across your devices, and store cached favicons locally.
- `favicon` (Chrome only): Fallback to Chrome's local favicon cache when offline.
- `host_permissions` (`http://*/*`, `https://*/*`): Allow direct automatic fetching of page titles, theme colors, and favicons from sites you pin without contacting third-party icon servers, and reading announcements from ankush.one.

## The project page

This applies to the extension only. Its web page at `ankush.one/newtab-mii-plaza` uses PostHog analytics like the rest of ankush.one, described with a button to turn them off on the [ankush.one privacy page](https://ankush.one/privacy/). The extension never loads or talks to PostHog.

## Contact

If you have questions about this privacy policy, email [miiplaza@ankush.one](mailto:miiplaza@ankush.one).
