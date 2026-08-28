import { bundledLanguages, type BuiltinLanguage } from 'shiki';
import { getContentRegistry } from '../content/registry';
import { cached } from '../cache';

/**
 * Works out which syntax-highlighting grammars the site actually needs.
 *
 * Shiki loads every bundled grammar by default — around two hundred of them —
 * which dominates the cost of the first render and, therefore, of the whole
 * build. Almost none of them are ever used: a documentation site typically
 * touches a handful of languages. Scanning the content for the fences that
 * exist and loading only those cuts initialisation from tens of seconds to
 * well under one.
 *
 * Server-only.
 */

/**
 * Languages always loaded, whether or not the content currently uses them.
 *
 * These cover the fences most likely to be added next, so a new code block in
 * a common language does not silently render unhighlighted until someone
 * notices.
 */
const BASE_LANGUAGES = [
  'bash',
  'css',
  'diff',
  'html',
  'javascript',
  'json',
  'jsx',
  'markdown',
  'python',
  'shell',
  'sql',
  'tsx',
  'typescript',
  'yaml',
] as const;

/** Matches the language written on an opening code fence. */
const FENCE_PATTERN = /^ {0,3}(?:`{3,}|~{3,})[ \t]*([A-Za-z0-9_+#-]+)/gm;

/**
 * Extracts the language identifiers used by fenced code blocks in a string.
 *
 * @param markdown - Markdown source
 * @returns Lower-cased identifiers, deduplicated
 *
 * @example
 * ```typescript
 * findFenceLanguages('```ts\nx\n```\n```python\ny\n```');
 * // ['ts', 'python']
 * ```
 */
export function findFenceLanguages(markdown: string): string[] {
  const found = new Set<string>();

  for (const match of markdown.matchAll(FENCE_PATTERN)) {
    found.add(match[1].toLowerCase());
  }

  return [...found];
}

let memo: BuiltinLanguage[] | null = null;

/**
 * Returns the grammars to load for this site.
 *
 * Identifiers that Shiki does not recognise are dropped rather than passed
 * through: an unknown name makes the highlighter throw at construction, which
 * would turn one typo in one fence into a failed build. Unrecognised fences
 * fall back to plain text at render time instead.
 *
 * @returns Bundled language names, sorted
 */
export function getUsedLanguages(): BuiltinLanguage[] {
  const hit = cached(memo);
  if (hit) return hit;

  const known = new Set(Object.keys(bundledLanguages));
  const wanted = new Set<string>(BASE_LANGUAGES);

  for (const doc of getContentRegistry().docs) {
    for (const language of findFenceLanguages(doc.content)) {
      wanted.add(language);
    }
  }

  // The filter is what makes the assertion sound: only names present in the
  // bundle survive, and those are exactly the BuiltinLanguage values.
  memo = [...wanted].filter((language) => known.has(language)).sort() as BuiltinLanguage[];
  return memo;
}

/**
 * Discards the memoised language list. Intended for tests.
 */
export function clearLanguageCache(): void {
  memo = null;
}
