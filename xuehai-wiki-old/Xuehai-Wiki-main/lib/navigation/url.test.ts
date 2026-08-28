import { describe, it, expect } from 'vitest';
import { docPathToUrl, hrefFor, normalizeSlug, urlToDocPath, type UrlMap } from './url';
import { buildUrlMap } from './urlMap';

const PATHS = ['intro', 'guides/quick-start', 'guides/nested/deep'];

describe('normalizeSlug', () => {
  it('strips leading and trailing slashes', () => {
    expect(normalizeSlug('/guides/quick-start/')).toBe('guides/quick-start');
    expect(normalizeSlug('guides/quick-start')).toBe('guides/quick-start');
    expect(normalizeSlug('/')).toBe('');
  });
});

describe('buildUrlMap', () => {
  it('maps a path to itself under the path strategy', () => {
    const map = buildUrlMap(PATHS, 'path');

    expect(map.toUrl['guides/quick-start']).toBe('guides/quick-start');
    expect(map.toPath['guides/quick-start']).toBe('guides/quick-start');
  });

  it('maps a path to a deterministic hash under the hash strategy', () => {
    const first = buildUrlMap(PATHS, 'hash');
    const second = buildUrlMap(PATHS, 'hash');

    expect(first.toUrl['intro']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}$/);
    expect(first.toUrl['intro']).toBe(second.toUrl['intro']);
  });

  it('round-trips every path through the map under both strategies', () => {
    for (const strategy of ['path', 'hash'] as const) {
      const map = buildUrlMap(PATHS, strategy);

      for (const path of PATHS) {
        const url = docPathToUrl(map, path);
        expect(url).not.toBeNull();
        expect(urlToDocPath(map, url!)).toBe(path);
      }
    }
  });

  it('ignores empty paths rather than mapping them to the root', () => {
    const map = buildUrlMap(['', '/', 'intro'], 'path');

    expect(map.toPath['']).toBeUndefined();
    expect(Object.keys(map.toUrl)).toEqual(['intro']);
  });

  it('normalises surrounding slashes before mapping', () => {
    const map = buildUrlMap(['/intro/'], 'path');

    expect(map.toUrl['intro']).toBe('intro');
  });
});

describe('docPathToUrl / urlToDocPath', () => {
  const map = buildUrlMap(PATHS, 'path');

  it('tolerates surrounding slashes on lookup', () => {
    expect(docPathToUrl(map, '/intro/')).toBe('intro');
    expect(urlToDocPath(map, '/guides/quick-start/')).toBe('guides/quick-start');
  });

  it('returns null for unknown paths', () => {
    expect(docPathToUrl(map, 'nope')).toBeNull();
    expect(urlToDocPath(map, 'nope')).toBeNull();
  });
});

describe('hrefFor', () => {
  const map = buildUrlMap(PATHS, 'path');

  it('builds a root-relative href', () => {
    expect(hrefFor(map, 'guides/quick-start')).toBe('/guides/quick-start');
  });

  it('falls back to the root for unknown or missing paths', () => {
    expect(hrefFor(map, undefined)).toBe('/');
    expect(hrefFor(map, '')).toBe('/');
    expect(hrefFor(map, 'nope')).toBe('/');
  });

  it('never emits a literal null segment', () => {
    const empty: UrlMap = { strategy: 'path', toUrl: {}, toPath: {} };
    expect(hrefFor(empty, 'anything')).toBe('/');
  });
});
