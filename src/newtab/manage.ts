// Lazy-loaded Settings, spatial Plaza map, Mii QR manager, and Backup sheet.
// Loaded only when opened so normal tab opens pay zero parse or DOM cost for it.
import { FAVORITE_COLORS } from '../components/mii/data';
import {
  addCrowdMiis,
  clearCrowdMiis,
  DEFAULT_MY_MII,
  isDefaultMyMii,
  readMiiMeta,
  removeCrowdMii,
  resetMyMii,
  setMyMii,
  type MiiCollection,
  type StoredMii,
} from './miis';
import { exportPins, importPins, SLOTS, swapPins, type Pin, type Pins, type Prefs, type ThemeMode } from './pins';
import { drawTile, loadBrandLogo } from './tiles';

export interface ManageContext {
  getPins: () => Pins;
  getPrefs: () => Prefs;
  getMiis: () => MiiCollection;
  getZoom: () => number;
  renderThumb: (pin: Pin | null) => Promise<HTMLCanvasElement>;
  peekMiiPortrait: (code: string, leftEye?: string) => string | null;
  renderMiiPortrait: (code: string, leftEye?: string) => string | null;
  onSavePins: (next: Pins) => Promise<void>;
  onSavePrefs: (next: Prefs) => Promise<void>;
  onSaveMiis: (next: MiiCollection) => Promise<void>;
  onEditSlot: (slot: number) => void;
  onSetZoom: (level: number) => void;
  onToast: (message: string) => void;
}

type SheetTab = 'settings' | 'miis';

const ZOOM_PRESETS = [
  { label: 'Wide', level: 0 },
  { label: 'Standard', level: 1 },
  { label: 'Closer', level: 2 },
  { label: 'Crowd', level: 3 },
];

