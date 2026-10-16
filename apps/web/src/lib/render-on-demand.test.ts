import { describe, expect, it } from 'vitest';

import { onDemand, type FrameClock } from './render-on-demand';

/** A frame clock that runs frames only when told to. */
function manualClock(): FrameClock & { step(): void; waiting(): number } {
  let next = 1;
  const queue = new Map<number, () => void>();
  return {
    request(callback) {
      queue.set(next, callback);
      return next++;
    },
    cancel(handle) {
      queue.delete(handle);
    },
    step() {
      const due = [...queue.values()];
      queue.clear();
      due.forEach((callback) => callback());
    },
    waiting: () => queue.size,
  };
}

describe('3D views draw only when something changes and can be seen (TASK-0128)', () => {
  it('draws nothing while nothing changes', () => {
    const clock = manualClock();
    const view = onDemand(() => false, clock);
    for (let i = 0; i < 60; i++) clock.step();
    expect(view.frames).toBe(0);
    view.invalidate();
    view.invalidate(); // two changes before the next frame draw once
    clock.step();
    clock.step();
    expect(view.frames).toBe(1);
    expect(clock.waiting()).toBe(0);
  });

  it('keeps drawing while the picture settles, then stops', () => {
    const clock = manualClock();
    let settling = 3;
    const view = onDemand(() => settling-- > 0, clock);
    view.invalidate();
    for (let i = 0; i < 10; i++) clock.step();
    expect(view.frames).toBe(4);
    expect(clock.waiting()).toBe(0);
  });

  it('draws nothing off screen or in a hidden page, and once when seen again', () => {
    const clock = manualClock();
    const view = onDemand(() => true, clock); // a picture that would move for ever
    view.invalidate();
    clock.step();
    view.setVisible(false);
    for (let i = 0; i < 10; i++) clock.step();
    expect(view.frames).toBe(1);
    view.invalidate(); // a change while hidden waits
    clock.step();
    expect(view.frames).toBe(1);
    view.setVisible(true);
    clock.step();
    expect(view.frames).toBe(2);
    view.dispose();
    for (let i = 0; i < 10; i++) clock.step();
    expect(view.frames).toBe(2);
  });
});
