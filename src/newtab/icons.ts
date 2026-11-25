// A pinned site's icon and autofetched identity (title, theme color, favicon). Fetches metadata
// once per origin, caches it in storage.local and in memory so opening popups or tabs never
// re-fetches already resolved sites, and falls back to Chrome's favicon cache if unreachable.
import { browser } from 'wxt/browser';
import type { Pins } from './pins';

const FIREFOX = import.meta.env.FIREFOX;
const FETCH_TIMEOUT = 6000;
const web = (url: string) => /^https?:/i.test(url);

export interface SiteMeta {
  icon: HTMLImageElement | null;
  title: string | null;
  accent: string | null;
  ok: boolean;
}

const memoryMeta = new Map<string, SiteMeta>();
const inFlightMeta = new Map<string, Promise<SiteMeta>>();

/** Synchronous read of already-resolved metadata/icon for instant zero-flash preview rendering. */
export function peekSiteMeta(url: string): SiteMeta | null {
  if (!web(url)) return null;
  try {
    return memoryMeta.get(new URL(url).origin) ?? null;
  } catch {
    return null;
  }
}

function picture(blob: Blob) {
  const img = new Image();
  const src = URL.createObjectURL(blob);
  img.src = src;
  return img.decode().then(
    () => img,
    () => null,
  ).finally(() => URL.revokeObjectURL(src));
}

// Chrome local favicon cache ----------------------------------------------------------------------

const chromeFavicon = (url: string) => fetch(browser.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=128` as '/'));

/** The globe Chrome gives a site it has never seen, to tell it apart from a real icon. */
let globe: Promise<string> | undefined;
const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer()).join(',');

async function fromChrome(url: string) {
  globe ??= chromeFavicon('https://plaza.invalid/').then((r) => (r.ok ? r.blob() : new Blob())).then(bytes);
  const res = await chromeFavicon(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  if (!blob.size || (await bytes(blob)) === (await globe)) return null;
  return picture(blob);
}

// Color & Title extraction ------------------------------------------------------------------------

let colorProbe: CanvasRenderingContext2D | null | undefined;
function getColorProbe() {
  if (colorProbe !== undefined) return colorProbe;
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  colorProbe = c.getContext('2d', { willReadFrequently: true });
  return colorProbe;
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

function parseColorHex(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (short) {
    const [r, g, b] = short[1].split('').map((ch) => parseInt(ch + ch, 16));
    return toHex(r, g, b);
  }
  const full = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (full) return `#${full[1].toLowerCase()}`;
  const rgb = /^rgba?\(\s*(\d+)\s*[,\s]\s*(\d+)\s*[,\s]\s*(\d+)/i.exec(trimmed);
  if (rgb) return toHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  return null;
}

/** Rejects near-white or near-black colors so accent tints stay visibly colorful. */
function isVibrantHex(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return sat >= 0.2 && lum >= 0.14 && lum <= 0.88;
}

/** Extracts the most vibrant dominant color from an icon image, or null if grayscale/white. */
export function extractDominantColor(icon: CanvasImageSource | null): string | null {
  if (!icon) return null;
  const ctx = getColorProbe();
  if (!ctx) return null;
  try {
    ctx.clearRect(0, 0, 16, 16);
    ctx.drawImage(icon, 0, 0, 16, 16);
    const { data } = ctx.getImageData(0, 0, 16, 16);
    const buckets = new Map<string, { weight: number; r: number; g: number; b: number }>();
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      if (a < 0.35) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b) / 255;
      const min = Math.min(r, g, b) / 255;
      const sat = max === 0 ? 0 : (max - min) / max;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      if (sat < 0.18 || lum < 0.12 || lum > 0.9) continue;
      const key = `${r >> 5},${g >> 5},${b >> 5}`;
      const weight = a * (0.4 + sat * 1.8);
      const entry = buckets.get(key) ?? { weight: 0, r: 0, g: 0, b: 0 };
      entry.weight += weight;
      entry.r += r * weight;
      entry.g += g * weight;
      entry.b += b * weight;
      buckets.set(key, entry);
    }
    let best: { weight: number; r: number; g: number; b: number } | null = null;
    for (const b of buckets.values()) {
      if (!best || b.weight > best.weight) best = b;
    }
    if (!best || best.weight <= 0) return null;
    return toHex(best.r / best.weight, best.g / best.weight, best.b / best.weight);
  } catch {
    return null;
  }
}

