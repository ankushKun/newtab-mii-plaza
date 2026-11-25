// The new tab. Starts the live plaza immediately on open. Pins are edited in a sleek block
// sheet: click an empty block to add a URL, right-click a full one to edit or remove it.
import './style.css';
import { browser } from 'wxt/browser';
import {
  createAnimatedTilePlayer,
  decodeImageBlob,
  loadCustomTile,
  processCustomFile,
  pruneCustomTiles,
  saveCustomTile,
  type AnimatedTilePlayer,
  type StoredCustomTile,
} from '@/newtab/custom';
import { iconFor, peekSiteMeta, probeSiteMeta, pruneIconCache } from '@/newtab/icons';
import { loadMiis, onMiisChanged, saveMiis, toPlazaCast, type MiiCollection } from '@/newtab/miis';
import {
  SLOTS,
  loadState,
  nameFor,
  onStateChanged,
  savePins,
  savePrefs,
  validateUrl,
  type Pin,
  type Pins,
  type Prefs,
  type ThemeMode,
} from '@/newtab/pins';
import type { Plaza } from '@/newtab/plaza';
import type { PlazaPost } from '@/components/plaza/types';
import { CORNER_LINKS, makeSupportBadge } from '@/newtab/support';
import { drawTile, loadBrandLogo } from '@/newtab/tiles';

/** A tab hidden this long gives its GPU back, and reloads when it is shown again. */
const RELEASE_AFTER = 3 * 60 * 1000;

const need = <E extends Element>(el: E | null): E => {
  if (!el) throw new Error('New tab markup is incomplete');
  return el;
};
const root = need(document.querySelector<HTMLElement>('.plaza'));
const nav = need(root.querySelector<HTMLElement>('.plaza-links'));
const clockEl = need(root.querySelector<HTMLElement>('.plaza-clock'));
const timeEl = need(clockEl.querySelector<HTMLTimeElement>('.plaza-time'));
const dateEl = need(clockEl.querySelector<HTMLElement>('.plaza-date'));
const supportEl = need(root.querySelector<HTMLElement>('.plaza-support'));
const toastEl = need(root.querySelector<HTMLElement>('.plaza-toast'));
const manageBtn = need(root.querySelector<HTMLButtonElement>('.hud-manage'));

const editor = need(document.querySelector<HTMLDialogElement>('.editor'));
const form = need(editor.querySelector('form'));
const editorTitle = need(form.querySelector<HTMLElement>('.editor-title'));
const titleInput = need(form.querySelector<HTMLInputElement>('.editor-title-input'));
const tileBtn = need(form.querySelector<HTMLButtonElement>('.editor-tile-btn'));
const editorPreview = need(form.querySelector<HTMLCanvasElement>('.editor-preview'));
const previewGif = need(form.querySelector<HTMLImageElement>('.editor-preview-gif'));
const tileResetBtn = need(form.querySelector<HTMLButtonElement>('.editor-tile-reset'));
const fileInput = need(form.querySelector<HTMLInputElement>('.editor-file'));
const urlField = need(form.querySelector<HTMLInputElement>('[name="url"]'));
const errorEl = need(form.querySelector<HTMLElement>('.editor-error'));
const advancedEl = need(form.querySelector<HTMLDetailsElement>('.editor-advanced'));
const removeButton = need(form.querySelector<HTMLButtonElement>('.editor-remove'));
const cancelButton = need(form.querySelector<HTMLButtonElement>('.editor-cancel'));
const sheetDialog = need(document.querySelector<HTMLDialogElement>('.sheet'));

const links = Array.from({ length: SLOTS }, (_, i) => {
  const a = document.createElement('a');
  a.dataset.slot = String(i);
  a.append(document.createElement('span'));
  nav.append(a);
  return a;
});

const WELCOMED_KEY = 'welcomed';

