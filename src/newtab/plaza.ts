// The plaza on a new tab: the crowd, floor and glass blocks (src/components/) with none of the
// site's features around them. No opening, no sound, no bubbles, no DJ. It starts settled and
// zoomed all the way out, draws at the display's own pace, stops drawing when nobody has touched
// it for a while, and gives the GPU back on `destroy`.
import * as THREE from 'three';
import type { AnimatedTilePlayer } from './custom';
import type { ThemeMode } from './pins';
import { createPortraitRenderer } from './portrait';
import { loadMiiKit } from '../components/mii/kit';
import { Bubbles, type Box } from '../components/plaza/bubbles';
import { Crowd } from '../components/plaza/crowd';
import { Cubes } from '../components/plaza/cubes';
import { Floor, HAZE } from '../components/plaza/floor';
import { HeadCards } from '../components/plaza/heads';
import { CUBE, applyView, blankView, copyView, makeLayout, mixViews, type View } from '../components/plaza/layout';
import type { PlazaMii, PlazaPost } from '../components/plaza/types';
import { clamp, damp, rng, smoothstep } from '../components/plaza/util';
import { voices } from '../components/plaza/voices';

/** Zoom runs from 0 (farthest, where it starts) to 3 (the middle group up close). */
const ZOOM = { min: 0, max: 3, close: 2.5 };
/**
 * A name tag's size in world units, so it is about a fifth of a Mii's height at every zoom. Far out,
 * where that would be too small to read, it holds at TAG_MIN pixels.
 */
const TAG_SIZE = 0.18;
const TAG_MIN = 12;
/**
 * Panning with the middle mouse button, zoomed in past `from`: it takes full effect by `full`, and
 * the view's middle can go no further than `pad` beyond the outermost blocks. Zoomed back out to
 * `from`, the camera recenters.
 */
const PAN = { from: 0.15, full: 1, pad: 1.5 };
/** Seconds the camera takes to zoom into a pressed block before its site opens. */
const DIVE = 0.45;
/** Milliseconds without input before it stops drawing. Any input starts it again. */
const IDLE = 5 * 60 * 1000;
/** How many Miis walk about: fewer than the site's, since each costs time to build on every tab. */
const CROWD = { desktop: 40, small: 24 };
/** Normal voice/SFX output level for Mii voices on the new tab plaza. */
const VOICES = 0.28;

export interface Plaza {
  /** Turns block `i` once round, its picture becoming `art` as it passes edge on. */
  setTile(i: number, art: HTMLCanvasElement, player?: AnimatedTilePlayer | null): void;
  /** Marks block `i` as empty or filled so empty glass rests softer. */
  setEmpty(i: number, empty: boolean): void;
  /** Adjusts target zoom level relative to the current zoom. */
  zoomBy(delta: number): void;
  /** Sets target zoom level directly (0 is farthest, 3 is closest). */
  setZoom(level: number): void;
  /** Current target zoom level. */
  getZoom(): number;
  /** Switches day/night mode (`system`, `light`, or `dark`) smoothly. */
  setTheme(theme: ThemeMode): void;
  /** Mutes or unmutes Mii voices and plaza SFX. */
  setMuted(muted: boolean): void;
  /** Speech bubbles controller wired into the plaza loop. */
  readonly bubbles: Bubbles;
  /** Replaces the Miis walking in the plaza without recreating the scene. */
  setMiis(hero: PlazaMii[], pool: PlazaMii[]): void;
  /** Returns an already-cached portrait PNG data URL without triggering a render. */
  peekPortrait(code: string, leftEye?: string): string | null;
  /** Renders a transparent PNG data URL portrait of a Mii's head. */
  renderPortrait(code: string, leftEye?: string): string | null;
  /** Zooms into block `i`, then calls `then`. */
  dive(i: number, then: () => void): void;
  /** Restores the plaza if a navigation after `dive` fails or is cancelled. */
  cancelDive(): void;
  /** Stops for good and frees the GPU. Showing the plaza again takes a reload. */
  destroy(): void;
}

export interface PlazaOptions {
  /** One element per block, laid over it every frame. */
  links: HTMLElement[];
  /** Each block's picture, square. */
  tiles: HTMLCanvasElement[];
  /** Optional animated frame players corresponding to `tiles`. */
  players?: (AnimatedTilePlayer | null)[];
  /** Whether each slot starts empty. */
  empty?: boolean[];
  /** Initial appearance mode (`system`, `light`, or `dark`). */
  theme?: ThemeMode;
  /** Your own Mii (first) and optional middle-group Miis. */
  hero?: PlazaMii[];
  /** Uploaded Miis to spawn in the plaza. */
  pool?: PlazaMii[];
  /** Start with Mii voices muted. */
  muteVoices?: boolean;
  /** Optional posts to show in speech bubbles. */
  posts?: PlazaPost[];
  /** Optional opening greeting bubble. */
  greeting?: PlazaPost | null;
  /** Optional fallback icon URLs indexed by cube. */
  thumbs?: string[];
  /** Called when a speech bubble is clicked; falls back to diving into `post.href` if set. */
  onBubbleClick?: (post: PlazaPost, speaker: number) => void;
  /** Called when the target zoom level changes. */
  onZoom?: (zoom: number) => void;
  /** Once the first frames are up. */
  onLive(): void;
  /** The browser took the GPU context away. */
  onLost(): void;
}