const BLOCKED_TITLES =
  /^(?:pardon our interruption|just a moment\.{0,3}|attention required!?|access denied|request blocked|robot or human\??|verify you are human|security check|ddos-guard|one more step|please wait\b)/i;

function cleanPageTitle(doc: Document): string | null {
  const siteName =
    doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() ||
    doc.querySelector('meta[name="application-name"]')?.getAttribute('content')?.trim();
  const rawTitle = doc.querySelector('title')?.textContent?.trim() ?? '';
  const validSiteName = siteName && !BLOCKED_TITLES.test(siteName) ? siteName : null;
  if (validSiteName && validSiteName.length <= 32) return validSiteName;
  if (!rawTitle || BLOCKED_TITLES.test(rawTitle)) return validSiteName || null;
  if (rawTitle.length <= 28) return rawTitle;
  const parts = rawTitle.split(/\s+(?:\||·|-|:)\s+/);
  if (parts.length > 1) {
    const shortest = parts.find((p) => p.trim().length >= 2 && p.trim().length <= 28 && !BLOCKED_TITLES.test(p.trim()));
    if (shortest) return shortest.trim();
  }
  return rawTitle.slice(0, 32).trim();
}

function pickThemeColor(doc: Document): string | null {
  const metas = [...doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  for (const meta of metas) {
    const media = meta.getAttribute('media')?.trim();
    if (media === 'not all') continue;
    if (media && !matchMedia(media).matches) continue;
    const hex = parseColorHex(meta.getAttribute('content'));
    if (hex && isVibrantHex(hex)) return hex;
  }
  return null;
}

// Direct site icon & metadata fetch ----------------------------------------------------------------

const CACHE_VERSION = 2;
const cacheKey = (origin: string) => `icon:${origin}`;
const metaCacheKey = (origin: string) => `meta:${origin}`;

interface StoredMeta {
  v?: number;
  probed?: boolean;
  title?: string;
  accent?: string;
}

function inspectCandidateAlpha(img: HTMLImageElement): boolean {
  const ctx = getColorProbe();
  if (!ctx) return false;
  try {
    ctx.clearRect(0, 0, 16, 16);
    ctx.drawImage(img, 0, 0, 16, 16);
    const { data } = ctx.getImageData(0, 0, 16, 16);
    let transparentCount = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 40) transparentCount++;
    }
    return transparentCount >= 16;
  } catch {
    return false;
  }
}

interface ParsedPage {
  iconUrls: string[];
  title: string | null;
  accent: string | null;
}