let [{ pins, prefs }, miis, welcomedGot] = await Promise.all([
  loadState(),
  loadMiis(),
  browser.storage.local.get(WELCOMED_KEY),
]);
let welcomed = Boolean(welcomedGot[WELCOMED_KEY]);
let plaza: Plaza | null = null;
let manageApi: ReturnType<typeof import('@/newtab/manage')['mountManageSheet']> | null = null;

function applyTheme(mode: ThemeMode) {
  if (mode === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
}
applyTheme(prefs.theme);

function label(i: number) {
  const a = links[i];
  const pin = pins[i];
  const tag = a.firstElementChild as HTMLElement;
  if (pin) {
    a.href = pin.url;
    a.removeAttribute('role');
    a.removeAttribute('tabindex');
    a.setAttribute('aria-label', pin.title);
    tag.textContent = pin.title;
  } else {
    a.removeAttribute('href');
    a.setAttribute('role', 'button');
    a.tabIndex = 0;
    a.setAttribute('aria-label', `Add a site to block ${i + 1}`);
    tag.textContent = 'Add site';
  }
  a.classList.toggle('is-empty', !pin);
}
links.forEach((_, i) => label(i));

async function buildTileAsset(pin: Pin | null): Promise<{ art: HTMLCanvasElement; player: AnimatedTilePlayer | null }> {
  if (!pin) return { art: drawTile(null, null), player: null };
  if (pin.customId) {
    const custom = await loadCustomTile(pin.customId);
    if (custom) {
      if (custom.animated) {
        const player = await createAnimatedTilePlayer(custom.blob);
        if (player) return { art: player.canvas, player };
      }
      const img = await decodeImageBlob(custom.blob);
      if (img) return { art: drawTile(pin, null, 512, img), player: null };
    }
  }
  const [icon] = await Promise.all([pin.tile !== 'letter' ? iconFor(pin.url) : Promise.resolve(null), loadBrandLogo()]);
  return { art: drawTile(pin, icon), player: null };
}

async function renderThumbCanvas(pin: Pin | null): Promise<HTMLCanvasElement> {
  if (!pin) return drawTile(null, null, 72);
  if (pin.customId) {
    const custom = await loadCustomTile(pin.customId);
    if (custom) {
      const img = await decodeImageBlob(custom.blob);
      if (img) return drawTile(pin, null, 72, img);
    }
  }
  const [icon] = await Promise.all([pin.tile !== 'letter' ? iconFor(pin.url) : Promise.resolve(null), loadBrandLogo()]);
  return drawTile(pin, icon, 72);
}

let toastTimer = 0;
function showToast(message: string) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 3200);
}

// Optional corner clock (starts only when enabled, after the initial paint) -------------------------

let clockTimer = 0;
function renderClock() {
  clearTimeout(clockTimer);
  if (!prefs.showClock || document.hidden) {
    clockEl.hidden = !prefs.showClock;
    return;
  }
  const now = new Date();
  timeEl.textContent = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: !prefs.clock24h,
  }).format(now);
  timeEl.dateTime = now.toISOString();
  dateEl.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(now);
  clockEl.hidden = false;
  const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 40;
  clockTimer = window.setTimeout(renderClock, Math.max(1000, msToNextMinute));
}

function renderSupport() {
  if (!prefs.showSupport) {
    supportEl.hidden = true;
    return;
  }
  if (!supportEl.hasChildNodes()) {
    for (const item of CORNER_LINKS) {
      const a = document.createElement('a');
      a.className = 'plaza-support-link';
      a.href = item.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('aria-label', `${item.label} (opens in a new tab)`);
      const tag = document.createElement('span');
      tag.className = 'plaza-support-tag';
      tag.textContent = item.label;
      a.append(makeSupportBadge(item), tag);
      supportEl.append(a);
    }
  }
  supportEl.hidden = false;
}

// The plaza --------------------------------------------------------------------------------------

