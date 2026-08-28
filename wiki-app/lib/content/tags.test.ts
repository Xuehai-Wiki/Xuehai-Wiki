import { describe, it, expect } from 'vitest';
import { getTags, getTag, getTagsFor, findTagRouteCollisions } from './tags';
import { getContentRegistry } from './registry';
import { getSite } from '../site';

describe('getTags', () => {
  it('gathers pages by subject across the folder tree', () => {
    for (const tag of getTags()) {
      expect(tag.pages.length).toBeGreaterThan(0);
      expect(tag.slug).toBe(tag.name.toLowerCase());
    }
  });

  it('sorts subjects by name', () => {
    const names = getTags().map((tag) => tag.name);

    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  // A page kept off the sidebar on purpose should not reappear here, or the
  // tag index becomes a way of enumerating exactly what was unlisted.
  it('leaves hidden pages out', () => {
    const { hiddenPaths } = getSite();
    const listed = getTags().flatMap((tag) => tag.pages.map((page) => page.path));

    for (const hidden of hiddenPaths) {
      expect(listed).not.toContain(hidden);
    }
  });

  it('emits URLs in the form the export serves', () => {
    for (const tag of getTags()) {
      for (const page of tag.pages) {
        expect(page.url).toMatch(/^\/.*\/$/);
      }
    }
  });

  it('lists a page under each of its tags', () => {
    const { docs } = getContentRegistry();
    const { hiddenPaths } = getSite();

    for (const doc of docs) {
      if (hiddenPaths.has(doc.path) || doc.tags.length === 0) continue;

      for (const name of doc.tags) {
        const tag = getTag(name.toLowerCase());
        expect(tag?.pages.some((page) => page.path === doc.path)).toBe(true);
      }
    }
  });
});

describe('getTag', () => {
  it('finds a subject however its name is cased', () => {
    const [first] = getTags();
    if (!first) return;

    expect(getTag(first.slug)?.slug).toBe(first.slug);
    expect(getTag(first.slug.toUpperCase())?.slug).toBe(first.slug);
  });

  it('finds nothing for a subject no page carries', () => {
    expect(getTag('no-such-subject')).toBeNull();
  });
});

describe('getTagsFor', () => {
  it('returns the tags a page carries', () => {
    const { docs } = getContentRegistry();
    const { hiddenPaths } = getSite();
    const tagged = docs.find((doc) => doc.tags.length > 0 && !hiddenPaths.has(doc.path));
    if (!tagged) return;

    expect(
      getTagsFor(tagged.path)
        .map((tag) => tag.slug)
        .sort(),
    ).toEqual(tagged.tags.map((tag) => tag.toLowerCase()).sort());
  });

  it('returns nothing for an untagged page', () => {
    expect(getTagsFor('no/such/page')).toEqual([]);
  });
});

// `/tags/…` is a route of its own and Next resolves it before the catch-all,
// so a page published there would be unreachable.
describe('findTagRouteCollisions', () => {
  it('reports no collision in this wiki', () => {
    expect(findTagRouteCollisions()).toEqual([]);
  });
});
