import type { eventWithTime } from '@rrweb/types';

export const CANVAS_FRAME_TAG = 'datainsights.canvas-frame.v1';
const INTERVAL = 200; // 5fps; static frames are deduplicated.
const MAX_PIXELS = 2_000_000, MAX_CANVASES = 8, MAX_URL = 350_000;
type Frame = { id: number; width: number; height: number; context: string; dataURL: string };
type Mirror = { getId(node: Node): number };
type Entry = { frame: Frame; at: number };

/** Bitmap-only extension. Never changes context attributes or clears host WebGL buffers. */
export function captureCanvases(mirror: Mirror | undefined, emit: (e: eventWithTime) => void, blocked: string) {
  const empty = { snapshot: (_e: eventWithTime) => {}, stop: () => {} };
  if (!mirror || typeof window === 'undefined' || typeof HTMLCanvasElement === 'undefined') return empty;
  let stopped = false, timer = 0, pending = false;
  const entries = new Map<HTMLCanvasElement, Entry>();
  const glCanvases = new WeakSet<HTMLCanvasElement>();
  const glPending = new Set<HTMLCanvasElement>();
  const restores: (() => void)[] = [];
  const allowed = (canvas: HTMLCanvasElement) => {
    try { return canvas.isConnected && !canvas.closest(blocked) && canvas.width > 0 && canvas.height > 0 && canvas.width * canvas.height <= MAX_PIXELS && (entries.has(canvas) || entries.size < MAX_CANVASES); }
    catch { return false; }
  };
  function capture(canvas: HTMLCanvasElement, context: string, force = false, publish = true) {
    if (stopped || !allowed(canvas)) return;
    const now = Date.now(), previous = entries.get(canvas);
    if (!force && previous && now - previous.at < INTERVAL) return;
    const id = mirror!.getId(canvas); if (id < 0) return;
    try {
      const dataURL = canvas.toDataURL('image/webp', 0.85);
      if (dataURL.length > MAX_URL || !/^data:image\/(webp|png);base64,/.test(dataURL)) return;
      const frame = { id, width: canvas.width, height: canvas.height, context, dataURL };
      entries.set(canvas, { frame, at: now });
      if (publish && (!previous || previous.frame.dataURL !== dataURL || previous.frame.id !== id)) emit({ type: 5, timestamp: now, data: { tag: CANVAS_FRAME_TAG, payload: frame } });
    } catch { /* Origin-tainted/context-lost canvases cannot be read; never break the host. */ }
  }
  // WebGL drawing buffers may disappear before a timer runs. Read immediately
  // after the host's drawing turn, never alter preserveDrawingBuffer or clear().
  const scheduleGl = (canvas: HTMLCanvasElement) => {
    if (stopped || !(canvas instanceof HTMLCanvasElement) || !allowed(canvas)) return;
    glCanvases.add(canvas);glPending.add(canvas);
    if (pending) return; pending = true;
    queueMicrotask(() => {
      pending = false;
      for (const c of glPending) capture(c, 'webgl');
      glPending.clear();
    });
  };
  for (const proto of [window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype]) {
    if (!proto) continue;
    for (const name of ['clear', 'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'blitFramebuffer']) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      if (!descriptor || typeof descriptor.value !== 'function') continue;
      const original = descriptor.value;
      const wrapper = function(this: WebGLRenderingContext, ...args: unknown[]) {
        const result = Reflect.apply(original, this, args);
        try { scheduleGl(this.canvas as HTMLCanvasElement); } catch { /* host isolation */ }
        return result;
      };
      try {
        Object.defineProperty(proto, name, { ...descriptor, value: wrapper });
        restores.push(() => { if (Object.getOwnPropertyDescriptor(proto, name)?.value === wrapper) Object.defineProperty(proto, name, descriptor); });
      } catch { /* Some embedded browsers lock context prototypes. */ }
    }
  }
  const scan = (publish = true) => {
    for (const canvas of entries.keys()) if (!allowed(canvas)) entries.delete(canvas);
    for (const canvas of Array.from(document.querySelectorAll('canvas'))) {
      if (!allowed(canvas) || glCanvases.has(canvas)) continue;
      // getContext('2d') returns null for an existing WebGL context; it does not replace it.
      // Do not create a context on uninitialized canvases: just read their current pixels.
      capture(canvas, '2d', !publish, publish);
    }
  };
  timer = window.setInterval(() => scan(), INTERVAL);
  return {
    snapshot(event: eventWithTime) {
      if (event.type !== 2 || stopped) return;
      scan(false);
      const frames: Frame[] = [];
      for (const [canvas, entry] of entries) if (allowed(canvas)) {
        const id = mirror!.getId(canvas); if (id >= 0) frames.push({ ...entry.frame, id });
      }
      Object.assign(event.data, { datainsightsCanvasFrames: frames });
    },
    stop() { stopped = true; clearInterval(timer); glPending.clear(); entries.clear(); for (const restore of restores.reverse()) restore(); },
  };
}
