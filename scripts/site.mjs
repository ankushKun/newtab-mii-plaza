// Builds the project page into .site/ for GitHub Pages (.github/workflows/pages.yml), served at
// https://ankush.one/newtab-mii-plaza/. The page is site/; the privacy policy is PRIVACY.md rendered into
// site/privacy.html, so the stores' privacy link always matches the file in the repo.
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { marked } from 'marked';

const OUT = '.site';

await rm(OUT, { recursive: true, force: true });
await cp('site', OUT, { recursive: true, filter: (path) => !path.endsWith('privacy.html') });
await copyFile('public/icon/128.png', `${OUT}/icon.png`);

const template = await readFile('site/privacy.html', 'utf8');
const policy = await marked.parse(await readFile('PRIVACY.md', 'utf8'));
if (!template.includes('<!-- PRIVACY.md -->')) throw new Error('site/privacy.html lost its <!-- PRIVACY.md --> marker');
await mkdir(`${OUT}/privacy`, { recursive: true });
await writeFile(`${OUT}/privacy/index.html`, template.replace('<!-- PRIVACY.md -->', policy));

console.log(`Built ${OUT}/`);