let released = false;
function reloadWhenShown() {
  released = true;
  if (!document.hidden) location.reload();
}

const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 200));

/** The announcement this tab's Mii is about to say or has said, and what to do once it is said. */
let announcing: { post: PlazaPost; said(): void } | null = null;

/** Your Mii says the newest announcement from ankush.one, once across every tab (announce.ts). */
async function announce(activePlaza: Plaza) {
  const { dueAnnouncement, markSeen, onSeen } = await import('@/newtab/announce');
  const one = await dueAnnouncement().catch(() => null);
  if (!one || released || document.hidden || plaza !== activePlaza) return;
  const thumb = one.icon ?? activePlaza.renderPortrait(miis.myMii.code, miis.myMii.leftEye) ?? undefined;
  const post: PlazaPost = {
    cube: 0,
    tag: miis.myMii.name,
    text: one.text,
    href: one.url,
    me: true,
    kind: 'announcement',
    ...(thumb ? { thumb, mii: !one.icon } : {}),
  };
  // Said in another tab first: this one keeps quiet.
  const stop = onSeen((ids) => {
    if (ids.includes(one.id)) activePlaza.bubbles.unsay(post);
  });
  announcing = {
    post,
    said() {
      stop();
      void markSeen(one.id);
    },
  };
  activePlaza.bubbles.sayNext(post, 12);
}

async function boot() {
  const booted = pins;
  const assets = await Promise.all(booted.map(buildTileAsset));
  const { start } = await import('@/newtab/plaza');
  const cast = toPlazaCast(miis);
  plaza = await start(root, {
    links,
    tiles: assets.map((a) => a.art),
    players: assets.map((a) => a.player),
    empty: booted.map((p) => !p),
    theme: prefs.theme,
    muteVoices: prefs.muteVoices,
    hero: cast.hero,
    pool: cast.pool,
    onBubbleClick(post) {
      if (post.href === '#settings') {
        void openManage();
      } else if (post.href) {
        void open(post.href);
      }
    },
    onLive() {
      root.dataset.state = 'live';
      if (prefs.showClock) renderClock();
      renderSupport();
      if (!plaza) return;
      const activePlaza = plaza;
      activePlaza.bubbles.onSay = (post) => {
        if (post === announcing?.post) announcing.said();
        if (post.href !== '#settings' || welcomed) return;
        welcomed = true;
        void browser.storage.local.set({ [WELCOMED_KEY]: true });
      };
      // The first tab shows how things work; announcements wait for the next one.
      if (welcomed) {
        idle(() => void announce(activePlaza));
      } else {
        setTimeout(() => {
          if (welcomed || released || document.hidden || plaza !== activePlaza) return;
          const thumb = activePlaza.renderPortrait(miis.myMii.code, miis.myMii.leftEye) ?? undefined;
          activePlaza.bubbles.sayNext(
            {
              cube: 0,
              tag: miis.myMii.name,
              text: 'Right-click blocks to edit, drag to spin. Add your own in Settings > Miis!',
              href: '#settings',
              me: true,
              ...(thumb ? { thumb, mii: true } : {}),
            },
            12,
          );
        }, 650);
      }
    },
    onLost: reloadWhenShown,
  });
  // Pins changed while it started: those blocks catch up.
  pins.forEach((pin, i) => {
    if (JSON.stringify(pin) === JSON.stringify(booted[i])) return;
    plaza?.setEmpty(i, !pin);
    void buildTileAsset(pin).then(({ art, player }) => plaza?.setTile(i, art, player));
  });
}

function bootWhenShown() {
  if (!document.hidden) return void boot().catch((err: unknown) => console.error('The plaza failed to start', err));
  document.addEventListener('visibilitychange', bootWhenShown, { once: true });
}
if (prefs.showClock) renderClock();
bootWhenShown();

