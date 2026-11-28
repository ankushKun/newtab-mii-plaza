// Builds the project page into .site/ for GitHub Pages (.github/workflows/pages.yml), served at
// https://ankush.one/newtab-mii-plaza/. site/index.html is the home page, site/support.html becomes /support/, and
// PRIVACY.md is rendered into site/privacy.html as /privacy/, so the stores' privacy link always matches the repo.
// The questions on the home page are the one source for its FAQPage structured data and for llms-full.txt.
// Each build also writes the latest version on each store and on GitHub under the buttons (the Pages workflow reruns
// every few hours, since store reviews land on their own schedule).
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { marked } from 'marked';

const OUT = '.site';
const HOME = 'https://ankush.one/newtab-mii-plaza/';
const CHROME_ID = 'iomoadjdgikohalaohjpabppalbomibk';
const AMO_SLUG = 'newtab-mii-plaza';
const REPO = 'ankushKun/newtab-mii-plaza';

/** The latest version on each store and on GitHub, skipping any that couldn't be asked. */
async function latestVersions() {
  const ask = async (url, read, headers = {}) => {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
      return res.ok ? await read(res) : undefined;
    } catch {
      return undefined;
    }
  };
  const github = process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
  const versions = await Promise.all([
    // Chrome's own update check.
    ask(
      `https://clients2.google.com/service/update2/crx?response=updatecheck&acceptformat=crx2,crx3&prodversion=140.0&x=id%3D${CHROME_ID}%26uc`,
      async (res) => /<updatecheck\b[^>]*\bversion="([\d.]+)"/.exec(await res.text())?.[1],
    ),
    ask(`https://addons.mozilla.org/api/v5/addons/addon/${AMO_SLUG}/`, async (res) => (await res.json()).current_version?.version),
    ask(`https://api.github.com/repos/${REPO}/releases/latest`, async (res) => (await res.json()).tag_name?.replace(/^v/, ''), github),
  ]);
  return [
    { name: 'Chrome Web Store', url: `https://chromewebstore.google.com/detail/${CHROME_ID}` },
    { name: 'Firefox Add-ons', url: `https://addons.mozilla.org/firefox/addon/${AMO_SLUG}/` },
    { name: 'GitHub', url: `https://github.com/${REPO}/releases/latest` },
  ]
    .map((source, i) => ({ ...source, version: versions[i] }))
    .filter((source) => source.version);
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
const versions = await latestVersions();
console.log('Versions:', versions.map((v) => `${v.name} ${v.version}`).join(', ') || 'none');
if (!home.includes('<!-- versions -->')) throw new Error('site/index.html lost its <!-- versions --> marker');
const versionLine = versions.length
  ? `<p class="versions">${versions.map((v) => `<a href="${v.url}">${v.name} <b>v${v.version}</b></a>`).join('')}</p>`
  : '';
const page = home.replace('<!-- versions -->', versionLine);
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
