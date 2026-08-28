import { describe, it, expect } from 'vitest';
import { getAdjacentPages } from './sequence';
import { getSite } from '../site';
import { extractAllPaths, filterHiddenItems } from './builder';

/** The reading order, as the sidebar presents it. */
function order(): string[] {
  return extractAllPaths(filterHiddenItems(getSite().navigation));
}

describe('getAdjacentPages', () => {
  // Written against however many pages there are: a scaffolded project starts
  // with two, and indexing past them would fail there rather than here.
  it('follows the order the sidebar shows', () => {
    const sequence = order();

    for (let i = 0; i < sequence.length; i++) {
      const { previous, next } = getAdjacentPages(sequence[i]);

      if (i > 0) expect(previous?.url).toContain(sequence[i - 1]);
      if (i < sequence.length - 1) expect(next?.url).toContain(sequence[i + 1]);
    }
  });

  it('gives the first page no predecessor', () => {
    expect(getAdjacentPages(order()[0]).previous).toBeNull();
  });

  it('gives the last page no successor', () => {
    const sequence = order();

    expect(getAdjacentPages(sequence[sequence.length - 1]).next).toBeNull();
  });

  it('titles each neighbour', () => {
    const sequence = order();
    // Skipped rather than failed on a one-page wiki, which has no neighbours
    // to title.
    if (sequence.length < 2) return;

    const { next } = getAdjacentPages(sequence[0]);

    expect(next?.title).toBeTruthy();
    expect(next?.title).not.toBe(next?.url);
  });

  // Stepping through a guide should not land on a page deliberately kept out
  // of the sidebar.
  it('leaves hidden pages out of the sequence', () => {
    const { hiddenPaths } = getSite();
    const sequence = order();

    for (const hidden of hiddenPaths) {
      expect(sequence).not.toContain(hidden);
    }
  });

  it('offers nothing for a page outside the sequence', () => {
    expect(getAdjacentPages('no/such/page')).toEqual({ previous: null, next: null });
  });

  // Every URL it produces is the trailing-slash form the export serves, or the
  // links here would redirect like the ones fixed elsewhere.
  it('emits URLs in the form the export serves', () => {
    for (const path of order()) {
      const { previous, next } = getAdjacentPages(path);

      for (const page of [previous, next]) {
        if (page) expect(page.url).toMatch(/^\/.*\/$/);
      }
    }
  });
});
