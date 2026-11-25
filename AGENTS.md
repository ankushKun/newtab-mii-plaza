## This project

Read `README.md` first. Conventions to keep:

- This repo maintains its own independent copy of `src/components/` and `public/ffl/` (originally adapted from ankush.one). Put new tab behaviour in `src/newtab/` and the page in `src/entrypoints/newtab/` unless a plaza or shader change belongs in `src/components/`.
- Anything that adds cost to opening a tab (more Miis, more frames, work before the still shows) needs a measurement in Chrome to back it.
- Never use em dashes (U+2014) or en dashes (U+2013) anywhere: code, comments, docs, UI copy or commit messages.
- Run `pnpm check && pnpm build` before calling a change done.
