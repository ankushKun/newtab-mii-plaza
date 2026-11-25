// Custom user-picked block images and animated GIFs, stored locally in IndexedDB so they never
// hit sync storage's 8 KB item quota.
import { CUSTOM_STORE, openPlazaDb } from './db';
import type { Pins } from './pins';

export interface StoredCustomTile {
  blob: Blob;
  animated: boolean;
}

export interface AnimatedTilePlayer {
  canvas: HTMLCanvasElement;
  step(nowMs: number): boolean;
  dispose(): void;
}

const MAX_STATIC_SIDE = 512;
const MAX_ANIMATED_BYTES = 8 * 1024 * 1024;
const ANIMATED_TYPES = new Set(['image/gif', 'image/webp', 'image/png', 'image/apng']);

export async function loadCustomTile(id: string): Promise<StoredCustomTile | null> {
  try {
    const db = await openPlazaDb();
    return await new Promise((done) => {
      const req = db.transaction(CUSTOM_STORE).objectStore(CUSTOM_STORE).get(id);
      req.onsuccess = () => {
        const res = req.result as StoredCustomTile | undefined;
        done(res && res.blob instanceof Blob ? res : null);
      };
      req.onerror = () => done(null);
    });
  } catch {
    return null;
  }
}

export async function saveCustomTile(id: string, entry: StoredCustomTile): Promise<void> {
  const db = await openPlazaDb();
  await new Promise<void>((done, fail) => {
    const tx = db.transaction(CUSTOM_STORE, 'readwrite');
    tx.objectStore(CUSTOM_STORE).put(entry, id);
    tx.oncomplete = () => done();
    tx.onerror = () => fail(tx.error);
  });
}

export async function pruneCustomTiles(pins: Pins, keepIds: string[] = []): Promise<void> {
  const active = new Set<string>(keepIds);
  for (const pin of pins) {
    if (pin?.customId) active.add(pin.customId);
  }
  try {
    const db = await openPlazaDb();
    const keys = await new Promise<IDBValidKey[]>((done) => {
      const req = db.transaction(CUSTOM_STORE).objectStore(CUSTOM_STORE).getAllKeys();
      req.onsuccess = () => done(req.result ?? []);
      req.onerror = () => done([]);
    });
    const stale = keys.filter((k) => typeof k === 'string' && !active.has(k));
    if (!stale.length) return;
    await new Promise<void>((done) => {
      const tx = db.transaction(CUSTOM_STORE, 'readwrite');
      const store = tx.objectStore(CUSTOM_STORE);
      for (const k of stale) store.delete(k);
      tx.oncomplete = () => done();
      tx.onerror = () => done();
    });
  } catch {
    // Non-fatal cleanup.
  }
}

export function decodeImageBlob(blob: Blob): Promise<HTMLImageElement | null> {
  const img = new Image();
  const src = URL.createObjectURL(blob);
  img.src = src;
  return img.decode().then(
    () => img,
    () => null,
  ).finally(() => URL.revokeObjectURL(src));
}

async function isAnimatedImage(blob: Blob): Promise<boolean> {
  if (!ANIMATED_TYPES.has(blob.type) || !('ImageDecoder' in window)) return false;
  try {
    if (!(await ImageDecoder.isTypeSupported(blob.type))) return false;
    const decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type: blob.type });
    await decoder.tracks.ready;
    const count = decoder.tracks.selectedTrack?.frameCount ?? 1;
    decoder.close();
    return count > 1;
  } catch {
    return false;
  }
}

/**
 * Normalizes a user-chosen PNG, JPG, WebP, SVG, or GIF. Animated files keep their raw frames when
 * within the size budget; static files are downscaled to a compact 512x512 WebP/PNG.
 */