let releaseTimer = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(clockTimer);
    releaseTimer = window.setTimeout(() => {
      if (!plaza) return;
      plaza.destroy();
      released = true;
    }, RELEASE_AFTER);
  } else {
    clearTimeout(releaseTimer);
    if (released) location.reload();
    else if (prefs.showClock) renderClock();
  }
});

// Blocks -----------------------------------------------------------------------------------------

/** Opens a pinned site in this tab. Pages the web can't link to (browser settings) go through the tabs API. */
async function open(url: string) {
  if (/^(https?|file):/i.test(url)) {
    location.assign(url);
    return;
  }
  try {
    await browser.tabs.update({ url });
  } catch {
    plaza?.cancelDive();
    showToast('Browser blocked opening this address directly');
  }
}

links.forEach((a, i) => {
  a.addEventListener('click', (e) => {
    const pin = pins[i];
    if (!pin) {
      e.preventDefault();
      edit(i);
      return;
    }
    // A middle click or a modified one is the browser's: a new tab or window.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (plaza) plaza.dive(i, () => void open(pin.url));
    else void open(pin.url);
  });
  a.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    edit(i);
  });
  a.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!pins[i] && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      edit(i);
    }
  });
});

// Settings & Manage Sheet ------------------------------------------------------------------------

async function openManage() {
  if (!manageApi) {
    const { mountManageSheet } = await import('@/newtab/manage');
    manageApi = mountManageSheet(sheetDialog, {
      getPins: () => pins,
      getPrefs: () => prefs,
      getMiis: () => miis,
      renderThumb: renderThumbCanvas,
      peekMiiPortrait: (code, leftEye) => plaza?.peekPortrait(code, leftEye) ?? null,
      renderMiiPortrait: (code, leftEye) => plaza?.renderPortrait(code, leftEye) ?? null,
      onSavePins: async (next) => {
        await savePins(next);
        void pruneIconCache(next);
        void pruneCustomTiles(next);
      },
      onSavePrefs: async (next) => {
        prefs = next;
        applyTheme(prefs.theme);
        plaza?.setTheme(prefs.theme);
        plaza?.setMuted(prefs.muteVoices);
        renderClock();
        renderSupport();
        await savePrefs(next);
      },
      onSaveMiis: async (next) => {
        miis = next;
        const cast = toPlazaCast(miis);
        plaza?.setMiis(cast.hero, cast.pool);
        await saveMiis(next);
      },
      onEditSlot: (slot) => edit(slot),
      onToast: showToast,
    });
  }
  manageApi.open();
}

manageBtn.addEventListener('click', () => void openManage());
// Never let dragging a file over the new tab page navigate away from the plaza.
document.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  if (e.dataTransfer?.files.length) e.preventDefault();
});
addEventListener('keydown', (e) => {
  if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target instanceof Element && e.target.closest('input, textarea, dialog')) return;
  e.preventDefault();
  void openManage();
});

// Editing ----------------------------------------------------------------------------------------

let editing = -1;
let previewSeq = 0;
let probeTimer = 0;
let metaUrl: string | null = null;
let resolvedMetaUrl: string | null = null;
let fetchedTitle: string | null = null;
let customTitle: string | null = null;
let keepExistingTitle = false;
let fetchedAccent: string | null = null;
let draftCustom: { id?: string; entry: StoredCustomTile; img: HTMLImageElement | null; gifUrl: string | null } | null = null;

function clearDraftGifUrl() {
  if (draftCustom?.gifUrl) URL.revokeObjectURL(draftCustom.gifUrl);
}

function setEditorAccent(accent: string | null) {
  editor.style.setProperty('--tile-accent', accent ?? '#4fbfee');
}

function currentEditorTitle(validUrl: string | null): string {
  if (!validUrl) return editing >= 0 && pins[editing] ? 'Edit block' : 'Add site';
  return customTitle ?? fetchedTitle ?? nameFor(validUrl);
}

