import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * TASK-0051. Two layout promises that no behaviour test would notice breaking, checked in source.
 */
const here = resolve(__dirname, '../..');
// Comments removed, or one sitting above a rule would be read as part of its selector.
const css = readFileSync(resolve(here, 'src/app/globals.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);
const modal = readFileSync(resolve(here, 'src/components/TattooPreviewModal.tsx'), 'utf8');

describe('the brand stays in view', () => {
  it('no rule gives the studio header a position other than sticky', () => {
    // A later `position: relative` on a shared selector list once overrode the sticky header, so
    // the brand scrolled away with the page and nothing failed.
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const onHeader = rules.filter(([, selectors]) =>
      selectors!.split(',').some((selector) => selector.trim() === '.studio-header'),
    );
    const positions = onHeader.flatMap(([, , body]) =>
      [...body!.matchAll(/position:\s*([a-z-]+)/g)].map((match) => match[1]),
    );
    expect(positions).toEqual(['sticky']);
  });
});

describe('a finished design opens on its pictures', () => {
  it('the images come before the downloads, and both before the change form', () => {
    const images = modal.indexOf('className="result-grid"');
    const downloads = modal.indexOf('className="download-row"');
    const changes = modal.indexOf('className="proposal-edit');
    expect(images).toBeGreaterThan(0);
    expect(images).toBeLessThan(downloads);
    expect(downloads).toBeLessThan(changes);
  });
});

describe('the camera try-on has a way back (TASK-0053)', () => {
  it('offers a link to the studio in a bar that stays in view', () => {
    // Installed as an app there is no browser back button: without this the page is a dead end.
    const tryOn = readFileSync(resolve(here, 'src/app/probar/page.tsx'), 'utf8');
    expect(tryOn).toMatch(/className="try-on-back"\s+href="\/"/);
    const bar = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(
      ([, selectors]) => selectors!.trim() === '.try-on-bar',
    );
    expect(bar?.[2]).toMatch(/position:\s*sticky/);
  });
});

describe('the sign-in card centres the brand (TASK-0062)', () => {
  const rule = (selector: string): string =>
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, s]) => s!.trim() === selector)?.[2] ?? '';

  it('centres the name and the Aurevanta Labs line', () => {
    expect(rule('.brand-card')).toMatch(/align-items:\s*center/);
    expect(rule('.brand-card')).toMatch(/text-align:\s*center/);
    expect(rule('.brand-card .brand-by')).toMatch(/justify-content:\s*center/);
    // The trailing tracking is balanced, or the word sits a letter-space left of centre.
    expect(rule('.brand-card .brand-name')).toMatch(/padding-left:\s*0\.2em/);
  });
});

describe('the guided studio leaves the header usable (TASK-0066)', () => {
  const zIndex = (selector: string): number =>
    Number(
      [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, s]) => s!.trim() === selector)
        .flatMap(([, , body]) => [...body!.matchAll(/z-index:\s*(\d+)/g)].map((m) => m[1]))
        .at(-1),
    );

  it('opens every wizard pop-up below the header, not as a modal over it', () => {
    // A modal dialog makes the rest of the page inert: «Salir» was visible but could not be pressed.
    const dir = resolve(here, 'src/components/wizard');
    for (const file of ['IdeaStep', 'DetailsStep', 'ReferencesStep', 'SummaryStep', 'DoneStep']) {
      const source = readFileSync(resolve(dir, `${file}.tsx`), 'utf8');
      const dialogs = source.match(/<Confirm\b/g)?.length ?? 0;
      expect(dialogs, file).toBeGreaterThan(0);
      expect(source.match(/<Confirm\s+belowHeader/g)?.length ?? 0, file).toBe(dialogs);
    }
  });

  it('stacks the header above the pop-up, and the pop-up above its backdrop', () => {
    expect(zIndex('.studio-header')).toBeGreaterThan(zIndex('.studio-dialog.confirm-below-header'));
    expect(zIndex('.studio-dialog.confirm-below-header')).toBeGreaterThan(
      zIndex('.confirm-backdrop'),
    );
  });
});

describe('the studio always opens guided (TASK-0091)', () => {
  it('starts in guided mode and remembers no other choice', () => {
    // The advanced choice was kept for the tab, so signing out and in again reopened advanced.
    const page = readFileSync(resolve(here, 'src/app/page.tsx'), 'utf8');
    expect(page).toMatch(/useState<Mode>\('guided'\)/);
    expect(page).not.toMatch(/sessionStorage|localStorage/);
  });
});