const THEME_MODES: { label: string; value: ThemeMode }[] = [
  { label: 'Auto', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

function colorStyle(favoriteColor: number): { bg: string; fg: string } {
  const hex = FAVORITE_COLORS[favoriteColor] ?? FAVORITE_COLORS[5];
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return {
    bg: `#${hex.toString(16).padStart(6, '0')}`,
    fg: lum > 0.66 ? '#1c1d20' : '#ffffff',
  };
}

function setAvatarPortrait(avatar: HTMLElement, url: string) {
  const img = document.createElement('img');
  img.src = url;
  img.alt = '';
  avatar.replaceChildren(img);
}

function makeMiiAvatar(mii: StoredMii, isOwner: boolean, portraitUrl: string | null): HTMLElement {
  const meta = readMiiMeta(mii.code);
  const { bg, fg } = colorStyle(meta?.favoriteColor ?? 5);
  const avatar = document.createElement('span');
  avatar.className = 'mii-avatar';
  avatar.style.background = bg;
  avatar.style.color = fg;
  avatar.setAttribute('aria-hidden', 'true');
  if (portraitUrl) {
    setAvatarPortrait(avatar, portraitUrl);
  } else {
    const letter = (mii.name.trim()[0] ?? 'M').toUpperCase();
    avatar.textContent = letter;
  }
  if (isOwner) {
    avatar.dataset.owner = 'true';
  }
  return avatar;
}

export function mountManageSheet(dialog: HTMLDialogElement, ctx: ManageContext) {
  const head = dialog.querySelector<HTMLElement>('.sheet-head');
  const content = dialog.querySelector<HTMLElement>('.sheet-content');
  const closeBtn = dialog.querySelector<HTMLButtonElement>('.sheet-close');
  if (!head || !content || !closeBtn) throw new Error('Manage sheet markup is incomplete');

  let activeTab: SheetTab = 'settings';
  let dragFrom = -1;
  let renderSeq = 0;
  let miiStatus: { kind: 'info' | 'error'; text: string } | null = null;
  let scanning = false;
  let portraitObserver: IntersectionObserver | null = null;
  let portraitRaf = 0;

  const stopPortraitHydration = () => {
    portraitObserver?.disconnect();
    portraitObserver = null;
    if (portraitRaf) {
      cancelAnimationFrame(portraitRaf);
      portraitRaf = 0;
    }
  };

  const tabsNav = document.createElement('div');
  tabsNav.className = 'segmented sheet-tabs';
  tabsNav.setAttribute('role', 'tablist');
  tabsNav.setAttribute('aria-label', 'Settings sections');

  const settingsTabBtn = document.createElement('button');
  settingsTabBtn.type = 'button';
  settingsTabBtn.className = 'seg-btn';
  settingsTabBtn.setAttribute('role', 'tab');
  settingsTabBtn.textContent = 'Settings';

  const miisTabBtn = document.createElement('button');
  miisTabBtn.type = 'button';
  miisTabBtn.className = 'seg-btn';
  miisTabBtn.setAttribute('role', 'tab');
  miisTabBtn.textContent = 'Miis';

  tabsNav.append(settingsTabBtn, miisTabBtn);
  head.insertBefore(tabsNav, closeBtn);

  const syncTabButtons = () => {
    const totalMiis = 1 + ctx.getMiis().crowd.length;
    miisTabBtn.textContent = `Miis (${totalMiis})`;
    settingsTabBtn.setAttribute('aria-selected', String(activeTab === 'settings'));
    settingsTabBtn.setAttribute('aria-pressed', String(activeTab === 'settings'));
    miisTabBtn.setAttribute('aria-selected', String(activeTab === 'miis'));
    miisTabBtn.setAttribute('aria-pressed', String(activeTab === 'miis'));
  };

  settingsTabBtn.addEventListener('click', () => {
    if (activeTab === 'settings') return;
    activeTab = 'settings';
    render();
  });
  miisTabBtn.addEventListener('click', () => {
    if (activeTab === 'miis') return;
    activeTab = 'miis';
    render();
  });

  closeBtn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', stopPortraitHydration);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  async function scanFiles(files: File[], target: 'crowd' | 'myMii') {
    if (!files.length || scanning) return;
    scanning = true;
    miiStatus = { kind: 'info', text: files.length === 1 ? 'Scanning QR code...' : `Scanning ${files.length} QR codes...` };
    if (dialog.open && activeTab === 'miis') render();

    try {
      const { scanMiiQrFile } = await import('./qr');
      if (target === 'myMii') {
        const res = await scanMiiQrFile(files[0]);
        if (!res.ok) {
          miiStatus = { kind: 'error', text: res.error };
          return;
        }
        const next = setMyMii(ctx.getMiis(), res.code, res.name);
        await ctx.onSaveMiis(next);
        miiStatus = { kind: 'info', text: `Updated your Mii to ${res.name}` };
        ctx.onToast(`Updated your Mii to ${res.name}`);
        return;
      }

      const scanned: { name: string; code: string }[] = [];
      const errors: string[] = [];
      for (const file of files) {
        const res = await scanMiiQrFile(file);
        if (res.ok) scanned.push({ name: res.name, code: res.code });
        else errors.push(`${file.name || 'Image'}: ${res.error}`);
      }

      if (scanned.length) {
        const { next, added, duplicates } = addCrowdMiis(ctx.getMiis(), scanned);
        if (added > 0) await ctx.onSaveMiis(next);
        const parts: string[] = [];
        if (added > 0) parts.push(`Added ${added} ${added === 1 ? 'Mii' : 'Miis'}`);
        if (duplicates > 0) parts.push(`${duplicates} already in plaza`);
        if (errors.length > 0) parts.push(`${errors.length} failed`);
        const msg = parts.join(', ');
        miiStatus = { kind: added > 0 ? 'info' : 'error', text: msg || 'No new Miis added' };
        if (added > 0) ctx.onToast(`Added ${added} ${added === 1 ? 'Mii' : 'Miis'} to plaza`);
      } else {
        miiStatus = { kind: 'error', text: errors[0] ?? 'Could not scan a Mii QR code from that image' };
      }
    } finally {
      scanning = false;
      if (dialog.open && activeTab === 'miis') render();
    }
  }

  dialog.addEventListener('paste', (e) => {
    if (!dialog.open || activeTab !== 'miis') return;
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    void scanFiles(files, 'crowd');
  });

  // Dropping a QR image anywhere on the Settings dialog while on the Miis tab scans it instead
  // of letting the browser navigate the new tab away to the dropped file.
  dialog.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  dialog.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    if (dialog.open && activeTab === 'miis') {
      void scanFiles([...e.dataTransfer.files], 'crowd');
    }
  });

  function makeSlotButton(pin: Pin | null, i: number, seq: number, mapEl: HTMLElement): HTMLButtonElement {
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'map-slot';
    slot.dataset.empty = String(!pin);
    slot.draggable = true;
    slot.title = pin ? `${pin.title} (${pin.url})` : `Add site to block ${i + 1}`;

    slot.addEventListener('click', () => {
      dialog.close();
      ctx.onEditSlot(i);
    });

    slot.addEventListener('dragstart', (e) => {
      dragFrom = i;
      slot.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
      }
    });
    slot.addEventListener('dragend', () => {
      dragFrom = -1;
      slot.classList.remove('is-dragging');
      mapEl.querySelectorAll('.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
    });
    slot.addEventListener('dragover', (e) => {
      if (dragFrom < 0 || dragFrom === i) return;
      e.preventDefault();
      slot.classList.add('is-drop-target');
    });
    slot.addEventListener('dragleave', () => slot.classList.remove('is-drop-target'));
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('is-drop-target');
      const from = dragFrom >= 0 ? dragFrom : Number(e.dataTransfer?.getData('text/plain') ?? -1);
      if (from >= 0 && from !== i && from < SLOTS) {
        void ctx.onSavePins(swapPins(ctx.getPins(), from, i));
      }
    });

    const tile = document.createElement('span');
    tile.className = 'map-tile';

    const thumb = document.createElement('canvas');
    thumb.className = 'map-thumb';
    thumb.width = thumb.height = 72;
    thumb.getContext('2d')?.drawImage(drawTile(pin, null, 72), 0, 0);
    if (pin) {
      void ctx.renderThumb(pin).then((art) => {
        if (seq !== renderSeq) return;
        const g = thumb.getContext('2d');
        if (!g) return;
        g.clearRect(0, 0, 72, 72);
        g.drawImage(art, 0, 0, 72, 72);
      });
    } else {
      void loadBrandLogo();
    }

    const sheen = document.createElement('span');
    sheen.className = 'map-tile-sheen';
    sheen.setAttribute('aria-hidden', 'true');
    tile.append(thumb, sheen);

    const name = document.createElement('span');
    name.className = 'map-name';
    name.textContent = pin ? pin.title : `Block ${i + 1}`;

    slot.append(tile, name);
    return slot;
  }

  function renderSettingsTab(seq: number) {
    const pins = ctx.getPins();
    const prefs = ctx.getPrefs();
    const activeZoom = Math.round(ctx.getZoom());

    // 1. Spatial 4-2-4 Plaza Map mirroring the real 3D layout
    const map = document.createElement('section');
    map.className = 'plaza-map';
    map.setAttribute('aria-label', 'Plaza layout');

    const backRow = document.createElement('div');
    backRow.className = 'map-row map-row-4';
    for (let i = 0; i < 4; i++) backRow.append(makeSlotButton(pins[i], i, seq, map));

    const midRow = document.createElement('div');
    midRow.className = 'map-row map-row-mid';
    const centerNote = document.createElement('div');
    centerNote.className = 'map-center';
    const centerTitle = document.createElement('span');
    centerTitle.textContent = 'Drag blocks to swap';
    const centerSub = document.createElement('small');
    centerSub.textContent = 'Click any block to edit';
    centerNote.append(centerTitle, centerSub);
    midRow.append(makeSlotButton(pins[4], 4, seq, map), centerNote, makeSlotButton(pins[5], 5, seq, map));

    const frontRow = document.createElement('div');
    frontRow.className = 'map-row map-row-4';
    for (let i = 6; i < 10; i++) frontRow.append(makeSlotButton(pins[i], i, seq, map));

    map.append(backRow, midRow, frontRow);

    // 2. Grouped Glass Settings Card
    const group = document.createElement('div');
    group.className = 'settings-group';

    // Theme row
    const themeRow = document.createElement('div');
    themeRow.className = 'settings-row';
    const themeLabel = document.createElement('span');
    themeLabel.className = 'settings-label';
    themeLabel.textContent = 'Theme';
    const themePills = document.createElement('div');
    themePills.className = 'segmented';
    for (const mode of THEME_MODES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'seg-btn';
      btn.textContent = mode.label;
      btn.setAttribute('aria-pressed', String(prefs.theme === mode.value));
      btn.addEventListener('click', () => {
        themePills.querySelectorAll('.seg-btn').forEach((el, idx) => {
          el.setAttribute('aria-pressed', String(THEME_MODES[idx].value === mode.value));
        });
        void ctx.onSavePrefs({ ...ctx.getPrefs(), theme: mode.value });
      });
      themePills.append(btn);
    }
    themeRow.append(themeLabel, themePills);

    // Zoom row
    const zoomRow = document.createElement('div');
    zoomRow.className = 'settings-row';
    const zoomLabel = document.createElement('span');
    zoomLabel.className = 'settings-label';
    zoomLabel.textContent = 'Zoom';
    const zoomPills = document.createElement('div');
    zoomPills.className = 'segmented';
    for (const preset of ZOOM_PRESETS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'seg-btn';
      btn.textContent = preset.label;
      btn.setAttribute('aria-pressed', String(activeZoom === preset.level));
      btn.addEventListener('click', () => {
        ctx.onSetZoom(preset.level);
        zoomPills.querySelectorAll('.seg-btn').forEach((el, idx) => {
          el.setAttribute('aria-pressed', String(ZOOM_PRESETS[idx].level === preset.level));
        });
      });
      zoomPills.append(btn);
    }
    zoomRow.append(zoomLabel, zoomPills);

    // Clock row (with pill switch + optional 24-hour chip)
    const clockRow = document.createElement('div');
    clockRow.className = 'settings-row';
    const clockLabel = document.createElement('span');
    clockLabel.className = 'settings-label';
    clockLabel.textContent = 'Corner clock';

    const clockControls = document.createElement('div');
    clockControls.className = 'settings-inline';

    const hourBtn = document.createElement('button');
    hourBtn.type = 'button';
    hourBtn.className = 'pill-chip';
    hourBtn.textContent = '24h';
    hourBtn.setAttribute('aria-pressed', String(prefs.clock24h));
    hourBtn.hidden = !prefs.showClock;

    const clockSwitch = document.createElement('input');
    clockSwitch.type = 'checkbox';
    clockSwitch.className = 'switch';
    clockSwitch.checked = prefs.showClock;
    clockSwitch.setAttribute('aria-label', 'Show subtle clock in corner');

    clockSwitch.addEventListener('change', () => {
      hourBtn.hidden = !clockSwitch.checked;
      void ctx.onSavePrefs({ ...ctx.getPrefs(), showClock: clockSwitch.checked });
    });
    hourBtn.addEventListener('click', () => {
      const next24 = !ctx.getPrefs().clock24h;
      hourBtn.setAttribute('aria-pressed', String(next24));
      void ctx.onSavePrefs({ ...ctx.getPrefs(), clock24h: next24 });
    });

    clockControls.append(hourBtn, clockSwitch);
    clockRow.append(clockLabel, clockControls);

    // Mii voices row
    const voicesRow = document.createElement('div');
    voicesRow.className = 'settings-row';
    const voicesLabel = document.createElement('span');
    voicesLabel.className = 'settings-label';
    voicesLabel.textContent = 'Mii voices';

    const voicesSwitch = document.createElement('input');
    voicesSwitch.type = 'checkbox';
    voicesSwitch.className = 'switch';
    voicesSwitch.checked = !prefs.muteVoices;
    voicesSwitch.setAttribute('aria-label', 'Play Mii voices and plaza sound effects');
    voicesSwitch.addEventListener('change', () => {
      void ctx.onSavePrefs({ ...ctx.getPrefs(), muteVoices: !voicesSwitch.checked });
    });
    voicesRow.append(voicesLabel, voicesSwitch);

    // Backup row
    const backupRow = document.createElement('div');
    backupRow.className = 'settings-row';
    const backupLabel = document.createElement('span');
    backupLabel.className = 'settings-label';
    backupLabel.textContent = 'Backup';
    const backupActions = document.createElement('div');
    backupActions.className = 'settings-inline';

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'pill-btn';
    exportBtn.textContent = 'Export';
    exportBtn.addEventListener('click', () => {
      const blob = new Blob([exportPins(ctx.getPins())], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = 'plaza-pins.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      ctx.onToast('Exported pins to plaza-pins.json');
    });

    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = 'application/json,.json';
    importInput.hidden = true;
    importInput.addEventListener('change', () => {
      const file = importInput.files?.[0];
      importInput.value = '';
      if (!file) return;
      void file.text().then((text) => {
        const imported = importPins(text);
        if (!imported) {
          ctx.onToast('Could not read pins from that JSON file');
          return;
        }
        void ctx.onSavePins(imported).then(() => {
          ctx.onToast('Imported pinned blocks');
        });
      });
    });

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'pill-btn';
    importBtn.textContent = 'Import';
    importBtn.addEventListener('click', () => importInput.click());

    backupActions.append(exportBtn, importBtn, importInput);
    backupRow.append(backupLabel, backupActions);

    group.append(themeRow, zoomRow, clockRow, voicesRow, backupRow);

    // 3. Compact footer chips + privacy
    const footer = document.createElement('div');
    footer.className = 'sheet-footer';

    const hints = document.createElement('div');
    hints.className = 'hints-bar';
    const hintItems: [string, string][] = [
      ['Click', 'Open'],
      ['Right-click', 'Edit'],
      ['Drag block', 'Spin'],
      ['Scroll', 'Zoom'],
      ['Middle drag', 'Pan'],
      ['Drag people', 'Toss'],
    ];
    for (const [k, v] of hintItems) {
      const chip = document.createElement('span');
      chip.className = 'hint-chip';
      const kbd = document.createElement('b');
      kbd.textContent = k;
      chip.append(kbd, ` ${v}`);
      hints.append(chip);
    }

    const privacy = document.createElement('p');
    privacy.className = 'sheet-privacy';
    privacy.textContent = 'Pins sync via your browser account. Custom images and Miis stay on this device.';

    const linksBar = document.createElement('nav');
    linksBar.className = 'sheet-links';
    linksBar.setAttribute('aria-label', 'Project links');

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const makeBrandSvg = (d: string) => {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '12');
      svg.setAttribute('height', '12');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('fill', 'currentColor');
      path.setAttribute('d', d);
      svg.append(path);
      return svg;
    };

    const GITHUB_PATH =
      'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12';
    const X_PATH =
      'M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z';
    const GLOBE_PATH =
      'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.93 6h-3.15a15.65 15.65 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.93 8ZM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96ZM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26Zm.81 2h3.15a15.65 15.65 0 0 0 1.38 3.56A8.03 8.03 0 0 1 5.07 16Zm3.15-8H5.07a8.03 8.03 0 0 1 4.53-3.56A15.65 15.65 0 0 0 8.22 8ZM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96ZM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2Zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h3.15a8.03 8.03 0 0 1-4.53 3.56ZM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38Z';

    const portraitUrl = ctx.renderMiiPortrait(DEFAULT_MY_MII.code, DEFAULT_MY_MII.leftEye);
    const linkItems: { label: string; href: string; bg: string; img?: string; svgPath?: string }[] = [
      { label: 'ankush.one', href: 'https://ankush.one/', bg: '#d21e14', img: portraitUrl ?? undefined, svgPath: GLOBE_PATH },
      { label: 'GitHub', href: 'https://github.com/ankushKun/new-tab-mii-plaza', bg: '#181717', svgPath: GITHUB_PATH },
      { label: 'Twitter', href: 'https://x.com/ankushKun_', bg: '#000000', svgPath: X_PATH },
    ];
    for (const item of linkItems) {
      const a = document.createElement('a');
      a.className = 'sheet-link';
      a.href = item.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';

      const badge = document.createElement('span');
      badge.className = 'sheet-link-badge';
      badge.style.background = item.bg;
      badge.setAttribute('aria-hidden', 'true');
      if (item.img) {
        const img = document.createElement('img');
        img.src = item.img;
        img.alt = '';
        badge.append(img);
      } else if (item.svgPath) {
        badge.append(makeBrandSvg(item.svgPath));
      }

      const text = document.createElement('span');
      text.textContent = item.label;
      a.append(badge, text);
      linksBar.append(a);
    }

    footer.append(hints, privacy, linksBar);
    content!.append(map, group, footer);
  }

  function renderMiisTab(seq: number) {
    const collection = ctx.getMiis();

    // 1. Your Mii (Default, Undeletable)
    const mySection = document.createElement('section');
    mySection.className = 'mii-section';

    const myHead = document.createElement('div');
    myHead.className = 'mii-section-head';
    const myHeading = document.createElement('h3');
    myHeading.textContent = 'Your Mii';
    const myTag = document.createElement('span');
    myTag.className = 'mii-tag';
    myTag.textContent = 'Default (kept in plaza)';
    myHead.append(myHeading, myTag);

    const myCard = document.createElement('div');
    myCard.className = 'settings-group';
    const myRow = document.createElement('div');
    myRow.className = 'mii-row';

    const myInfoWrap = document.createElement('div');
    myInfoWrap.className = 'mii-main';
    const myText = document.createElement('div');
    myText.className = 'mii-text';
    const myName = document.createElement('span');
    myName.className = 'mii-name';
    myName.textContent = collection.myMii.name;
    const mySub = document.createElement('span');
    mySub.className = 'mii-sub';
    const isDefault = isDefaultMyMii(collection.myMii);
    mySub.textContent = isDefault ? 'Default Mii (undeletable)' : 'Custom QR Mii (undeletable)';
    myText.append(myName, mySub);
    myInfoWrap.append(makeMiiAvatar(collection.myMii, true, ctx.renderMiiPortrait(collection.myMii.code, collection.myMii.leftEye)), myText);

    const myActions = document.createElement('div');
    myActions.className = 'settings-inline';
    const myInput = document.createElement('input');
    myInput.type = 'file';
    myInput.accept = 'image/*';
    myInput.hidden = true;
    myInput.addEventListener('change', () => {
      const files = [...(myInput.files ?? [])];
      myInput.value = '';
      if (files.length) void scanFiles(files.slice(0, 1), 'myMii');
    });

    const replaceBtn = document.createElement('button');
    replaceBtn.type = 'button';
    replaceBtn.className = 'pill-btn';
    replaceBtn.textContent = 'Replace QR';
    replaceBtn.disabled = scanning;
    replaceBtn.addEventListener('click', () => myInput.click());

    myActions.append(replaceBtn, myInput);
    if (!isDefault) {
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'pill-btn';
      resetBtn.textContent = 'Reset';
      resetBtn.disabled = scanning;
      resetBtn.addEventListener('click', () => {
        void ctx.onSaveMiis(resetMyMii(ctx.getMiis())).then(() => {
          miiStatus = { kind: 'info', text: 'Restored default My Mii' };
          ctx.onToast('Restored default My Mii');
          if (dialog.open && activeTab === 'miis') render();
        });
      });
      myActions.append(resetBtn);
    }

    myRow.append(myInfoWrap, myActions);
    myCard.append(myRow);
    mySection.append(myHead, myCard);

    // 2. Upload Mii QR Codes Dropzone
    const uploadSection = document.createElement('section');
    uploadSection.className = 'mii-section';

    const uploadInput = document.createElement('input');
    uploadInput.type = 'file';
    uploadInput.accept = 'image/*';
    uploadInput.multiple = true;
    uploadInput.hidden = true;
    uploadInput.addEventListener('change', () => {
      const files = [...(uploadInput.files ?? [])];
      uploadInput.value = '';
      if (files.length) void scanFiles(files, 'crowd');
    });

    const dropzone = document.createElement('button');
    dropzone.type = 'button';
    dropzone.className = 'mii-dropzone';
    dropzone.disabled = scanning;
    dropzone.addEventListener('click', () => uploadInput.click());
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('is-over');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-over'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('is-over');
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) void scanFiles(files, 'crowd');
    });

    const dropTitle = document.createElement('span');
    dropTitle.className = 'mii-drop-title';
    dropTitle.textContent = scanning ? 'Scanning QR code...' : 'Upload Mii QR code images';
    const dropSub = document.createElement('span');
    dropSub.className = 'mii-drop-sub';
    dropSub.textContent = 'Click, drop, or paste 3DS / Wii U Mii QR images';
    dropzone.append(dropTitle, dropSub);
    uploadSection.append(dropzone, uploadInput);

    if (miiStatus) {
      const status = document.createElement('p');
      status.className = 'mii-status';
      status.dataset.kind = miiStatus.kind;
      status.setAttribute('role', miiStatus.kind === 'error' ? 'alert' : 'status');
      status.textContent = miiStatus.text;
      uploadSection.append(status);
    }

    // 3. Uploaded Crowd Miis List
    const listSection = document.createElement('section');
    listSection.className = 'mii-section';

    const listHead = document.createElement('div');
    listHead.className = 'mii-section-head';
    const listHeading = document.createElement('h3');
    listHeading.textContent = `Plaza Miis (${collection.crowd.length})`;
    listHead.append(listHeading);

    if (collection.crowd.length > 0) {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'mii-clear-btn';
      clearBtn.textContent = 'Remove all';
      clearBtn.addEventListener('click', () => {
        void ctx.onSaveMiis(clearCrowdMiis(ctx.getMiis())).then(() => {
          miiStatus = { kind: 'info', text: 'Removed uploaded Miis (kept your default Mii)' };
          ctx.onToast('Removed uploaded Miis');
          if (dialog.open && activeTab === 'miis') render();
        });
      });
      listHead.append(clearBtn);
    }
    listSection.append(listHead);

    if (collection.crowd.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'mii-empty';
      empty.textContent = 'No uploaded Miis yet. Scan a Mii QR code above to spawn them in your plaza.';
      listSection.append(empty);
    } else {
      const listCard = document.createElement('div');
      listCard.className = 'settings-group mii-list';

      // Render portraits lazily and at most one per frame for visible rows so large QR libraries
      // open instantaneously without blocking the UI thread.
      const pendingTargets = new Map<HTMLElement, StoredMii>();
      const queue: HTMLElement[] = [];
      const queued = new Set<HTMLElement>();

      const pumpQueue = () => {
        portraitRaf = 0;
        if (seq !== renderSeq || !dialog.open || activeTab !== 'miis') return;
        while (queue.length > 0) {
          const el = queue.shift()!;
          queued.delete(el);
          const item = pendingTargets.get(el);
          pendingTargets.delete(el);
          if (!item || !el.isConnected) continue;
          const url = ctx.renderMiiPortrait(item.code, item.leftEye);
          if (url) setAvatarPortrait(el, url);
          break;
        }
        if (queue.length > 0) {
          portraitRaf = requestAnimationFrame(pumpQueue);
        }
      };

      const observer = new IntersectionObserver(
        (entries) => {
          if (seq !== renderSeq) return;
          let added = false;
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const el = entry.target as HTMLElement;
            observer.unobserve(el);
            if (!pendingTargets.has(el) || queued.has(el)) continue;
            queued.add(el);
            queue.push(el);
            added = true;
          }
          if (added && !portraitRaf) {
            portraitRaf = requestAnimationFrame(pumpQueue);
          }
        },
        { root: listCard, rootMargin: '120px 0px' },
      );
      portraitObserver = observer;

      for (const mii of collection.crowd) {
        const row = document.createElement('div');
        row.className = 'mii-row';

        const main = document.createElement('div');
        main.className = 'mii-main';
        const text = document.createElement('div');
        text.className = 'mii-text';
        const name = document.createElement('span');
        name.className = 'mii-name';
        name.textContent = mii.name;
        const meta = readMiiMeta(mii.code);
        const sub = document.createElement('span');
        sub.className = 'mii-sub';
        sub.textContent = meta?.creator.trim() ? `Creator: ${meta.creator.trim()}` : 'Scanned from QR code';
        text.append(name, sub);

        const cachedPortrait = ctx.peekMiiPortrait(mii.code, mii.leftEye);
        const avatar = makeMiiAvatar(mii, false, cachedPortrait);
        if (!cachedPortrait) {
          pendingTargets.set(avatar, mii);
          observer.observe(avatar);
        }
        main.append(avatar, text);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'pill-btn mii-remove-btn';
        removeBtn.textContent = 'Remove';
        removeBtn.setAttribute('aria-label', `Remove ${mii.name}`);
        removeBtn.addEventListener('click', () => {
          void ctx.onSaveMiis(removeCrowdMii(ctx.getMiis(), mii.id)).then(() => {
            miiStatus = { kind: 'info', text: `Removed ${mii.name}` };
            if (dialog.open && activeTab === 'miis') render();
          });
        });

        row.append(main, removeBtn);
        listCard.append(row);
      }
      listSection.append(listCard);
    }

    const privacy = document.createElement('p');
    privacy.className = 'sheet-privacy';
    privacy.textContent = 'QR codes are scanned locally in your browser. Miis stay on this device.';

    content!.append(mySection, uploadSection, listSection, privacy);
  }

  function render() {
    const seq = ++renderSeq;
    stopPortraitHydration();
    const contentScroll = content!.scrollTop;
    const listScroll = content!.querySelector<HTMLElement>('.mii-list')?.scrollTop ?? 0;
    syncTabButtons();
    content!.replaceChildren();
    if (activeTab === 'miis') renderMiisTab(seq);
    else renderSettingsTab(seq);
    content!.scrollTop = contentScroll;
    const nextList = content!.querySelector<HTMLElement>('.mii-list');
    if (nextList) nextList.scrollTop = listScroll;
  }

  return {
    open() {
      miiStatus = null;
      render();
      dialog.showModal();
    },
    refresh() {
      if (dialog.open) render();
    },
  };
}
