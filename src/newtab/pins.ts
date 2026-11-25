// The sites pinned to the blocks, one per block or null for an empty one, plus lightweight UI
// preferences. Both live in sync storage so they follow you across browsers you sign in to.
import { browser } from 'wxt/browser';

/** The plaza has ten blocks, as on the console. */
export const SLOTS = 10;
export const TILE_COLOR_COUNT = 9;

export type PinTileMode = 'auto' | 'letter';
export type ThemeMode = 'system' | 'light' | 'dark';

export interface Pin {
  url: string;
  title: string;
  color?: number;
  accent?: string;
  tile?: PinTileMode;
  customId?: string;
}

export type Pins = (Pin | null)[];

export interface Prefs {
  showClock: boolean;
  clock24h: boolean;
  theme: ThemeMode;
  muteVoices: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  showClock: false,
  clock24h: false,
  theme: 'system',
  muteVoices: false,
};

export const DEFAULT_PINS: Pins = [
  null,
  null,
  null,
  null,
  null,
  null,
  { url: 'https://github.com/ankushKun/new-tab-mii-plaza', title: 'GitHub' },
  { url: 'https://ankush.one/', title: 'Ankush Kun' },
  { url: 'https://construct.computer/', title: 'Construct Computer' },
  { url: 'https://x.com/ankushKun_', title: 'X' },
];

const KEY = 'pins';
const PREFS_KEY = 'prefs';

const isPin = (p: unknown): p is Pin => !!p && typeof (p as Pin).url === 'string' && typeof (p as Pin).title === 'string';
const isHexColor = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);

function cleanPin(raw: unknown): Pin | null {
  if (!isPin(raw)) return null;
  const checked = validateUrl(raw.url);
  if (!checked.ok) return null;
  const pin: Pin = {
    url: checked.url,
    title: raw.title.trim() || nameFor(checked.url),
  };
  if (typeof raw.color === 'number' && Number.isInteger(raw.color) && raw.color >= 0 && raw.color < TILE_COLOR_COUNT) {
    pin.color = raw.color;
  }
  if (isHexColor(raw.accent)) pin.accent = raw.accent.toLowerCase();
  if (raw.tile === 'letter') pin.tile = 'letter';
  if (typeof raw.customId === 'string' && raw.customId.length > 0 && raw.customId.length <= 64) {
    pin.customId = raw.customId;
  }
  return pin;
}

const normalize = (list: unknown): Pins => Array.from({ length: SLOTS }, (_, i) => (Array.isArray(list) ? cleanPin(list[i]) : null));

function normalizePrefs(raw: unknown): Prefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
  const obj = raw as Partial<Prefs>;
  const theme: ThemeMode = obj.theme === 'light' || obj.theme === 'dark' ? obj.theme : 'system';
  return {
    showClock: Boolean(obj.showClock),
    clock24h: Boolean(obj.clock24h),
    theme,
    muteVoices: Boolean(obj.muteVoices),
  };
}

const cloneDefaults = (): Pins => DEFAULT_PINS.map((p) => (p ? { ...p } : null));

const normalizeOrDefault = (raw: unknown): Pins => (raw === undefined ? cloneDefaults() : normalize(raw));

/** Reads pins and preferences in a single storage round-trip. */
export async function loadState(): Promise<{ pins: Pins; prefs: Prefs }> {
  const got = await browser.storage.sync.get([KEY, PREFS_KEY]);
  return {
    pins: normalizeOrDefault(got[KEY]),
    prefs: normalizePrefs(got[PREFS_KEY]),
  };
}

export async function loadPins(): Promise<Pins> {
  const got = await browser.storage.sync.get(KEY);
  return normalizeOrDefault(got[KEY]);
}

export function savePins(pins: Pins) {
  return browser.storage.sync.set({ [KEY]: pins });
}

export function savePrefs(prefs: Prefs) {
  return browser.storage.sync.set({ [PREFS_KEY]: prefs });
}

/** Calls `fn` when pins or preferences change, here or in another tab or browser. */
export function onStateChanged(fn: (update: { pins?: Pins; prefs?: Prefs }) => void) {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes[KEY]) fn({ pins: normalize(changes[KEY].newValue) });
    if (changes[PREFS_KEY]) fn({ prefs: normalizePrefs(changes[PREFS_KEY].newValue) });
  });
}

export function onPinsChanged(fn: (pins: Pins) => void) {
  onStateChanged(({ pins }) => {
    if (pins) fn(pins);
  });
}

const BLOCKED_PROTOCOLS = new Set(['javascript:', 'data:', 'vbscript:']);

/** Validates what was typed and returns either a normalized URL or a short reason why it failed. */
export function validateUrl(typed: string): { ok: true; url: string } | { ok: false; reason: string } {
  let s = typed.trim();
  if (!s) return { ok: false, reason: 'Enter a website address, like github.com' };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  try {
    const url = new URL(s);
    if (BLOCKED_PROTOCOLS.has(url.protocol)) {
      return { ok: false, reason: 'Scripts and data URLs cannot be pinned' };
    }
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.hostname.includes('.') && url.hostname !== 'localhost') {
      return { ok: false, reason: 'Include a domain extension, like .com or .org' };
    }
    return { ok: true, url: url.href };
  } catch {
    return { ok: false, reason: 'That does not look like a valid address' };
  }
}

/** What was typed, as an address to open: `github.com` becomes `https://github.com/`. */
export function toUrl(typed: string): string | null {
  const res = validateUrl(typed);
  return res.ok ? res.url : null;
}

/** A name for a site nobody named: `https://www.github.com/x` is Github. */
export function nameFor(url: string) {
  try {
    const { hostname, protocol } = new URL(url);
    if (!hostname) return protocol.replace(':', '');
    const parts = hostname.replace(/^www\./, '').split('.');
    const word = parts.length > 1 ? parts[parts.length - 2] : parts[0];
    return word.charAt(0).toUpperCase() + word.slice(1);
  } catch {
    return url;
  }
}

export function swapPins(pins: Pins, from: number, to: number): Pins {
  if (from === to || from < 0 || to < 0 || from >= SLOTS || to >= SLOTS) return pins;
  const next = [...pins];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function exportPins(pins: Pins): string {
  return JSON.stringify({ version: 1, pins }, null, 2);
}

export function importPins(raw: string): Pins | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { pins?: unknown }).pins)
        ? (parsed as { pins: unknown[] }).pins
        : null;
    if (!list) return null;
    return normalize(list);
  } catch {
    return null;
  }
}
