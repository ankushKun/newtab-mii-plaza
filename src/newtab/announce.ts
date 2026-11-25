// Announcements from ankush.one: the newest one is said once by your Mii as a bubble, then never again. The site
// publishes it at /announcement.json (src/content/announcements in the ankush.one repo); this asks at most every six
// hours, from whichever tab opens first, with no cookies and nothing about you. The announcement, its icon as a
// small PNG and the ids already said stay in storage.local, so other tabs and offline tabs need no request.
import { browser } from 'wxt/browser';

/** Where announcements come from. Set WXT_ANNOUNCE_URL to try a local build of the site. */
export const ANNOUNCE_URL: string = import.meta.env.WXT_ANNOUNCE_URL || 'https://ankush.one/announcement.json';
const ORIGIN = new URL(ANNOUNCE_URL).origin;
/** The feed's version this reads. A newer one is ignored rather than misread. */
const VERSION = 1;

const CACHE_KEY = 'announcement';
const SEEN_KEY = 'announcementsSeen';
/** How often to ask, and how soon to ask again after a failed try. */
const EVERY = 6 * 60 * 60 * 1000;
const RETRY = 30 * 60 * 1000;
const TIMEOUT = 6000;
/** Ids said, newest last: enough that taking a newer one down never brings an older one back. */
const KEEP = 20;
/** The site keeps it to 120 characters; a little room past that, and nothing longer is trusted. */
const MAX_TEXT = 160;
const ICON_SIZE = 128;
const ICON_MAX_BYTES = 512 * 1024;

export interface Announcement {
  id: string;
  text: string;
  /** Where pressing it goes, always http(s). */
  url: string;
  /** Its icon as a PNG data URL, already fetched. */
  icon?: string;
  /** When it shows, in milliseconds: from `date` until `until`. */
  date: number;
  until: number;
}

interface Cached {
  /** When to ask the site again. */
  next: number;
  announcement: Announcement | null;
  /** The address the stored icon came from, so a new one is fetched only when it changes. */
  iconSrc?: string;
}

interface Feed {
  announcement: (Omit<Announcement, 'icon'> & { iconSrc?: string }) | null;
}

const text = (value: unknown, max: number) => (typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null);

function web(value: unknown, sameOrigin = false) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (sameOrigin ? url.origin !== ORIGIN : url.protocol !== 'https:' && url.origin !== ORIGIN) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** What the site said, checked field by field: no announcement when it has none or speaks a newer version, undefined when it makes no sense. */
export function parseFeed(raw: unknown): Feed | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { v, announcement: a } = raw as { v?: unknown; announcement?: unknown };
  if (v !== VERSION) return { announcement: null };
  if (a === null) return { announcement: null };
  if (!a || typeof a !== 'object') return undefined;
  const obj = a as Record<string, unknown>;
  const id = text(obj.id, 100);
  const words = text(obj.text, MAX_TEXT);
  const url = web(obj.url);
  const date = typeof obj.date === 'string' ? Date.parse(obj.date) : NaN;
  const until = typeof obj.until === 'string' ? Date.parse(obj.until) : NaN;
  if (!id || !words || !url || !Number.isFinite(date) || !Number.isFinite(until) || until <= date) return undefined;
  // Pictures only from the site itself, so showing one never reaches anywhere else.
  const iconSrc = obj.icon === undefined ? undefined : (web(obj.icon, true) ?? undefined);
  return { announcement: { id, text: words, url, date, until, ...(iconSrc && { iconSrc }) } };
}

/** The icon as a small PNG data URL, or nothing if it isn't a picture that loads. */
async function iconData(src: string): Promise<string | undefined> {
  try {
    const res = await fetch(src, { credentials: 'omit', signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) return undefined;
    const blob = await res.blob();
    if (blob.size > ICON_MAX_BYTES) return undefined;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = ICON_SIZE;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, ICON_SIZE, ICON_SIZE);
    bitmap.close();
    return canvas.toDataURL('image/png');
  } catch {
    return undefined;
  }
}

async function readCache(): Promise<Cached | null> {
  const got = await browser.storage.local.get(CACHE_KEY);
  const cached = got[CACHE_KEY] as Cached | undefined;
  return cached && typeof cached.next === 'number' ? cached : null;
}

/** Asks the site, unless another tab just did, and keeps what it says. */
async function refresh(): Promise<Cached> {
  const before = await readCache();
  if (before && Date.now() < before.next) return before;
  let feed: Feed | undefined;
  try {
    const res = await fetch(ANNOUNCE_URL, { credentials: 'omit', cache: 'no-cache', signal: AbortSignal.timeout(TIMEOUT) });
    if (res.ok) feed = parseFeed(await res.json());
  } catch {
    // Offline, blocked or malformed: keep what we had and try again later.
  }
  if (!feed) {
    const kept: Cached = { next: Date.now() + RETRY, announcement: before?.announcement ?? null, ...(before?.iconSrc && { iconSrc: before.iconSrc }) };
    await browser.storage.local.set({ [CACHE_KEY]: kept });
    return kept;
  }
  const next: Cached = { next: Date.now() + EVERY, announcement: null };
  if (feed.announcement) {
    const { iconSrc, ...rest } = feed.announcement;
    const keepIcon = iconSrc && before?.iconSrc === iconSrc ? before.announcement?.icon : undefined;
    const icon = keepIcon ?? (iconSrc ? await iconData(iconSrc) : undefined);
    next.announcement = { ...rest, ...(icon && { icon }) };
    if (iconSrc && icon) next.iconSrc = iconSrc;
  }
  await browser.storage.local.set({ [CACHE_KEY]: next });
  return next;
}

/** One tab asks at a time, so a burst of new tabs makes one request. */
function refreshOnce(): Promise<Cached> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  return locks ? locks.request('plaza-announcement', refresh) : refresh();
}

async function seenIds(): Promise<string[]> {
  const got = await browser.storage.local.get(SEEN_KEY);
  const list = got[SEEN_KEY];
  return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
}

/** The announcement to say now, if one is live and hasn't been said here before. */
export async function dueAnnouncement(now = Date.now()): Promise<Announcement | null> {
  const [{ announcement }, seen] = await Promise.all([refreshOnce(), seenIds()]);
  if (!announcement || now < announcement.date || now >= announcement.until || seen.includes(announcement.id)) return null;
  return announcement;
}

/** Remembers it was said, so no tab says it again. */
export async function markSeen(id: string) {
  const seen = await seenIds();
  if (seen.includes(id)) return;
  await browser.storage.local.set({ [SEEN_KEY]: [...seen, id].slice(-KEEP) });
}

/** Calls `fn` with the ids said whenever another tab says one. */
export function onSeen(fn: (ids: string[]) => void) {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    const change = changes[SEEN_KEY];
    if (area === 'local' && change && Array.isArray(change.newValue)) fn(change.newValue.filter((id): id is string => typeof id === 'string'));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