async function parseSitePage(url: string): Promise<ParsedPage> {
  const fallback = new URL('/favicon.ico', url).href;
  try {
    const page = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    if (!page.ok) return { iconUrls: [fallback], title: null, accent: null };
    const doc = new DOMParser().parseFromString(await page.text(), 'text/html');
    const links = [...doc.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]')];
    // Prefer standard transparent-capable icons (SVG/PNG/ICO) over opaque apple-touch-icon tiles.
    const score = (l: HTMLLinkElement) => {
      if (l.rel.toLowerCase().includes('apple-touch-icon')) return 500;
      const href = (l.getAttribute('href') ?? '').toLowerCase().split(/[?#]/)[0];
      const type = (l.getAttribute('type') ?? '').toLowerCase();
      if (type === 'image/svg+xml' || href.endsWith('.svg')) return 2000;
      const sizes = (l.getAttribute('sizes') ?? '').trim().toLowerCase();
      if (sizes === 'any') return 990;
      const maxSize = Math.max(0, ...sizes.split(/\s+/).map((s) => parseInt(s, 10) || 0));
      if (maxSize >= 48) return 1000 + Math.min(maxSize, 512);
      if (maxSize >= 32) return 900 + maxSize;
      if (maxSize > 0) return maxSize;
      return href.endsWith('.ico') ? 800 : 1064;
    };
    const urls = links
      .sort((a, b) => score(b) - score(a))
      .map((l) => l.getAttribute('href'))
      .filter((href): href is string => Boolean(href))
      .map((href) => {
        try {
          return new URL(href, page.url).href;
        } catch {
          return null;
        }
      })
      .filter((href): href is string => Boolean(href));
    const itemImage = doc.querySelector('meta[itemprop="image"]')?.getAttribute('content');
    if (itemImage) {
      try {
        urls.push(new URL(itemImage, page.url).href);
      } catch {
        // Ignore invalid image URL.
      }
    }
    const pageFallback = new URL('/favicon.ico', page.url).href;
    if (!urls.includes(pageFallback)) urls.push(pageFallback);
    if (!urls.includes(fallback)) urls.push(fallback);

    return {
      iconUrls: [...new Set(urls)],
      title: cleanPageTitle(doc),
      accent: pickThemeColor(doc),
    };
  } catch {
    return { iconUrls: [fallback], title: null, accent: null };
  }
}

async function decodeCachedDataUrl(dataUrl: unknown): Promise<HTMLImageElement | null> {
  if (typeof dataUrl !== 'string') return null;
  try {
    return await picture(await (await fetch(dataUrl)).blob());
  } catch {
    return null;
  }
}

async function fetchAndCacheSite(url: string, origin: string): Promise<SiteMeta> {
  const key = cacheKey(origin);
  const metaKey = metaCacheKey(origin);
  const parsed = await parseSitePage(url);
  let best: { img: HTMLImageElement; svg: boolean; dim: number; transparent: boolean } | null = null;
  let attempts = 0;
  for (const candidate of parsed.iconUrls) {
    if (attempts >= 4 && best) break;
    const res = await fetch(candidate, { credentials: 'omit', signal: AbortSignal.timeout(FETCH_TIMEOUT) }).catch(() => null);
    if (!res?.ok) continue;
    attempts++;
    const decoded = await picture(await res.blob());
    if (!decoded) continue;
    const isSvg =
      (res.headers.get('content-type') ?? '').toLowerCase().includes('svg') ||
      candidate.toLowerCase().split(/[?#]/)[0].endsWith('.svg');
    const dim = isSvg ? 256 : Math.max(decoded.naturalWidth || 0, decoded.naturalHeight || 0);
    const transparent = inspectCandidateAlpha(decoded);
    const better =
      !best ||
      (transparent && dim >= 32 && !(best.transparent && best.dim >= 32)) ||
      (transparent === best.transparent && dim > best.dim) ||
      (!best.transparent && best.dim < 32 && dim >= 32);
    if (better) best = { img: decoded, svg: isSvg, dim, transparent };
    if (isSvg || (transparent && dim >= 32)) break;
  }
  let img: HTMLImageElement | null = best?.img ?? null;
  const imgIsSvg = best?.svg ?? false;
  if (!img && !FIREFOX) {
    img = await fromChrome(url).catch(() => null);
  }

  const updates: Record<string, unknown> = {};
  if (img) {
    const nw = img.naturalWidth || 256;
    const nh = img.naturalHeight || 256;
    if (img.naturalWidth === 0 || img.naturalHeight === 0) {
      img.width = 256;
      img.height = 256;
    }
    const maxDim = Math.max(nw, nh);
    const scale = imgIsSvg ? 256 / maxDim : maxDim > 256 ? 256 / maxDim : 1;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(nw * scale));
    c.height = Math.max(1, Math.round(nh * scale));
    const g = c.getContext('2d');
    if (g) {
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, c.width, c.height);
    }
    updates[key] = c.toDataURL('image/png');
  }

  const accent = parsed.accent ?? extractDominantColor(img);
  const ok = Boolean(img || parsed.title);
  if (ok) {
    const metaRecord: StoredMeta = {
      v: CACHE_VERSION,
      probed: true,
      ...(parsed.title ? { title: parsed.title } : {}),
      ...(accent ? { accent } : {}),
    };
    updates[metaKey] = metaRecord;
    await browser.storage.local.set(updates);
  }

  const meta: SiteMeta = { icon: img, title: parsed.title, accent, ok };
  if (ok) memoryMeta.set(origin, meta);
  return meta;
}

/**
 * Resolves icon, title, and accent color for `url`: checks in-memory cache first, then
 * storage.local, and fetches over the network only once per origin.
 */
export async function probeSiteMeta(url: string): Promise<SiteMeta> {
  if (!web(url)) return { icon: null, title: null, accent: null, ok: true };
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return { icon: null, title: null, accent: null, ok: false };
  }

  const mem = memoryMeta.get(origin);
  if (mem) return mem;

  const existing = inFlightMeta.get(origin);
  if (existing) return existing;

  const task = (async (): Promise<SiteMeta> => {
    try {
      const iKey = cacheKey(origin);
      const mKey = metaCacheKey(origin);
      const stored = await browser.storage.local.get([iKey, mKey]);
      const cachedIcon = await decodeCachedDataUrl(stored[iKey]);
      const rawMeta = stored[mKey] as StoredMeta | undefined;
      const hasMeta = Boolean(rawMeta && typeof rawMeta === 'object' && (typeof rawMeta.title === 'string' || typeof rawMeta.accent === 'string' || rawMeta.probed));
      const isCurrentVersion = rawMeta?.v === CACHE_VERSION;

      if (isCurrentVersion && (cachedIcon || hasMeta)) {
        const title = typeof rawMeta?.title === 'string' ? rawMeta.title : null;
        const accent = (typeof rawMeta?.accent === 'string' ? rawMeta.accent : null) ?? extractDominantColor(cachedIcon);
        const meta: SiteMeta = { icon: cachedIcon, title, accent, ok: true };
        memoryMeta.set(origin, meta);
        return meta;
      }

      const fresh = await fetchAndCacheSite(url, origin);
      if (fresh.ok || (!cachedIcon && !hasMeta)) return fresh;

      // Fall back to older cached data when offline during a cache version refresh.
      const title = typeof rawMeta?.title === 'string' ? rawMeta.title : null;
      const accent = (typeof rawMeta?.accent === 'string' ? rawMeta.accent : null) ?? extractDominantColor(cachedIcon);
      const fallbackMeta: SiteMeta = { icon: cachedIcon, title, accent, ok: true };
      memoryMeta.set(origin, fallbackMeta);
      return fallbackMeta;
    } catch {
      return { icon: null, title: null, accent: null, ok: false };
    } finally {
      inFlightMeta.delete(origin);
    }
  })();

  inFlightMeta.set(origin, task);
  return task;
}

/** Reads local cached icon first, otherwise fetches automatically once per origin. */
export async function iconFor(url: string): Promise<HTMLImageElement | null> {
  return (await probeSiteMeta(url)).icon;
}

/** Removes cached icons and metadata for origins no longer pinned. */
export async function pruneIconCache(pins: Pins): Promise<void> {
  const activeOrigins = new Set<string>();
  for (const pin of pins) {
    if (!pin || !web(pin.url)) continue;
    try {
      activeOrigins.add(new URL(pin.url).origin);
    } catch {
      // Ignore malformed URLs.
    }
  }
  for (const origin of memoryMeta.keys()) {
    if (!activeOrigins.has(origin)) memoryMeta.delete(origin);
  }
  try {
    const all = await browser.storage.local.get(null);
    const staleKeys = Object.keys(all).filter(
      (k) => (k.startsWith('icon:') && !activeOrigins.has(k.slice(5))) || (k.startsWith('meta:') && !activeOrigins.has(k.slice(5))),
    );
    if (staleKeys.length) await browser.storage.local.remove(staleKeys);
  } catch {
    // Non-fatal cleanup error.
  }
}
