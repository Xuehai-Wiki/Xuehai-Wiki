import { describe, it, expect } from 'vitest';
import { getAliasMap, resolveAlias, aliasUrl, resolveAliasUrl } from './aliases';
import { getContentRegistry } from './registry';

describe('alias parsing', () => {
  // An author moving one page writes one path; requiring a list would be a
  // rule to remember for no gain.
  it('accepts a single alias or a list', () => {
    const { docs } = getContentRegistry();

    for (const doc of docs) {
      expect(Array.isArray(doc.aliases)).toBe(true);
    }
  });

  it('leaves documents without aliases empty', () => {
    const { byPath } = getContentRegistry();

    expect(byPath.get('intro')?.aliases).toEqual([]);
  });
});

describe('getAliasMap', () => {
  it('maps a former path to the document that superseded it', () => {
    const map = getAliasMap();

    for (const [alias, target] of map) {
      expect(alias).not.toBe(target);
      expect(getContentRegistry().byPath.has(target)).toBe(true);
    }
  });

  // An alias shadowing a live page would make that page unreachable, so it is
  // a build error rather than something resolved by precedence.
  it('never claims a path a page occupies', () => {
    const { byPath } = getContentRegistry();

    for (const alias of getAliasMap().keys()) {
      expect(byPath.has(alias)).toBe(false);
    }
  });
});

describe('aliasUrl', () => {
  it('is the path itself under the path strategy', () => {
    expect(aliasUrl('guides/setup', 'path')).toBe('guides/setup');
  });

  // The old URL under `hash` was the digest of the old path, so reproducing it
  // is what makes the address a reader still has keep working.
  it('is the digest of the path under the hash strategy', () => {
    const url = aliasUrl('guides/setup', 'hash');

    expect(url).toMatch(/^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}$/);
    expect(aliasUrl('guides/setup', 'hash')).toBe(url);
    expect(aliasUrl('guides/other', 'hash')).not.toBe(url);
  });

  it('tolerates surrounding slashes', () => {
    expect(aliasUrl('/guides/setup/', 'path')).toBe('guides/setup');
  });
});

describe('resolveAliasUrl', () => {
  it('resolves a former URL back to the current document under both strategies', () => {
    for (const [alias, target] of getAliasMap()) {
      expect(resolveAliasUrl(aliasUrl(alias, 'path'), 'path')).toBe(target);
      expect(resolveAliasUrl(aliasUrl(alias, 'hash'), 'hash')).toBe(target);
    }
  });

  it('resolves nothing for an address no page ever had', () => {
    expect(resolveAliasUrl('never/existed', 'path')).toBeNull();
    expect(resolveAlias('never/existed')).toBeNull();
  });
});
