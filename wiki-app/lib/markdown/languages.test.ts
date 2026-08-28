import { describe, it, expect } from 'vitest';
import { bundledLanguages } from 'shiki';
import { clearLanguageCache, findFenceLanguages, getUsedLanguages } from './languages';

describe('findFenceLanguages', () => {
  it('finds the language on a fence', () => {
    expect(findFenceLanguages('```typescript\nconst x = 1;\n```')).toEqual(['typescript']);
  });

  it('lower-cases identifiers', () => {
    expect(findFenceLanguages('```TypeScript\nx\n```')).toEqual(['typescript']);
  });

  it('deduplicates', () => {
    expect(findFenceLanguages('```js\na\n```\n\n```js\nb\n```')).toEqual(['js']);
  });

  it('finds several languages', () => {
    expect(findFenceLanguages('```ts\na\n```\n\n```python\nb\n```').sort()).toEqual([
      'python',
      'ts',
    ]);
  });

  it('handles tilde fences', () => {
    expect(findFenceLanguages('~~~rust\nx\n~~~')).toEqual(['rust']);
  });

  it('ignores fences with no language', () => {
    expect(findFenceLanguages('```\nplain\n```')).toEqual([]);
  });

  it('accepts identifiers with punctuation', () => {
    expect(findFenceLanguages('```c++\nx\n```')).toEqual(['c++']);
    expect(findFenceLanguages('```objective-c\nx\n```')).toEqual(['objective-c']);
  });

  it('returns nothing for text with no fences', () => {
    expect(findFenceLanguages('just prose')).toEqual([]);
  });
});

describe('getUsedLanguages', () => {
  it('returns only grammars Shiki actually bundles', () => {
    const known = new Set(Object.keys(bundledLanguages));

    for (const language of getUsedLanguages()) {
      expect(known.has(language), language).toBe(true);
    }
  });

  it('loads far fewer than the full bundle', () => {
    // The whole point is to avoid loading every grammar; if this ever
    // approaches the bundle size, first-render cost has regressed badly.
    expect(getUsedLanguages().length).toBeLessThan(Object.keys(bundledLanguages).length / 4);
  });

  it('always includes the base languages', () => {
    const languages = getUsedLanguages();

    for (const base of ['typescript', 'bash', 'json', 'markdown']) {
      expect(languages, base).toContain(base);
    }
  });

  it('includes languages the content uses', () => {
    // content/features/syntax-highlighting.md demonstrates several languages.
    expect(getUsedLanguages().length).toBeGreaterThan(10);
  });

  it('is sorted and free of duplicates', () => {
    const languages = getUsedLanguages();

    expect(languages).toEqual([...languages].sort());
    expect(new Set(languages).size).toBe(languages.length);
  });

  it('memoises until cleared', () => {
    const first = getUsedLanguages();
    expect(getUsedLanguages()).toBe(first);

    clearLanguageCache();
    expect(getUsedLanguages()).not.toBe(first);
  });
});
