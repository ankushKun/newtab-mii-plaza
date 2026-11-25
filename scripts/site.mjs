// Builds the project page into .site/ for GitHub Pages (.github/workflows/pages.yml), served at
// https://ankush.one/newtab-mii-plaza/. site/index.html is the home page, site/support.html becomes /support/, and
// PRIVACY.md is rendered into site/privacy.html as /privacy/, so the stores' privacy link always matches the repo.
// The questions on the home page are the one source for its FAQPage structured data and for llms-full.txt.
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { marked } from 'marked';

const OUT = '.site';
const HOME = 'https://ankush.one/newtab-mii-plaza/';

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
const faqScript = `    <script type="application/ld+json">${JSON.stringify(faqLd)}</script>\n  </head>`;
await writeFile(`${OUT}/index.html`, home.replace('  </head>', faqScript));

if (!privacyPage.includes('<!-- PRIVACY.md -->')) throw new Error('site/privacy.html lost its <!-- PRIVACY.md --> marker');
await mkdir(`${OUT}/privacy`, { recursive: true });
await writeFile(`${OUT}/privacy/index.html`, privacyPage.replace('<!-- PRIVACY.md -->', await marked.parse(privacyMd)));

await mkdir(`${OUT}/support`, { recursive: true });
await writeFile(`${OUT}/support/index.html`, support);

const faqMd = ['## Questions', '', ...faq.flatMap(({ q, a }) => [`### ${q}`, '', a, ''])].join('\n');
await writeFile(`${OUT}/llms-full.txt`, `${llms.trimEnd()}\n\n${faqMd}\n${privacyMd.trim()}\n`);

console.log(`Built ${OUT}/ with ${faq.length} questions`);
