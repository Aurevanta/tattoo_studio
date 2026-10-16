/**
 * Draw a 3D view only when something changed and someone can see it (TASK-0128, audit item 6).
 *
 * The 3D views used to draw sixty frames a second for as long as they were open, still or not,
 * on screen or scrolled away, in a background tab or not. That spends battery and GPU on an
 * image that does not change. A view now asks for a frame when it changes (`invalidate`): the
 * camera moved, the design was placed, the size changed. A frame keeps the next one coming only
 * while `draw` says the picture is still moving (the orbit's damping settling). Nothing is drawn
 * while the view is off screen or the page is hidden; becoming visible again draws once.
 */
export interface FrameClock {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

export interface OnDemand {
  /** Something changed: draw a frame soon, if the view can be seen. */
  invalidate(): void;
  /** Whether the view is on screen and its page visible. A newly visible view draws once. */
  setVisible(visible: boolean): void;
  /** Frames drawn so far, for tests and diagnostics. */
  readonly frames: number;
  dispose(): void;
}

/**
 * @param draw renders one frame and returns whether the picture is still moving, in which case
 *   another frame follows (OrbitControls' `update()` returns true while damping).
 */
export function onDemand(draw: () => boolean, clock: FrameClock): OnDemand {
  let pending: number | null = null;
  let visible = true;
  let disposed = false;
  let frames = 0;
  const tick = () => {
    pending = null;
    if (disposed || !visible) return;
    frames += 1;
    if (draw()) schedule();
  };
  const schedule = () => {
    if (pending === null && visible && !disposed) pending = clock.request(tick);
  };
  return {
    invalidate: schedule,
    setVisible(next) {
      if (next === visible) return;
      visible = next;
      if (!visible && pending !== null) {
        clock.cancel(pending);
        pending = null;
      }
      if (visible) schedule();
    },
    get frames() {
      return frames;
    },
    dispose() {
      disposed = true;
      if (pending !== null) clock.cancel(pending);
      pending = null;
    },
  };
}

/**
 * Wire a view's visibility: on screen (an IntersectionObserver on its container) and its page not
 * hidden. Returns the function that stops watching.
 */
export function watchVisibility(container: HTMLElement, view: OnDemand): () => void {
  let onScreen = true;
  const update = () => view.setVisible(onScreen && document.visibilityState !== 'hidden');
  const observer =
    typeof IntersectionObserver === 'undefined'
      ? undefined
      : new IntersectionObserver((entries) => {
          onScreen = entries.some((entry) => entry.isIntersecting);
          update();
        });
  observer?.observe(container);
  document.addEventListener('visibilitychange', update);
  return () => {
    observer?.disconnect();
    document.removeEventListener('visibilitychange', update);
  };
}

/** The browser's frame clock. */
export const animationFrames: FrameClock = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};