function closeTitleEdit(commit: boolean) {
  if (titleInput.hidden) return;
  if (commit) {
    const next = titleInput.value.trim().slice(0, 48);
    customTitle = next || null;
  }
  titleInput.hidden = true;
  editorTitle.hidden = false;
  const checked = validateUrl(urlField.value);
  editorTitle.textContent = currentEditorTitle(checked.ok ? checked.url : null);
}

function paintCanvas(pin: Pin | null, icon: HTMLImageElement | null, customImg: HTMLImageElement | null = null) {
  const g = editorPreview.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, 192, 192);
  g.drawImage(drawTile(pin, icon, 192, customImg), 0, 0);
}

async function updateEditorPreview(opts?: { immediateProbe?: boolean }) {
  const seq = ++previewSeq;
  clearTimeout(probeTimer);
  const checked = validateUrl(urlField.value);
  const validUrl = checked.ok ? checked.url : null;

  if (resolvedMetaUrl !== validUrl) resolvedMetaUrl = null;
  if (metaUrl !== validUrl) {
    metaUrl = validUrl;
    fetchedTitle = null;
    customTitle = null;
    fetchedAccent = null;
    if (!titleInput.hidden) {
      titleInput.hidden = true;
      editorTitle.hidden = false;
    }
  }

  tileResetBtn.hidden = !draftCustom;
  editorTitle.dataset.editable = validUrl ? 'true' : 'false';

  if (draftCustom) {
    if (draftCustom.entry.animated && draftCustom.gifUrl) {
      previewGif.src = draftCustom.gifUrl;
      previewGif.hidden = false;
    } else {
      previewGif.hidden = true;
      previewGif.removeAttribute('src');
      const customPin: Pin = {
        url: validUrl ?? 'https://plaza.local/',
        title: customTitle ?? fetchedTitle ?? (validUrl ? nameFor(validUrl) : 'Custom'),
        ...(fetchedAccent ? { accent: fetchedAccent } : {}),
      };
      paintCanvas(customPin, null, draftCustom.img);
    }
  } else {
    previewGif.hidden = true;
    previewGif.removeAttribute('src');
  }

  if (!validUrl) {
    if (titleInput.hidden) editorTitle.textContent = currentEditorTitle(null);
    setEditorAccent(null);
    editor.dataset.fetch = 'idle';
    if (!draftCustom) paintCanvas(null, null);
    return;
  }

  const peek = peekSiteMeta(validUrl);
  if (peek) {
    if (peek.title && !keepExistingTitle && (!fetchedTitle || fetchedTitle === nameFor(validUrl))) {
      fetchedTitle = peek.title;
    }
    if (peek.accent && !fetchedAccent) fetchedAccent = peek.accent;
    resolvedMetaUrl = validUrl;
  }

  const displayTitle = currentEditorTitle(validUrl);
  if (titleInput.hidden) editorTitle.textContent = displayTitle;
  setEditorAccent(fetchedAccent);

  if (!draftCustom) {
    const previewPin: Pin = { url: validUrl, title: displayTitle, ...(fetchedAccent ? { accent: fetchedAccent } : {}) };
    paintCanvas(previewPin, peek?.icon ?? null);
    if (!peek?.icon) {
      void loadBrandLogo().then((logo) => {
        if (logo && seq === previewSeq && !draftCustom && !peekSiteMeta(validUrl)?.icon) {
          paintCanvas(previewPin, null);
        }
      });
    }
  }
  if (peek) {
    editor.dataset.fetch = peek.ok ? 'done' : 'error';
    return;
  }

  editor.dataset.fetch = 'loading';
  const runProbe = async () => {
    if (seq !== previewSeq) return;
    const [meta] = await Promise.all([probeSiteMeta(validUrl), loadBrandLogo()]);
    if (seq !== previewSeq) return;
    if (meta.title && !customTitle && !keepExistingTitle && (!fetchedTitle || fetchedTitle === nameFor(validUrl))) {
      fetchedTitle = meta.title;
    }
    if (meta.accent) fetchedAccent = meta.accent;
    if (meta.ok) resolvedMetaUrl = validUrl;

    const nextTitle = currentEditorTitle(validUrl);
    if (titleInput.hidden) editorTitle.textContent = nextTitle;
    setEditorAccent(fetchedAccent);
    editor.dataset.fetch = meta.ok ? 'done' : 'error';
    if (!draftCustom) {
      paintCanvas(
        { url: validUrl, title: nextTitle, ...(fetchedAccent ? { accent: fetchedAccent } : {}) },
        meta.icon,
      );
    }
  };

  if (opts?.immediateProbe) void runProbe();
  else probeTimer = window.setTimeout(() => void runProbe(), 240);
}

