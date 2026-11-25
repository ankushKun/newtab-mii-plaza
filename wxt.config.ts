import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  // Manifest V3 in both browsers: one manifest shape, one content security policy.
  manifestVersion: 3,
  // The source archive AMO reviews holds what builds the extension, not the project page or CI.
  zip: { excludeSources: ['site/**', 'scripts/**', 'store/**', '.github/**'] },
  // Ship the license and third-party notices inside every package (AGPL, MIT, Apache and BSD all ask for it).
  hooks: {
    'build:publicAssets': (wxt, files) => {
      for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
        files.push({ absoluteSrc: `${wxt.config.root}/${name}`, relativeDest: name });
      }
    },
  },
  manifest: ({ browser }) => ({
    name: 'New Tab Mii Plaza',
    short_name: 'Mii Plaza',
    // Also the Chrome Web Store's summary under the name, which allows 132 characters.
    description: "Every new tab becomes the Wii U's Wara Wara Plaza, with your favourite sites around the edge and Miis hanging out in the middle.",
    homepage_url: 'https://github.com/ankushKun/newtab-mii-plaza',
    action: {
      default_title: 'Open New Tab Mii Plaza',
    },
    // Pins sync between your browsers. Host permissions let the extension automatically fetch
    // a pinned site's title, icon, and theme color once and cache them locally.
    permissions: browser === 'firefox' ? ['storage'] : ['storage', 'favicon'],
    host_permissions: ['http://*/*', 'https://*/*'],
    // WebAssembly module for character head rendering.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'plaza-newtab@ankush.one',
          // 140 is where data_collection_permissions arrived, so AMO's linter stays quiet. Android isn't supported
          // (there's no new tab override there), but AMO still checks its minimum, which got the key in 142.
          strict_min_version: '140.0',
          // Nothing leaves the browser: pins sync through the browser's own account.
          data_collection_permissions: { required: ['none'] },
        },
        gecko_android: { strict_min_version: '142.0' },
      },
    }),
  }),
});
