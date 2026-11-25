import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  // Manifest V3 in both browsers: one manifest shape, one content security policy.
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'New Tab Mii Plaza',
    short_name: 'Mii Plaza',
    description: 'Your sites in glass blocks over a busy plaza, on every new tab.',
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
          strict_min_version: '128.0',
          // Nothing leaves the browser: pins sync through the browser's own account.
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
});
