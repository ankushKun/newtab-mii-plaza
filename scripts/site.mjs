// Builds the project page into .site/ for GitHub Pages (.github/workflows/pages.yml), served at
// https://ankush.one/newtab-mii-plaza/. site/index.html is the home page, site/support.html becomes /support/, and
// PRIVACY.md is rendered into site/privacy.html as /privacy/, so the stores' privacy link always matches the repo.
// The questions on the home page are the one source for its FAQPage structured data and for llms-full.txt.
// Each build also asks both stores whether the extension is live (the Pages workflow reruns every few hours to
// notice an approval) and writes the answer into the page, which checks Firefox again on its own when it loads.
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { marked } from 'marked';

const OUT = '.site';
const HOME = 'https://ankush.one/newtab-mii-plaza/';
const CHROME_ID = 'iomoadjdgikohalaohjpabppalbomibk';
const AMO_SLUG = 'newtab-mii-plaza';
const STORES = {
  chrome: { name: 'Chrome Web Store', url: `https://chromewebstore.google.com/detail/${CHROME_ID}` },
  firefox: { name: 'Firefox Add-ons', url: `https://addons.mozilla.org/firefox/addon/${AMO_SLUG}/` },
};

/** Whether each store lists it, and at what version. `live` is null when a store couldn't be asked. */
async function storeStatus() {
  const ask = async (url, read) => {
    try {
      return await read(await fetch(url, { signal: AbortSignal.timeout(10_000) }));
    } catch {
      return { live: null };
    }
  };
  // Chrome's own update check: the version once it's published, "error-unknownApplication" until then.
  const chrome = ask(
    `https://clients2.google.com/service/update2/crx?response=updatecheck&acceptformat=crx2,crx3&prodversion=140.0&x=id%3D${CHROME_ID}%26uc`,
    async (res) => {
      const xml = await res.text();
      const version = /<updatecheck\b[^>]*\bversion="([\d.]+)"/.exec(xml)?.[1];
      if (version) return { live: true, version };
      return { live: res.ok && /status="error-unknownApplication"|status="noupdate"/.test(xml) ? false : null };
    },
  );
  // AMO's public API: 401 or 404 until the listing is public.
  const firefox = ask(`https://addons.mozilla.org/api/v5/addons/addon/${AMO_SLUG}/`, async (res) => {
    if (res.status === 401 || res.status === 404) return { live: false };
    const data = await res.json();
    return data.status === 'public' && !data.is_disabled ? { live: true, version: data.current_version?.version } : { live: false };
  });
  const [c, f] = await Promise.all([chrome, firefox]);
  return { chrome: { ...STORES.chrome, ...c }, firefox: { ...STORES.firefox, ...f } };
}

await rm(OUT, { recursive: true, force: true });
await cp('site', OUT, { recursive: true, filter: (path) => !/(index|privacy|support)\.html$/.test(path) });
await copyFile('public/icon/128.png', `${OUT}/icon.png`);
await writeFile(`${OUT}/.nojekyll`, '');

const [home, privacyPage, support, privacyMd, llms] = await Promise.all(
  ['site/index.html', 'site/privacy.html', 'site/support.html', 'PRIVACY.md', 'site/llms.txt'].map((file) => readFile(file, 'utf8')),
);

// Each <details><summary>question</summary><p>answer</p></details> in the FAQ section.
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const faq = [...home.matchAll(/<details>\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/g)].map(
  ([, q, a]) => ({ q: text(q), a: text(a) }),
);
if (faq.length === 0) throw new Error('site/index.html has no FAQ questions to build from');

const faqLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  '@id': `${HOME}#faq`,
  mainEntity: faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
};
const stores = await storeStatus();
console.log('Stores:', Object.entries(stores).map(([k, v]) => `${k} ${v.live === null ? 'unknown' : v.live ? `live ${v.version}` : 'not live'}`).join(', '));

// The live listings join the app's structured data.
let page = home.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/, (whole, json) => {
  const ld = JSON.parse(json);
  const app = ld['@graph'].find((node) => node['@type'] === 'SoftwareApplication');
  const live = Object.values(stores).filter((store) => store.live).map((store) => store.url);
  if (!app || live.length === 0) return whole;
  app.sameAs = live;
  app.installUrl = live;
  return `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
});
if (!page.includes('<!-- stores -->')) throw new Error('site/index.html lost its <!-- stores --> marker');
page = page.replace('<!-- stores -->', `<script type="application/json" id="stores">${JSON.stringify(stores)}</script>`);
const faqScript = `    <script type="application/ld+json">${JSON.stringify(faqLd)}</script>\n  </head>`;
await writeFile(`${OUT}/index.html`, page.replace('  </head>', faqScript));

if (!privacyPage.includes('<!-- PRIVACY.md -->')) throw new Error('site/privacy.html lost its <!-- PRIVACY.md --> marker');
await mkdir(`${OUT}/privacy`, { recursive: true });
await writeFile(`${OUT}/privacy/index.html`, privacyPage.replace('<!-- PRIVACY.md -->', await marked.parse(privacyMd)));

await mkdir(`${OUT}/support`, { recursive: true });
await writeFile(`${OUT}/support/index.html`, support);

const faqMd = ['## Questions', '', ...faq.flatMap(({ q, a }) => [`### ${q}`, '', a, ''])].join('\n');
await writeFile(`${OUT}/llms-full.txt`, `${llms.trimEnd()}\n\n${faqMd}\n${privacyMd.trim()}\n`);

console.log(`Built ${OUT}/ with ${faq.length} questions`);