export async function start(
  root: HTMLElement,
  { links, tiles, players, empty, theme, hero, pool, muteVoices, posts, greeting, thumbs, onBubbleClick, onZoom, onLive, onLost }: PlazaOptions,
): Promise<Plaza> {
  const canvas = root.querySelector('canvas');
  if (!canvas) throw new Error('The plaza needs a canvas');
  const bubbleLayer = root.querySelector<HTMLElement>('.plaza-bubbles') ?? root;
  const card = root.querySelector<HTMLElement>('.plaza-who');
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = root.clientWidth;
  let h = root.clientHeight;
  const small = matchMedia('(pointer: coarse)').matches || Math.min(w, h) < 640;
  const device = navigator as Navigator & { deviceMemory?: number };
  const weak = (device.deviceMemory ?? 8) < 4 || (navigator.hardwareConcurrency || 8) < 4;

  const kit = await loadMiiKit();

  // The integrated GPU is plenty, and a laptop keeps its battery.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  // Resolution steps it can drop through if a device can't keep up (`govern`).
  const ratios = [Math.min(devicePixelRatio, 2), 1.5, 1.25, 1, 0.8, 0.65].filter((r, i, all) => r <= all[0] && all.indexOf(r) === i);
  let ratioLevel = weak ? Math.max(0, ratios.findIndex((r) => r <= 1.25)) : 0;
  renderer.setPixelRatio(ratios[ratioLevel]);
  renderer.setSize(w, h, false);
  // Every shader here writes display colors directly, as the Mii shader does.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  // The blocks are drawn last, over a copy of everything else, which their glass looks through.
  const glass = new THREE.Scene();
  let behind = new THREE.FramebufferTexture(1, 1);
  const size = new THREE.Vector2();
  function sizeBehind() {
    renderer.getDrawingBufferSize(size);
    if (behind.image.width === size.x && behind.image.height === size.y) return;
    behind.dispose();
    behind = new THREE.FramebufferTexture(size.x, size.y);
    behind.minFilter = behind.magFilter = THREE.LinearFilter;
    cubes.setBehind(behind, size.x, size.y);
  }
  const camera = new THREE.PerspectiveCamera(5.2, w / h, 1, 2500);
  const floor = new Floor(scene, weak ? 0.35 : 0.5);
  floor.resize(renderer);

  // Day or night after preference or system light/dark, easing over about half a second.
  const dark = matchMedia('(prefers-color-scheme: dark)');
  let themeMode: ThemeMode = theme ?? 'system';
  const wantsNight = () => (themeMode === 'dark' ? 1 : themeMode === 'light' ? 0 : dark.matches ? 1 : 0);
  let night = wantsNight();
  let nightTo = night;
  floor.setNight(night);
  renderer.setClearColor(HAZE, 1);
  dark.addEventListener('change', () => {
    nightTo = wantsNight();
    wake();
  });

  const texture = (art: HTMLCanvasElement) => {
    const tex = new THREE.CanvasTexture(art);
    tex.premultiplyAlpha = true;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
  };
  const textures = tiles.map(texture);
  const animatedPlayers: (AnimatedTilePlayer | null)[] = links.map((_, i) => players?.[i] ?? null);
  const animatedTextures: (THREE.Texture | null)[] = links.map((_, i) => (animatedPlayers[i] ? textures[i] : null));
  const cubes = new Cubes(scene, glass, textures);
  cubes.setNight(night);
  empty?.forEach((isEmpty, i) => cubes.setEmpty(i, isEmpty, true));

  // Mii voices & SFX (voices.ts): unlocked on first user gesture and silent when muted or hidden.
  let muted = Boolean(muteVoices);
  const audioCtx = typeof AudioContext !== 'undefined' ? new AudioContext() : null;
  const voice = voices(audioCtx);
  const ear = new THREE.Vector3();
  const you = new THREE.Vector3();
  let dead = false;
  let diving = false;
  const hearVoices = (seconds = 0.25) => {
    voice?.setLevel(!muted && !dead && !document.hidden && !diving && !root.dataset.leaving ? VOICES : 0, seconds);
  };
  const unlockAudio = () => {
    if (muted || dead || !audioCtx || document.hidden) return;
    void voice?.ready();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
  };
  if (audioCtx) {
    audioCtx.addEventListener('statechange', () => hearVoices());
    for (const type of ['pointerdown', 'keydown', 'touchend'] as const) {
      addEventListener(type, unlockAudio, { passive: true, capture: true });
    }
    if (!muted) void voice?.ready();
    hearVoices(0);
  }

  // Speech bubbles (bubbles.ts): wired into the crowd and block layout, silent until posts are given.
  const bubbles = new Bubbles(bubbleLayer, posts ?? [], thumbs ?? [], greeting ?? null);

  // Only user-configured Miis (your default Mii plus uploaded QR Miis), never random Miis.
  let crowd!: Crowd;
  let cards: HeadCards | null = null;
  let built = false;
  let carded = false;
  function spawnCrowd(nextHero: PlazaMii[], nextPool: PlazaMii[], preserve = false) {
    const prev = preserve ? crowd : null;
    const sameLead = Boolean(prev && nextHero[0]?.code === prev.miis[0]?.who?.code);
    if (!sameLead) bubbles.clear();
    cards?.dispose();
    const next = new Crowd(scene, {
      kit,
      renderer,
      hero: nextHero,
      pool: nextPool,
      count: small || weak ? CROWD.small : CROWD.desktop,
      cubes: links.length,
      djCube: -1,
      dj: null,
      backup: [],
      polka: [],
      tetoris: {},
      resolution: 128,
      random: rng((Math.random() * 2 ** 31) | 0),
      shuffle: !preserve,
    });
    if (prev) {
      next.setLayout(layout);
      next.preserveFrom(prev, time);
      prev.dispose();
    } else {
      crowd?.dispose();
    }
    crowd = next;
    if (voice) {
      crowd.onCue = (i, cue) => {
        if (muted || dead || document.hidden || diving || root.dataset.leaving || !voice.hears(cue)) return;
        const far = crowd.headTop(i, ear).distanceTo(camera.position);
        const near = crowd.miis.length ? crowd.headTop(0, you).distanceTo(camera.position) : far;
        ear.project(camera);
        voice.cue(cue, crowd.speaker(i), {
          pan: clamp(ear.x, -1, 1) * 0.75,
          gain: clamp((near / Math.max(0.01, far)) ** 2, 0.15, 1),
          seen: ear.z < 1 && Math.abs(ear.x) < 1.1 && Math.abs(ear.y) < 1.1,
          intro: false,
        });
      };
    }
    // Heads small on screen are drawn as flat pictures, all in one draw call (only when crowd Miis exist).
    cards = crowd.crowdSet.count > 0 ? new HeadCards(scene, renderer, crowd.crowdSet, small || weak ? 56 : 80) : null;
    built = prev ? crowd.build(performance.now() + 24) : false;
    carded = !cards;
  }
  spawnCrowd(hero ?? [], pool ?? []);
  sizeBehind();
  const portraits = createPortraitRenderer(kit, renderer);

  // Camera ---------------------------------------------------------------------------------------

  const wide = links.map((_, i) => i);
  let layout = makeLayout(w / h, links.length, wide);
  const now = blankView();
  const zoomed = blankView();
  const shown = blankView();
  let zoomTo = 0;
  let zoom = 0;
  let close = false;
  /** How far the middle of the view has been dragged across the floor (x and z), and the drag going on. */
  const pan = new THREE.Vector2();
  let panning: { id: number; x: number; y: number; moved: boolean } | null = null;
  /** The pointer, -1..1 across and up the screen, and the camera's eased response to it. */
  const pointer = new THREE.Vector2();
  const follow = new THREE.Vector2();
  let time = 0;
  /** How much the blocks show, eased, so they fade rather than blink out up close. */
  let blocksShown = 1;

  function arrange() {
    layout = makeLayout(w / h, links.length, wide);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    applyView(camera, layout.views[0]);
    cubes.place(layout.anchors, camera);
    crowd.setLayout(layout);
  }
  arrange();
  crowd.settle(0);
  cubes.settle();
  copyView(layout.views[0], now);

  const setZoom = (level: number) => {
    const next = clamp(level, ZOOM.min, ZOOM.max);
    if (next === zoomTo) return;
    zoomTo = next;
    wake();
    onZoom?.(zoomTo);
  };

  const zoomBy = (amount: number) => setZoom(zoomTo + amount);

  /** The view for a zoom level between the four set ones. */
  function zoomView(level: number, out: View) {
    const { views } = layout;
    const i = Math.min(Math.floor(level), views.length - 2);
    return mixViews(views[i], views[i + 1], level - i, out);
  }

  /** The view for the current zoom, moved across the floor by however far it has been panned. */
  function restView(out: View) {
    zoomView(zoom, out);
    const weight = smoothstep(PAN.from, PAN.full, zoom);
    if (zoomTo <= PAN.from && zoom <= PAN.from + 0.05) pan.set(0, 0);
    // Never off past the outermost blocks.
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const a of [...layout.anchors, layout.hero]) {
      minX = Math.min(minX, a.x);
      maxX = Math.max(maxX, a.x);
      minZ = Math.min(minZ, a.z);
      maxZ = Math.max(maxZ, a.z);
    }
    pan.x = clamp(pan.x, minX - PAN.pad - out.target.x, maxX + PAN.pad - out.target.x);
    pan.y = clamp(pan.y, minZ - PAN.pad - out.target.z, maxZ + PAN.pad - out.target.z);
    out.target.x += pan.x * weight;
    out.target.z += pan.y * weight;
    return out;
  }

  const blockAt = (i: number) => {
    const at = layout.anchors[i];
    return new THREE.Vector3(at.x, CUBE.lift, at.z);
  };

  /** The view up close on `point`, from `from`: `near` is how much of the distance is left. */
  function closeOn(point: THREE.Vector3, from: View, near: number, out: View) {
    copyView(from, out);
    out.target.copy(point);
    out.dist = from.dist * near;
    out.haze[0] -= from.dist * (1 - near);
    out.haze[1] -= from.dist * (1 - near);
    return out;
  }

  const diveFrom = blankView();
  const diveTo = blankView();
  let diveAt = 0;

  function aim(dt: number) {
    zoom = calm ? zoomTo : damp(zoom, zoomTo, 7, dt);
    // Coming in close, the middle group turns to look; bubbles make way.
    if (zoom > ZOOM.close !== close) {
      close = !close;
      if (close) bubbles.dismiss();
      crowd.notice(close, time);
    }
    if (diving) {
      const p = Math.min(1, (time - diveAt) / DIVE);
      return mixViews(diveFrom, diveTo, p * p * (3 - 2 * p) * 0.6 + p * p * 0.4, now);
    }
    return mixViews(now, restView(zoomed), calm ? 1 : 1 - Math.exp(-14 * dt), now);
  }

  /** The view actually shown: the aimed one, eased a little toward the pointer, as in a game. */
  function lean(v: View, dt: number) {
    copyView(v, shown);
    if (calm) return shown;
    follow.x = damp(follow.x, pointer.x, 2.6, dt);
    follow.y = damp(follow.y, pointer.y, 2.6, dt);
    const span = shown.dist * Math.tan(THREE.MathUtils.degToRad(shown.fov / 2));
    shown.target.x += follow.x * span * camera.aspect * 0.035;
    shown.target.z -= follow.y * span * 0.12;
    shown.yaw -= follow.x * 0.03;
    shown.pitch += follow.y * 0.012;
    return shown;
  }

  // Input ----------------------------------------------------------------------------------------

  // Any input wakes it from an idle pause.
  let lastInput = performance.now();
  const touched = () => {
    lastInput = performance.now();
    wake();
  };
  for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown'] as const) addEventListener(type, touched, { passive: true, capture: true });

  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target instanceof Element && e.target.closest('input, dialog'))) return;
    if (e.key === '+' || e.key === '=') zoomBy(0.5);
    else if (e.key === '-' || e.key === '_') zoomBy(-0.5);
  });
  root.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const lines = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? h : 1;
      zoomBy(-e.deltaY * lines * (e.ctrlKey ? 0.012 : 0.0025));
    },
    { passive: false },
  );
  // Zoomed in, holding the middle mouse button drags the floor, to look round other parts of the
  // plaza: the spot under the pointer stays under it, as with a map. Zooming back out recenters.
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 1 || e.pointerType !== 'mouse' || diving || zoomTo <= PAN.from || (e.target instanceof Element && e.target.closest('dialog'))) return;
    e.preventDefault();
    panning = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    root.setPointerCapture(e.pointerId);
    root.dataset.panning = '';
  });
  root.addEventListener('pointermove', (e) => {
    if (panning?.id !== e.pointerId) return;
    const dx = e.clientX - panning.x;
    const dy = e.clientY - panning.y;
    panning.x = e.clientX;
    panning.y = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 0) panning.moved = true;
    // World units a pixel covers at the middle of the view; up and down the screen runs across the
    // floor at a slant, so each pixel there covers more of it.
    const perPixel = (2 * shown.dist * Math.tan(THREE.MathUtils.degToRad(shown.fov / 2))) / h / Math.max(0.2, smoothstep(PAN.from, PAN.full, zoom));
    const deep = 1 / Math.max(0.2, Math.sin(shown.pitch));
    const cos = Math.cos(shown.yaw);
    const sin = Math.sin(shown.yaw);
    pan.x += (-cos * dx - sin * dy * deep) * perPixel;
    pan.y += (sin * dx - cos * dy * deep) * perPixel;
  });
  const endPan = (e: PointerEvent) => {
    if (panning?.id !== e.pointerId) return;
    if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
    // A drag isn't a middle click: it mustn't open a block in a new tab.
    if (panning.moved) {
      const stop = (a: MouseEvent) => a.button === 1 && a.preventDefault();
      addEventListener('auxclick', stop, { capture: true, once: true });
      setTimeout(() => removeEventListener('auxclick', stop, { capture: true }), 0);
    }
    panning = null;
    delete root.dataset.panning;
  };
  root.addEventListener('pointerup', endPan);
  root.addEventListener('pointercancel', endPan);
  // No autoscroll arrows from the middle button over the plaza.
  root.addEventListener('mousedown', (e) => e.button === 1 && e.preventDefault());

  // Touch does what the mouse does: one finger on open floor is the cursor, two pinch to zoom.
  const touches = new Map<number, { x: number; y: number; onBlock: boolean }>();
  let pinch = 0;
  const spread = () => {
    const [a, b] = [...touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const point = (x: number, y: number) => {
    pointer.set((x / w) * 2 - 1, 1 - (y / h) * 2);
    cubes.setMouse(pointer);
  };
  const letLook = () => {
    pointer.set(0, 0);
    cubes.setMouse(null);
  };
  /** Set by each block: lets go of a spin in progress without counting as a tap. */
  const dropSpins: (() => void)[] = [];
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    const onBlock = !!(e.target as Element).closest('[data-slot]') || press?.id === e.pointerId;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, onBlock });
    if (touches.size === 2) {
      pinch = spread();
      for (const drop of dropSpins) drop();
      letGoMii(false);
      letLook();
    } else if (!onBlock) point(e.clientX, e.clientY);
  });
  root.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') return point(e.clientX, e.clientY);
    const t = touches.get(e.pointerId);
    if (!t) return;
    t.x = e.clientX;
    t.y = e.clientY;
    if (touches.size === 1) {
      if (!t.onBlock) point(e.clientX, e.clientY);
      return;
    }
    if (touches.size !== 2) return;
    const d = spread();
    zoomBy(Math.log(d / pinch) * 1.6);
    pinch = d;
  });
  const lift = (e: PointerEvent) => {
    if (!touches.delete(e.pointerId)) return;
    if (touches.size === 0) letLook();
  };
  root.addEventListener('pointerup', lift);
  root.addEventListener('pointercancel', lift);
  root.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') {
      letLook();
      mouse = null;
      hovered = -1;
      hideCard();
    }
  });

  // Miis: tap one and it does something; press and drag to pick it up by the shirt, and let go to
  // set it down or fling it. A short press on a touch screen lifts it without moving.
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const rayAt = (x: number, y: number) => {
    raycaster.setFromCamera(ndc.set((x / w) * 2 - 1, 1 - (y / h) * 2), camera);
    return raycaster.ray;
  };
  const local = (e: PointerEvent) => {
    const box = root.getBoundingClientRect();
    return [e.clientX - box.left, e.clientY - box.top] as const;
  };
  let press: { id: number; mii: number; x: number; y: number; at: number; holding: boolean } | null = null;
  function liftMii() {
    if (!press || press.holding) return;
    press.holding = crowd.grab(press.mii, time, rayAt(press.x, press.y));
    if (press.holding) root.dataset.holding = 'true';
  }
  function letGoMii(tap: boolean) {
    if (!press) return;
    if (press.holding) crowd.release(press.mii, time);
    else if (tap) crowd.poke(press.mii, time, camera.position);
    if (root.hasPointerCapture(press.id)) root.releasePointerCapture(press.id);
    press = null;
    delete root.dataset.holding;
  }
  root.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button > 0 || press || touches.size > 0 || diving || (e.target as Element).closest('[data-slot], dialog')) return;
      const [x, y] = local(e);
      const mii = crowd.pick(camera, x, y, w, h);
      if (mii < 0) return;
      press = { id: e.pointerId, mii, x, y, at: performance.now(), holding: false };
      root.setPointerCapture(e.pointerId);
      hideCard();
    },
    // Ahead of the touch handling, so it knows this finger is on a Mii.
    { capture: true },
  );
  let mouse: { x: number; y: number } | null = null;
  let overUi = false;
  root.addEventListener('pointermove', (e) => {
    const [x, y] = local(e);
    if (e.pointerType === 'mouse') {
      mouse = { x, y };
      overUi = e.target instanceof Element && !!e.target.closest('[data-slot], .plaza-bubble, .hud-manage, dialog');
    }
    if (!press || e.pointerId !== press.id) return;
    if (!press.holding && Math.hypot(x - press.x, y - press.y) > 6) liftMii();
    press.x = x;
    press.y = y;
  });
  root.addEventListener('pointerup', (e) => {
    if (press?.id === e.pointerId) letGoMii(true);
  });
  root.addEventListener('pointercancel', (e) => {
    if (press?.id === e.pointerId) letGoMii(false);
  });

  // A grab cursor and Minecraft-style floating name tag over a hovered Mii.
  const hovers = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const _at = new THREE.Vector3();
  let lastPick = 0;
  let hovered = -1;
  let hoverSince = 0;
  let shownCard = -1;
  let missedAt = -1;
  function hideCard() {
    if (shownCard < 0) return;
    shownCard = -1;
    card?.classList.remove('is-in');
  }
  function hover() {
    if (!hovers) return;
    const now = performance.now();
    if (now - lastPick > 90 || !mouse) {
      lastPick = now;
      let over = mouse && !overUi && !press && !diving && !panning ? crowd.pick(camera, mouse.x, mouse.y, w, h, hovered) : -1;
      if (over < 0 && hovered >= 0 && mouse && !overUi && !press && !diving && !panning) {
        if (missedAt < 0) missedAt = now;
        if (now - missedAt < 350) over = hovered;
      } else missedAt = -1;
      if (over !== hovered) {
        hovered = over;
        hoverSince = now;
        hideCard();
      }
      root.dataset.over = String(hovered >= 0);
    }
    const who = hovered >= 0 ? crowd.who(hovered) : null;
    if (card && who && shownCard !== hovered && now - hoverSince > 400) {
      shownCard = hovered;
      card.textContent = who.name;
      card.classList.add('is-in');
    }
    if (!card || shownCard < 0) return;
    crowd.headTop(shownCard, _at);
    const far = _at.distanceTo(camera.position);
    const perUnit = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * far);
    const px = Math.round(Math.max(TAG_MIN, TAG_SIZE * perUnit) * devicePixelRatio) / devicePixelRatio;
    if (card.style.fontSize !== `${px}px`) card.style.fontSize = `${px}px`;
    _at.project(camera);
    const x = (_at.x + 1) * 0.5 * w;
    const y = (1 - _at.y) * 0.5 * h;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const top = Math.max(8, y - ch - px * 0.4);
    const left = clamp(x - cw / 2, 8, w - cw - 8);
    card.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }

  // Blocks: drag one to spin it, and it springs back when let go. A drag is not a click, so the
  // click that ends one never reaches the page's own handler.
  const spun = new Set<number>();
  links.forEach((link, i) => {
    let grip: { id: number; x: number; y: number; moved: number } | null = null;
    link.draggable = false;
    link.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      grip = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
      spun.delete(i);
      link.setPointerCapture(e.pointerId);
      cubes.grab(i);
    });
    link.addEventListener('pointermove', (e) => {
      if (!grip || e.pointerId !== grip.id) return;
      const dx = e.clientX - grip.x;
      const dy = e.clientY - grip.y;
      grip.x = e.clientX;
      grip.y = e.clientY;
      grip.moved += Math.abs(dx) + Math.abs(dy);
      if (grip.moved > 6) {
        spun.add(i);
        link.dataset.spinning = 'true';
      }
      // About a half turn for a drag across the block.
      const across = Math.max(40, link.offsetWidth);
      cubes.twist(i, (dx / across) * Math.PI * 0.9, (dy / across) * Math.PI * 0.9);
    });
    const letGo = (e: PointerEvent) => {
      if (!grip || e.pointerId !== grip.id) return;
      grip = null;
      delete link.dataset.spinning;
      cubes.release(i);
    };
    dropSpins.push(() => {
      if (!grip) return;
      if (link.hasPointerCapture(grip.id)) link.releasePointerCapture(grip.id);
      grip = null;
      delete link.dataset.spinning;
      spun.add(i);
      cubes.release(i);
    });
    link.addEventListener('pointerup', letGo);
    link.addEventListener('pointercancel', letGo);
    const hoverBlock = (on: boolean) => () => cubes.setHover(i, on);
    link.addEventListener('pointerenter', hoverBlock(true));
    link.addEventListener('pointerleave', hoverBlock(false));
    link.addEventListener('focus', hoverBlock(true));
    link.addEventListener('blur', hoverBlock(false));
    link.addEventListener('pointermove', (e) => {
      if (calm || grip) return;
      const box = link.getBoundingClientRect();
      cubes.setPoint(i, ((e.clientX - box.left) / box.width) * 2 - 1, ((e.clientY - box.top) / box.height) * 2 - 1);
    });
  });
  root.addEventListener(
    'click',
    (e) => {
      const slot = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-slot]') : null;
      const i = slot ? Number(slot.dataset.slot) : -1;
      if (!spun.delete(i)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    { capture: true },
  );

  const sizes = links.map(() => 0);
  const blocks: Box[] = [];
  function placeLinks() {
    blocks.length = 0;
    links.forEach((link, i) => {
      const at = cubes.project(i, camera, w, h);
      const size = Math.round(at.r * 2);
      if (size !== sizes[i]) {
        sizes[i] = size;
        link.style.width = link.style.height = `${size}px`;
      }
      const x = Math.round(at.x - size / 2);
      const y = Math.round(at.y - size / 2);
      link.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      link.style.visibility = at.visible ? 'visible' : 'hidden';
      if (at.visible) blocks.push({ x: at.x - size / 2, y: at.y - size / 2, w: size, h: size });
    });
  }

  bubbleLayer.addEventListener('click', (e) => {
    const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a.plaza-bubble') : null;
    if (!link || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const speaker = bubbles.speakerOf(link);
    const post = bubbles.postOf(link);
    if (speaker < 0 || !post) return;
    e.preventDefault();
    if (onBubbleClick) {
      bubbles.dismiss();
      crowd.hush(speaker, time);
      onBubbleClick(post, speaker);
      return;
    }
    if (!post.href) return;
    link.classList.add('is-chosen');
    diveToPoint(crowd.headTop(speaker, new THREE.Vector3()), 0.12, () => location.assign(post.href), link);
  });

  // Loop -----------------------------------------------------------------------------------------

  function tick(dt: number) {
    time += dt;
    if (night !== nightTo) {
      night = calm || Math.abs(nightTo - night) < 0.002 ? nightTo : damp(night, nightTo, 4.5, dt);
      floor.setNight(night);
      cubes.setNight(night);
      renderer.setClearColor(HAZE, 1);
    }
    const v = lean(aim(dt), dt);
    applyView(camera, v);
    floor.setHaze(v.haze[0], v.haze[1]);
    cubes.setHaze(v.haze[0], v.haze[1]);
    if (press?.holding) crowd.carry(press.mii, rayAt(press.x, press.y));
    crowd.listen(dt, null, 0);
    crowd.update(dt, time, camera.position, calm);
    // Blocks belong to the wide views. Closer in than about two thirds of the standard view they fade.
    const tan = (view: View) => view.dist * Math.tan(THREE.MathUtils.degToRad(view.fov / 2));
    const open = tan(v) / tan(layout.views[1]);
    const showing = diving ? 1 : smoothstep(0.55, 0.78, open);
    blocksShown = calm || dt === 0 ? showing : damp(blocksShown, showing, 4, dt);
    cubes.update(time, dt, calm, camera, v.dist, blocksShown);
    return v;
  }

  function draw(target: THREE.Vector3) {
    renderer.getDrawingBufferSize(size);
    cards?.update(camera, size.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))), true);
    floor.mirror(renderer, scene, camera, target, time);
    renderer.render(scene, camera);
    // The glass looks through a copy of everything drawn so far, then goes on top of it.
    if (cubes.items.some((item) => item.mesh.visible)) {
      renderer.copyFramebufferToTexture(behind);
      renderer.autoClear = false;
      renderer.render(glass, camera);
      renderer.autoClear = true;
    }
    placeLinks();
    if (press && !press.holding && performance.now() - press.at > 350) liftMii();
    hover();
    bubbles.update(time, crowd, camera, w, h, !diving && !close, blocks);
  }

  /**
   * Keeps the frame rate up on slow machines: if frames stay slower than the display's own pace,
   * learnt from the quickest frames lately, the resolution drops a step, and rises again later if
   * there is room. A browser holding the page to 30 is not slow, so that never blurs the plaza.
   */
  let slowFor = 0;
  let fastFor = 0;
  let lastChange = 0;
  const recent: number[] = [];
  function govern(realDt: number) {
    if (realDt > 0.25) return;
    recent.push(realDt);
    if (recent.length > 90) recent.shift();
    if (recent.length < 45) return;
    const pace = clamp([...recent].sort((a, b) => a - b)[Math.floor(recent.length * 0.2)], 1 / 144, 1 / 24);
    if (realDt > pace * 1.4) slowFor += realDt;
    else slowFor = Math.max(0, slowFor - realDt * 0.5);
    if (realDt < pace * 1.12) fastFor += realDt;
    else fastFor = 0;
    const t = performance.now();
    if (t - lastChange < 2500) return;
    let next = ratioLevel;
    if (slowFor > 1.2 && ratioLevel < ratios.length - 1) next++;
    else if (fastFor > 12 && ratioLevel > 0) next--;
    if (next === ratioLevel) return;
    ratioLevel = next;
    slowFor = fastFor = 0;
    lastChange = t;
    renderer.setPixelRatio(ratios[ratioLevel]);
    renderer.setSize(w, h, false);
    floor.resize(renderer);
    sizeBehind();
  }

  /** Moves the world on by `real` seconds, in small steps so nothing is skipped. */
  function advance(real: number) {
    let left = real;
    let v: View;
    do {
      const dt = Math.min(left, 0.05);
      left -= dt;
      v = tick(dt);
    } while (left > 1e-6);
    return v;
  }

  let raf = 0;
  let last = 0;
  let frames = 0;
  /** What the camera looked at in the last frame drawn. */
  const looking = new THREE.Vector3();
  function frame(t: number) {
    raf = 0;
    if (dead || document.hidden) return;
    if (t - lastInput > IDLE && !diving && !press) return;
    raf = requestAnimationFrame(frame);
    if (resized) applyResize();
    // Back from a pause or a hidden tab, it picks up where it was rather than catching up.
    const real = Math.min(0.25, Math.max(0, (t - last) / 1000));
    govern(real);
    last = t;
    // Crowd heads are made a few per frame, so the first frames never stall on them.
    if (!built) built = crowd.build(performance.now() + 5);
    if (!carded) carded = cards ? cards.bake(performance.now() + 3) : true;
    if (!calm) {
      for (let i = 0; i < animatedPlayers.length; i++) {
        const player = animatedPlayers[i];
        const tex = animatedTextures[i];
        if (player && tex && player.step(t)) tex.needsUpdate = true;
      }
    }
    looking.copy(advance(real).target);
    draw(looking);
    if (++frames === 2) onLive();
  }
  function wake() {
    if (raf || dead || document.hidden) return;
    last = performance.now() - 1000 / 60;
    raf = requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => {
    hearVoices(0.15);
    wake();
  });

  // A resize is only noted here and applied at the start of the next frame, which then draws
  // straight away, so the canvas never shows blank while the window is dragged.
  let resized = false;
  new ResizeObserver(() => {
    resized = true;
    wake();
  }).observe(root);
  function applyResize() {
    resized = false;
    const nw = root.clientWidth;
    const nh = root.clientHeight;
    if (!nw || !nh || (nw === w && nh === h)) return;
    const flipped = makeLayout(nw / nh, links.length, wide).tall !== layout.tall;
    w = nw;
    h = nh;
    renderer.setSize(w, h, false);
    floor.resize(renderer);
    sizeBehind();
    arrange();
    restView(now);
    if (flipped) bubbles.clear();
  }

  canvas.addEventListener('webglcontextlost', () => {
    if (dead) return;
    dead = true;
    onLost();
  });

  // Back to this tab through history, a dive that was under way is over.
  addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    diving = false;
    delete root.dataset.leaving;
    wake();
  });

  // Compile every shader before the first frame, so it starts without a hitch.
  applyView(camera, now);
  for (const item of cubes.items) item.mesh.visible = item.ring.visible = true;
  renderer.compile(scene, camera);
  renderer.compile(glass, camera);
  wake();

  function diveToPoint(point: THREE.Vector3, near: number, then: () => void, keep?: Element) {
    if (diving) return;
    copyView(now, diveFrom);
    closeOn(point, zoomView(zoom, zoomed), near, diveTo);
    diveAt = time;
    diving = true;
    root.dataset.leaving = 'true';
    bubbles.dismiss(keep);
    hideCard();
    hearVoices(DIVE * 0.5);
    letLook();
    wake();
    setTimeout(then, calm ? 0 : DIVE * 1000);
  }

  return {
    bubbles,
    setTile(i, art, player) {
      animatedPlayers[i]?.dispose();
      const tex = texture(art);
      animatedPlayers[i] = player ?? null;
      animatedTextures[i] = player ? tex : null;
      renderer.initTexture(tex);
      const turned = !calm && cubes.flip(i, tex, time, (old) => old.dispose());
      if (turned) return wake();
      // Mid turn already, or reduced motion: the picture simply changes.
      const uniform = cubes.items[i].mesh.material.uniforms.uIcon;
      const old = uniform.value as THREE.Texture;
      uniform.value = tex;
      old.dispose();
      wake();
    },
    setEmpty(i, isEmpty) {
      cubes.setEmpty(i, isEmpty);
      wake();
    },
    zoomBy(delta) {
      zoomBy(delta);
    },
    setZoom(level) {
      setZoom(level);
    },
    getZoom() {
      return zoomTo;
    },
    setTheme(nextTheme) {
      themeMode = nextTheme;
      nightTo = wantsNight();
      wake();
    },
    setMuted(nextMuted) {
      muted = Boolean(nextMuted);
      if (!muted) unlockAudio();
      hearVoices(0.15);
    },
    setMiis(nextHero, nextPool) {
      if (press) {
        if (root.hasPointerCapture(press.id)) root.releasePointerCapture(press.id);
        press = null;
        delete root.dataset.holding;
      }
      hovered = -1;
      hideCard();
      delete root.dataset.over;
      spawnCrowd(nextHero, nextPool, true);
      wake();
    },
    peekPortrait(code, leftEye) {
      return portraits.peek(code, leftEye);
    },
    renderPortrait(code, leftEye) {
      return portraits.render(code, leftEye);
    },
    dive(i, then) {
      diveToPoint(blockAt(i), 0.16, then);
    },
    cancelDive() {
      diving = false;
      delete root.dataset.leaving;
      hearVoices(0.25);
      wake();
    },
    destroy() {
      if (dead) return;
      dead = true;
      cancelAnimationFrame(raf);
      raf = 0;
      bubbles.clear();
      voice?.setLevel(0, 0);
      void audioCtx?.close();
      for (const player of animatedPlayers) player?.dispose();
      cards?.dispose();
      crowd.dispose();
      portraits.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
