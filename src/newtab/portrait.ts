// Renders crisp 2D Mii head portraits on demand using the existing plaza WebGLRenderer and FFL kit.
// Cached by Mii code so each Mii's avatar is rendered at most once per tab session.
import * as THREE from 'three';
import { decodeMii } from '../components/mii/data';
import type { MiiKit } from '../components/mii/kit';
import { withLook } from '../components/mii/rig';
import {
  FFLExpression,
  FFLModelFlag,
  FFLResourceType,
  createCharModel,
  initCharModelTextures,
  makeExpressionFlag,
} from '../components/mii/vendor/ffl.js';
import FFLShaderMaterial from '../components/mii/vendor/FFLShaderMaterial.js';

const SIZE = 96;
const HALF = 50;
const MID = 34;

export interface PortraitRenderer {
  peek(code: string, leftEye?: string): string | null;
  render(code: string, leftEye?: string): string | null;
  dispose(): void;
}

export function createPortraitRenderer(kit: MiiKit, renderer: THREE.WebGLRenderer): PortraitRenderer {
  const cache = new Map<string, string>();
  const stage = new THREE.Scene();
  const eye = new THREE.OrthographicCamera(-HALF, HALF, MID + HALF, MID - HALF, -300, 300);
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE, {
    depthBuffer: true,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const clearColor = new THREE.Color();
  let disposed = false;

  return {
    peek(code, leftEye) {
      if (disposed) return null;
      const cacheKey = leftEye ? `${code}|${leftEye}` : code;
      return cache.get(cacheKey) ?? null;
    },

    render(code, leftEye) {
      if (disposed || !ctx || renderer.getContext().isContextLost()) return null;
      const cacheKey = leftEye ? `${code}|${leftEye}` : code;
      const hit = cache.get(cacheKey);
      if (hit) return hit;
      const raw = decodeMii(code);
      if (!raw) return null;
      const data = leftEye ? withLook(kit, raw, { leftEye }) : raw;

      let model: ReturnType<typeof createCharModel> | null = null;
      const prevTarget = renderer.getRenderTarget();
      renderer.getClearColor(clearColor);
      const prevAlpha = renderer.getClearAlpha();

      try {
        model = createCharModel(
          data,
          {
            resolution: 256,
            allExpressionFlag: makeExpressionFlag([FFLExpression.NORMAL]),
            modelFlag: FFLModelFlag.NORMAL,
            resourceType: FFLResourceType.HIGH,
          },
          FFLShaderMaterial,
          kit.ffl,
          false,
        );
        if (leftEye) {
          const c = new THREE.Color().setStyle(leftEye, THREE.LinearSRGBColorSpace);
          model.eyeColors = [[c.r, c.g, c.b]];
        }
        initCharModelTextures(model, renderer, FFLShaderMaterial);
        if (!model.meshes) return null;

        model.setExpression(FFLExpression.NORMAL);
        model.meshes.rotation.set(0, 0.12, 0);
        stage.add(model.meshes);

        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(stage, eye);
        renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);

        const img = ctx.createImageData(SIZE, SIZE);
        const rowBytes = SIZE * 4;
        for (let y = 0; y < SIZE; y++) {
          const src = (SIZE - 1 - y) * rowBytes;
          img.data.set(pixels.subarray(src, src + rowBytes), y * rowBytes);
        }
        ctx.putImageData(img, 0, 0);
        const url = canvas.toDataURL('image/png');
        cache.set(cacheKey, url);
        return url;
      } catch (err) {
        console.warn('Could not render Mii portrait', err);
        return null;
      } finally {
        if (model?.meshes) stage.remove(model.meshes);
        model?.dispose();
        renderer.setRenderTarget(prevTarget);
        renderer.setClearColor(clearColor, prevAlpha);
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      target.dispose();
      cache.clear();
    },
  };
}
