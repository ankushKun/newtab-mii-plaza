// The picture inside each glass block: a faint plus on soft glass when empty, a custom photo/GIF
// when set, the site's favicon floating directly in clear refracting glass (transparent when the
// icon has transparency), or a muted faint version of the extension's logo when no icon exists.
import { browser } from 'wxt/browser';
import type { Pin } from './pins';

const SIZE = 512;

let brandLogo: HTMLImageElement | null = null;
let brandReady: Promise<HTMLImageElement | null> | null = null;

export function loadBrandLogo(): Promise<HTMLImageElement | null> {
  if (brandLogo) return Promise.resolve(brandLogo);
  if (!brandReady) {
    const img = new Image();
    img.src = browser.runtime.getURL('/icon/128.png' as '/');
    brandReady = img.decode().then(
      () => {
        brandLogo = img;
        return img;
      },
      () => null,
    );
  }
  return brandReady;
}

let probeCtx: CanvasRenderingContext2D | null | undefined;
function getProbeCtx() {
  if (probeCtx !== undefined) return probeCtx;
  const probe = document.createElement('canvas');
  probe.width = probe.height = 16;
  probeCtx = probe.getContext('2d', { willReadFrequently: true });
  return probeCtx;
}

function canvas(size = SIZE) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas is unavailable');
  return [c, g] as const;
}

function pearl(g: CanvasRenderingContext2D, size: number) {
  const fill = g.createRadialGradient(size * 0.38, size * 0.3, 0, size * 0.5, size * 0.5, size * 0.75);
  fill.addColorStop(0, '#ffffff');
  fill.addColorStop(1, '#e4ecef');
  g.fillStyle = fill;
  g.fillRect(0, 0, size, size);
}

function iconDims(icon: CanvasImageSource): [number, number] {
  if (icon instanceof HTMLImageElement) return [icon.naturalWidth || icon.width, icon.naturalHeight || icon.height];
  if (icon instanceof HTMLCanvasElement) return [icon.width, icon.height];
  return [0, 0];
}

function inspectImage(icon: CanvasImageSource): { transparent: boolean; nearBlack: boolean } {
  const ctx = getProbeCtx();
  if (!ctx) return { transparent: false, nearBlack: false };
  try {
    ctx.clearRect(0, 0, 16, 16);
    ctx.drawImage(icon, 0, 0, 16, 16);
    const { data } = ctx.getImageData(0, 0, 16, 16);
    let opaqueCount = 0;
    let lumSum = 0;
    let transparentCount = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      if (a < 0.15) {
        transparentCount++;
        continue;
      }
      opaqueCount++;
      const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      lumSum += lum;
    }
    const transparent = transparentCount >= 16;
    const nearBlack = Boolean(opaqueCount && transparent && lumSum / opaqueCount < 0.18);
    return { transparent, nearBlack };
  } catch {
    return { transparent: false, nearBlack: false };
  }
}

export function drawTile(
  pin: Pin | null,
  icon: CanvasImageSource | null,
  size = SIZE,
  customImage: CanvasImageSource | null = null,
): HTMLCanvasElement {
  const [c, g] = canvas(size);
  if (!pin) {
    pearl(g, size);
    g.strokeStyle = '#c5d2d6';
    g.lineWidth = size * 0.045;
    g.lineCap = 'round';
    const arm = size * 0.1;
    g.beginPath();
    g.moveTo(size / 2 - arm, size / 2);
    g.lineTo(size / 2 + arm, size / 2);
    g.moveTo(size / 2, size / 2 - arm);
    g.lineTo(size / 2, size / 2 + arm);
    g.stroke();
    return c;
  }
  const art = customImage ?? icon;
  if (art) {
    const [iw, ih] = iconDims(art);
    const { transparent, nearBlack } = inspectImage(art);
    g.imageSmoothingQuality = 'high';
    if (transparent && iw > 0 && ih > 0) {
      // Leave canvas transparent so the glass refracts cleanly behind favicons/cutouts.
      const scale = Math.min((size * 0.84) / iw, (size * 0.84) / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      if (nearBlack) {
        g.shadowColor = 'rgba(255, 255, 255, 0.55)';
        g.shadowBlur = size * 0.045;
        g.shadowOffsetY = 0;
      } else {
        g.shadowColor = 'rgba(0, 15, 30, 0.25)';
        g.shadowBlur = size * 0.03;
        g.shadowOffsetY = size * 0.012;
      }
      g.drawImage(art, (size - dw) / 2, (size - dh) / 2, dw, dh);
    } else if (iw > 0 && ih > 0) {
      const scale = Math.max(size / iw, size / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      g.drawImage(art, (size - dw) / 2, (size - dh) / 2, dw, dh);
    } else {
      g.drawImage(art, 0, 0, size, size);
    }
    return c;
  }
  if (brandLogo) {
    const side = size * 0.72;
    g.save();
    g.globalAlpha = 0.34;
    g.filter = 'grayscale(0.82) contrast(0.9)';
    g.imageSmoothingQuality = 'high';
    g.drawImage(brandLogo, (size - side) / 2, (size - side) / 2, side, side);
    g.restore();
  } else {
    void loadBrandLogo();
  }
  return c;
}