editorTitle.addEventListener('dblclick', () => {
  if (editorTitle.dataset.editable !== 'true') return;
  titleInput.value = editorTitle.textContent ?? '';
  editorTitle.hidden = true;
  titleInput.hidden = false;
  titleInput.focus();
  titleInput.select();
});

titleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    closeTitleEdit(true);
    urlField.focus();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeTitleEdit(false);
    urlField.focus();
  }
});

titleInput.addEventListener('blur', () => closeTitleEdit(true));

tileBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  void processCustomFile(file).then(async ({ entry, error }) => {
    if (error) {
      errorEl.textContent = error;
      errorEl.hidden = false;
      return;
    }
    errorEl.hidden = true;
    clearDraftGifUrl();
    const img = entry.animated ? null : await decodeImageBlob(entry.blob);
    const gifUrl = entry.animated ? URL.createObjectURL(entry.blob) : null;
    draftCustom = { entry, img, gifUrl };
    void updateEditorPreview({ immediateProbe: true });
  });
});

tileResetBtn.addEventListener('click', () => {
  clearDraftGifUrl();
  draftCustom = null;
  void updateEditorPreview({ immediateProbe: true });
});

function edit(i: number) {
  editing = i;
  const pin = pins[i];
  closeTitleEdit(false);
  editorTitle.textContent = pin ? pin.title : 'Add site';
  urlField.value = pin?.url ?? '';
  metaUrl = pin?.url ?? null;
  fetchedTitle = pin?.title ?? null;
  customTitle = null;
  keepExistingTitle = Boolean(pin);
  fetchedAccent = pin?.accent ?? null;
  resolvedMetaUrl = null;
  clearDraftGifUrl();
  draftCustom = null;
  advancedEl.open = false;
  urlField.removeAttribute('aria-invalid');
  errorEl.hidden = true;
  errorEl.textContent = '';
  removeButton.hidden = !pin;

  void updateEditorPreview({ immediateProbe: true });
  editor.showModal();
  urlField.select();

  if (pin?.customId) {
    const customId = pin.customId;
    void loadCustomTile(customId).then(async (stored) => {
      if (!stored || !editor.open || editing !== i || draftCustom) return;
      const img = stored.animated ? null : await decodeImageBlob(stored.blob);
      const gifUrl = stored.animated ? URL.createObjectURL(stored.blob) : null;
      if (!editor.open || editing !== i || draftCustom) {
        if (gifUrl) URL.revokeObjectURL(gifUrl);
        return;
      }
      draftCustom = { id: customId, entry: stored, img, gifUrl };
      void updateEditorPreview({ immediateProbe: true });
    });
  }
}