export async function processCustomFile(file: File): Promise<{ entry: StoredCustomTile; error?: string }> {
  if (await isAnimatedImage(file)) {
    if (file.size > MAX_ANIMATED_BYTES) {
      return {
        entry: { blob: file, animated: false },
        error: 'Animated image is over 8 MB; pick a smaller GIF',
      };
    }
    return { entry: { blob: file, animated: true } };
  }

  const img = await decodeImageBlob(file);
  if (!img) {
    return {
      entry: { blob: file, animated: false },
      error: 'Could not read that image file',
    };
  }

  const w = img.naturalWidth || img.width || MAX_STATIC_SIDE;
  const h = img.naturalHeight || img.height || MAX_STATIC_SIDE;
  const scale = Math.min(1, MAX_STATIC_SIDE / Math.max(w, h));
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));

  const c = document.createElement('canvas');
  c.width = outW;
  c.height = outH;
  const g = c.getContext('2d');
  if (!g) {
    return { entry: { blob: file, animated: false } };
  }
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, outW, outH);

  // Use lossless PNG if alpha is present, else compact WebP.
  const hasAlpha = (() => {
    try {
      const sample = g.getImageData(0, 0, Math.min(32, outW), Math.min(32, outH)).data;
      for (let i = 3; i < sample.length; i += 4) if (sample[i] < 250) return true;
    } catch {
      return true;
    }
    return false;
  })();

  const blob = await new Promise<Blob | null>((done) => c.toBlob(done, hasAlpha ? 'image/png' : 'image/webp', 0.9));
  return { entry: { blob: blob ?? file, animated: false } };
}

/**
 * Streams frames from an animated GIF/WebP/APNG onto a 512x512 canvas using WebCodecs `ImageDecoder`,
 * returning null if unavailable or single-frame.
 */
export async function createAnimatedTilePlayer(blob: Blob): Promise<AnimatedTilePlayer | null> {
  if (!('ImageDecoder' in window)) return null;
  let decoder: ImageDecoder | null = null;
  try {
    if (!(await ImageDecoder.isTypeSupported(blob.type))) return null;
    decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type: blob.type });
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    const frameCount = track?.frameCount ?? 1;
    if (frameCount <= 1) {
      decoder.close();
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const g = canvas.getContext('2d');
    if (!g) {
      decoder.close();
      return null;
    }

    let index = 0;
    let nextAt = 0;
    let decoding = false;
    let dirty = false;
    let dead = false;

    const drawFrame = (frame: VideoFrame) => {
      const fw = frame.displayWidth || canvas.width;
      const fh = frame.displayHeight || canvas.height;
      const scale = Math.max(canvas.width / fw, canvas.height / fh);
      const dw = fw * scale;
      const dh = fh * scale;
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.drawImage(frame, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
    };

    const first = await decoder.decode({ frameIndex: 0 });
    drawFrame(first.image);
    const firstMs = Math.max(20, (first.image.duration ?? 100_000) / 1000);
    first.image.close();
    nextAt = performance.now() + firstMs;

    const queueDecode = () => {
      if (dead || decoding || !decoder) return;
      decoding = true;
      const nextIdx = (index + 1) % frameCount;
      void decoder
        .decode({ frameIndex: nextIdx })
        .then((res) => {
          if (dead) {
            res.image.close();
            return;
          }
          index = nextIdx;
          drawFrame(res.image);
          const durMs = Math.max(20, (res.image.duration ?? 100_000) / 1000);
          res.image.close();
          nextAt = performance.now() + durMs;
          dirty = true;
        })
        .catch(() => {
          // Skip transient decode failures without breaking the loop.
        })
        .finally(() => {
          decoding = false;
        });
    };

    return {
      canvas,
      step(nowMs: number) {
        if (dead) return false;
        if (nowMs >= nextAt) queueDecode();
        if (!dirty) return false;
        dirty = false;
        return true;
      },
      dispose() {
        if (dead) return;
        dead = true;
        decoder?.close();
        decoder = null;
      },
    };
  } catch {
    decoder?.close();
    return null;
  }
}
