// Stored Miis for the plaza: one undeletable default "My Mii" plus user-uploaded QR Miis.
// Lives in local storage so users can store many Miis without hitting sync item size limits.
import { browser } from 'wxt/browser';
import { decodeMii, miiInfo, type MiiInfo } from '../components/mii/data';
import type { PlazaMii } from '../components/plaza/types';

export const DEFAULT_MY_MII_CODE =
  'AwEAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAABNAGUAAAAAAAAAAAAAAAAAAAAAAEgmAiBLABFrRBgBM0MOgRIPaA0AACkDUkhQAAAAAAAAAAAAAAAAAAAAAAAAAAAAACnk';

const LEGACY_PLACEHOLDER_MII_CODE =
  'AwEAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABRNAHkAIABNAGkAaQAAAAAAAAAAAEBAAAAhAQJoRBggNEYUgBIXaA0ACCkAUkhQAAAAAAAAAAAAAAAAAAAAAAAAAAAAALYH';

export interface StoredMii {
  id: string;
  name: string;
  code: string;
  leftEye?: string;
}

export interface MiiCollection {
  myMii: StoredMii;
  crowd: StoredMii[];
}

export const DEFAULT_MY_MII: StoredMii = {
  id: 'my-mii',
  name: 'Ankush',
  code: DEFAULT_MY_MII_CODE,
  leftEye: '#a68438',
};

const MIIS_KEY = 'miis';

function makeId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanStoredMii(raw: unknown, fallbackId?: string): StoredMii | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<StoredMii>;
  if (typeof obj.code !== 'string') return null;
  const bytes = decodeMii(obj.code);
  if (!bytes) return null;
  const info = miiInfo(bytes);
  const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim().slice(0, 24) : info.name.trim() || 'Mii';
  const id = fallbackId ?? (typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : makeId());
  const leftEye = typeof obj.leftEye === 'string' && /^#[0-9a-f]{6}$/i.test(obj.leftEye) ? obj.leftEye : undefined;
  return { id, name, code: obj.code.trim(), ...(leftEye ? { leftEye } : {}) };
}

export function normalizeMiis(raw: unknown): MiiCollection {
  if (!raw || typeof raw !== 'object') {
    return { myMii: { ...DEFAULT_MY_MII }, crowd: [] };
  }
  const obj = raw as Partial<MiiCollection>;
  const rawMyMii = cleanStoredMii(obj.myMii, DEFAULT_MY_MII.id);
  const myMii =
    !rawMyMii || rawMyMii.code === LEGACY_PLACEHOLDER_MII_CODE
      ? { ...DEFAULT_MY_MII }
      : rawMyMii.code === DEFAULT_MY_MII_CODE && !rawMyMii.leftEye
        ? { ...rawMyMii, leftEye: DEFAULT_MY_MII.leftEye }
        : rawMyMii;
  const seenCodes = new Set<string>();
  const crowd: StoredMii[] = [];
  if (Array.isArray(obj.crowd)) {
    for (const item of obj.crowd) {
      const cleaned = cleanStoredMii(item);
      if (!cleaned || seenCodes.has(cleaned.code)) continue;
      seenCodes.add(cleaned.code);
      crowd.push(cleaned);
    }
  }
  return { myMii, crowd };
}

export async function loadMiis(): Promise<MiiCollection> {
  const got = await browser.storage.local.get(MIIS_KEY);
  return normalizeMiis(got[MIIS_KEY]);
}

export function saveMiis(collection: MiiCollection): Promise<void> {
  return browser.storage.local.set({ [MIIS_KEY]: normalizeMiis(collection) });
}

export function onMiisChanged(fn: (collection: MiiCollection) => void): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[MIIS_KEY]) return;
    fn(normalizeMiis(changes[MIIS_KEY].newValue));
  });
}

export function toPlazaCast(collection: MiiCollection): { hero: PlazaMii[]; pool: PlazaMii[] } {
  return {
    hero: [
      {
        code: collection.myMii.code,
        name: collection.myMii.name,
        ...(collection.myMii.leftEye ? { leftEye: collection.myMii.leftEye } : {}),
      },
    ],
    pool: collection.crowd.map((m) => ({
      code: m.code,
      name: m.name,
      ...(m.leftEye ? { leftEye: m.leftEye } : {}),
    })),
  };
}

export function readMiiMeta(code: string): MiiInfo | null {
  const bytes = decodeMii(code);
  return bytes ? miiInfo(bytes) : null;
}

export function isDefaultMyMii(myMii: StoredMii): boolean {
  return myMii.code === DEFAULT_MY_MII_CODE;
}

export function addCrowdMiis(
  collection: MiiCollection,
  items: { name: string; code: string }[],
): { next: MiiCollection; added: number; duplicates: number } {
  const seen = new Set(collection.crowd.map((m) => m.code));
  const appended: StoredMii[] = [];
  let duplicates = 0;
  for (const item of items) {
    const clean = cleanStoredMii({ id: makeId(), name: item.name, code: item.code });
    if (!clean) continue;
    if (seen.has(clean.code)) {
      duplicates++;
      continue;
    }
    seen.add(clean.code);
    appended.push(clean);
  }
  return {
    next: {
      myMii: collection.myMii,
      crowd: [...collection.crowd, ...appended],
    },
    added: appended.length,
    duplicates,
  };
}

export function removeCrowdMii(collection: MiiCollection, id: string): MiiCollection {
  return {
    myMii: collection.myMii,
    crowd: collection.crowd.filter((m) => m.id !== id),
  };
}

export function clearCrowdMiis(collection: MiiCollection): MiiCollection {
  return {
    myMii: collection.myMii,
    crowd: [],
  };
}

export function setMyMii(collection: MiiCollection, code: string, name: string): MiiCollection {
  const clean = cleanStoredMii({ id: DEFAULT_MY_MII.id, name, code }, DEFAULT_MY_MII.id);
  if (!clean) return collection;
  return {
    myMii: clean,
    crowd: collection.crowd,
  };
}

export function resetMyMii(collection: MiiCollection): MiiCollection {
  return {
    myMii: { ...DEFAULT_MY_MII },
    crowd: collection.crowd,
  };
}