async function commit(
  i: number,
  pin: Pin | null,
  customToSave: { id: string; entry: StoredCustomTile } | null,
  keepTitle = false,
) {
  if (customToSave) {
    await saveCustomTile(customToSave.id, customToSave.entry);
  }
  const next = [...pins];
  next[i] = pin;
  // Save immediately so slow network fetches never delay pinning or removing a block.
  await savePins(next);
  void pruneIconCache(next);
  void pruneCustomTiles(next);

  if (!pin || resolvedMetaUrl === pin.url) return;
  const meta = await probeSiteMeta(pin.url);
  const updatedTitle = keepTitle ? pin.title : meta.title || pin.title;
  const updatedAccent = meta.accent || pin.accent;
  const latest = pins[i];
  if (latest && latest.url === pin.url && (updatedTitle !== latest.title || updatedAccent !== latest.accent)) {
    const enriched = [...pins];
    enriched[i] = {
      ...latest,
      title: updatedTitle,
      ...(updatedAccent ? { accent: updatedAccent } : {}),
    };
    await savePins(enriched);
  } else if (!latest?.customId && meta.icon) {
    plaza?.setTile(i, drawTile(latest, meta.icon));
  }
}

urlField.addEventListener('input', () => {
  urlField.removeAttribute('aria-invalid');
  errorEl.hidden = true;
  fetchedTitle = null;
  customTitle = null;
  keepExistingTitle = false;
  fetchedAccent = null;
  void updateEditorPreview();
});

form.addEventListener('submit', (e) => {
  closeTitleEdit(true);
  const checked = validateUrl(urlField.value);
  if (!checked.ok) {
    e.preventDefault();
    urlField.setAttribute('aria-invalid', 'true');
    errorEl.textContent = checked.reason;
    errorEl.hidden = false;
    urlField.focus();
    return;
  }

  let customId: string | undefined;
  let customToSave: { id: string; entry: StoredCustomTile } | null = null;
  if (draftCustom) {
    if (draftCustom.id) {
      customId = draftCustom.id;
    } else {
      customId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      customToSave = { id: customId, entry: draftCustom.entry };
    }
  }

  const keepTitle = Boolean(customTitle) || keepExistingTitle;
  const pin: Pin = {
    url: checked.url,
    title: currentEditorTitle(checked.url),
    ...(fetchedAccent ? { accent: fetchedAccent } : {}),
    ...(customId ? { customId } : {}),
  };

  void commit(editing, pin, customToSave, keepTitle);
});

removeButton.addEventListener('click', () => {
  editor.close();
  void commit(editing, null, null);
});
cancelButton.addEventListener('click', () => editor.close());
editor.addEventListener('cancel', (e) => {
  if (!titleInput.hidden) {
    e.preventDefault();
    closeTitleEdit(false);
  }
});
editor.addEventListener('close', () => {
  clearTimeout(probeTimer);
  closeTitleEdit(false);
  editor.dataset.fetch = 'idle';
  clearDraftGifUrl();
  draftCustom = null;
  previewGif.hidden = true;
  previewGif.removeAttribute('src');
});
editor.addEventListener('click', (e) => {
  if (e.target === editor) editor.close();
});

// Every open tab hears a change, this one included, and updates blocks or preferences.
onStateChanged(({ pins: nextPins, prefs: nextPrefs }) => {
  if (nextPrefs) {
    prefs = nextPrefs;
    applyTheme(prefs.theme);
    plaza?.setTheme(prefs.theme);
    plaza?.setMuted(prefs.muteVoices);
    renderClock();
    renderSupport();
    manageApi?.refresh();
  }
  if (!nextPins) return;
  const was = pins;
  pins = nextPins;
  nextPins.forEach((pin, i) => {
    if (JSON.stringify(pin) === JSON.stringify(was[i])) return;
    label(i);
    plaza?.setEmpty(i, !pin);
    void buildTileAsset(pin).then(({ art, player }) => plaza?.setTile(i, art, player));
  });
  manageApi?.refresh();
});

onMiisChanged((nextMiis: MiiCollection) => {
  if (JSON.stringify(nextMiis) === JSON.stringify(miis)) return;
  miis = nextMiis;
  const cast = toPlazaCast(miis);
  plaza?.setMiis(cast.hero, cast.pool);
  manageApi?.refresh();
});
