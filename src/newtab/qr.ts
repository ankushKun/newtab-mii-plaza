// Lazy-loaded local QR scanner for 3DS / Wii U Mii QR code images.
// Uses jsQR to read raw binary QR payloads (preserving non-UTF8 encrypted bytes for miiFromQr).
import jsQR from 'jsqr';
import { encodeMii, miiFromQr, miiInfo } from '../components/mii/data';

export type ScanMiiResult =
  | { ok: true; name: string; code: string }
  | { ok: false; error: string };

const MAX_DIM = 1400;

type ImageSource = {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, sx: number, sy: number, sw: number, sh: number, dw: number, dh: number) => void;
  close: () => void;
};

async function openImageSource(file: File): Promise<ImageSource | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, sx, sy, sw, sh, dw, dh) => ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh),
        close: () => bitmap.close(),
      };
    } catch {
      // Fall back to HTMLImageElement below for SVG or unsupported bitmap cases.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image load failed'));
      el.src = url;
    });
    return {
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      draw: (ctx, sx, sy, sw, sh, dw, dh) => ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh),
      close: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function scanCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, contrast = false): { payload: Uint8Array } | null {
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (contrast) {
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      const v = lum < 128 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  const qr = jsQR(imgData.data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' });
  if (!qr || !qr.binaryData.length) return null;
  return { payload: Uint8Array.from(qr.binaryData) };
}

export async function scanMiiQrFile(file: File): Promise<ScanMiiResult> {
  if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name)) {
    return { ok: false, error: 'Please select an image file containing a Mii QR code' };
  }
  const source = await openImageSource(file);
  if (!source || source.width < 16 || source.height < 16) {
    source?.close();
    return { ok: false, error: 'Could not read that image file' };
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    source.close();
    return { ok: false, error: 'Canvas 2D is unavailable in this browser' };
  }

  let sawNonMiiQr = false;
  try {
    const { width: w, height: h } = source;
    const fitScale = Math.min(1, MAX_DIM / Math.max(w, h));
    const passes: { sx: number; sy: number; sw: number; sh: number; scale: number; crisp: boolean; contrast: boolean }[] = [
      // 1. Full image at native/capped size
      { sx: 0, sy: 0, sw: w, sh: h, scale: fitScale, crisp: false, contrast: false },
    ];
    // 2. Crisp 2x upscale for small 3DS/Wii U card images (e.g. 400x240)
    if (Math.max(w, h) < 900) {
      passes.push({ sx: 0, sy: 0, sw: w, sh: h, scale: 2, crisp: true, contrast: false });
    }
    // 3. Card sub-regions where Mii QR codes typically sit (right half, left half, corners, center)
    const crops: [number, number, number, number][] = [
      [0.4, 0, 0.6, 1],
      [0, 0, 0.6, 1],
      [0.45, 0.35, 0.55, 0.65],
      [0.45, 0, 0.55, 0.65],
      [0.15, 0.15, 0.7, 0.7],
    ];
    for (const [rx, ry, rw, rh] of crops) {
      const sw = Math.max(24, Math.round(w * rw));
      const sh = Math.max(24, Math.round(h * rh));
      const sx = Math.round(w * rx);
      const sy = Math.round(h * ry);
      const scale = Math.min(2, MAX_DIM / Math.max(sw, sh));
      passes.push({ sx, sy, sw, sh, scale, crisp: Math.max(sw, sh) < 500, contrast: false });
    }
    // 4. High-contrast binary pass for washed-out or photographed screens
    passes.push({ sx: 0, sy: 0, sw: w, sh: h, scale: fitScale, crisp: false, contrast: true });
    passes.push({ sx: Math.round(w * 0.4), sy: 0, sw: Math.round(w * 0.6), sh: h, scale: Math.min(2, MAX_DIM / Math.max(w * 0.6, h)), crisp: true, contrast: true });

    for (const pass of passes) {
      const dw = Math.max(1, Math.round(pass.sw * pass.scale));
      const dh = Math.max(1, Math.round(pass.sh * pass.scale));
      canvas.width = dw;
      canvas.height = dh;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, dw, dh);
      ctx.imageSmoothingEnabled = !pass.crisp;
      source.draw(ctx, pass.sx, pass.sy, pass.sw, pass.sh, dw, dh);

      const detected = scanCanvas(canvas, ctx, pass.contrast);
      if (!detected) continue;

      try {
        const mii = await miiFromQr(detected.payload);
        const info = miiInfo(mii);
        const name = info.name.trim() || 'Mii';
        return { ok: true, name, code: encodeMii(mii) };
      } catch {
        sawNonMiiQr = true;
      }
    }

    return {
      ok: false,
      error: sawNonMiiQr
        ? 'That QR code is not a valid 3DS or Wii U Mii QR code'
        : 'No QR code found in that image',
    };
  } finally {
    source.close();
  }
}
