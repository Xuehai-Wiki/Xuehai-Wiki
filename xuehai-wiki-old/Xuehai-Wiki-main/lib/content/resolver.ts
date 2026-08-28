import { getContentRegistry, type ContentDoc } from './registry';
import { cached } from '../cache';

/**
 * Resolves the loose targets people write in wiki links to actual documents.
 *
 * Obsidian-style linking lets an author write `[[quick-start]]` without knowing
 * where the file sits in the tree. That convenience only holds if the shorthand
 * resolves predictably, so lookups run in a fixed order and ambiguous shorthand
 * is refused rather than guessed at.
 */

/** How a target was matched, for diagnostics. */
export type ResolutionKind = 'path' | 'basename' | 'title' | 'ambiguous' | 'missing';

/** Outcome of resolving a link target. */
export interface Resolution {
  /** The matched document, if exactly one was found */
  doc?: ContentDoc;
  /** How the match was made, or why it failed */
  kind: ResolutionKind;
  /** Candidate paths, when the target was ambiguous */
  candidates?: string[];
}

interface ResolverIndex {
  byPath: Map<string, ContentDoc>;
  byBasename: Map<string, ContentDoc[]>;
  byTitle: Map<string, ContentDoc[]>;
}

let memo: ResolverIndex | null = null;

/**
 * Normalises a target for comparison: trimmed, lower-cased, extension removed.
 */
function normalize(target: string): string {
  return target.trim().replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.md$/i, '').toLowerCase();
}

/**
 * Builds the lookup tables, memoised per process.
 */
function getIndex(): ResolverIndex {
  const hit = cached(memo);
  if (hit) return hit;

  const byPath = new Map<string, ContentDoc>();
  const byBasename = new Map<string, ContentDoc[]>();
  const byTitle = new Map<string, ContentDoc[]>();

  const push = (map: Map<string, ContentDoc[]>, key: string, doc: ContentDoc) => {
    const existing = map.get(key);
    if (existing) existing.push(doc);
    else map.set(key, [doc]);
  };

  for (const doc of getContentRegistry().docs) {
    byPath.set(normalize(doc.path), doc);
    push(byBasename, normalize(doc.segments[doc.segments.length - 1]), doc);
    push(byTitle, normalize(doc.title), doc);
  }

  memo = { byPath, byBasename, byTitle };
  return memo;
}

/**
 * Resolves a wiki-link target to a document.
 *
 * Order is full path, then file name, then page title. A shorthand matching
 * several documents resolves to none of them: silently picking the first would
 * make the link's destination depend on directory scan order, which is exactly
 * the kind of bug nobody finds until the wrong page ships.
 *
 * @param target - Raw target text from inside the brackets
 * @returns The resolution, including why it failed when it did
 *
 * @example
 * ```typescript
 * resolveTarget('getting-started/quick-start').kind; // 'path'
 * resolveTarget('quick-start').kind; // 'basename'
 * resolveTarget('Quick Start').kind; // 'title'
 * resolveTarget('nope').kind; // 'missing'
 * ```
 */
export function resolveTarget(target: string): Resolution {
  const key = normalize(target);
  if (!key) return { kind: 'missing' };

  const { byPath, byBasename, byTitle } = getIndex();

  const exact = byPath.get(key);
  if (exact) return { doc: exact, kind: 'path' };

  for (const [map, kind] of [
    [byBasename, 'basename'],
    [byTitle, 'title'],
  ] as const) {
    const matches = map.get(key);
    if (!matches || matches.length === 0) continue;

    if (matches.length === 1) return { doc: matches[0], kind };

    return { kind: 'ambiguous', candidates: matches.map((doc) => doc.path) };
  }

  return { kind: 'missing' };
}
