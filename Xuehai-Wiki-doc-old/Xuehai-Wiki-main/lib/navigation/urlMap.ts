import { getAllDocPaths } from '../content/registry';
import { payload } from '@/payload/config';
import { generatePathHash } from './hash';
import { DEFAULT_URL_STRATEGY, normalizeSlug, type UrlMap, type UrlStrategy } from './url';
import { cached } from '../cache';

/**
 * Server-side construction of the {@link UrlMap}.
 *
 * This module reaches into the filesystem and into Node's crypto, so it must
 * only be imported from server components, route handlers, and build scripts.
 * Client components receive the finished map through `UrlMapProvider` instead.
 */

/**
 * Returns the URL strategy declared by the payload, or the default.
 */
export function getUrlStrategy(): UrlStrategy {
  return payload.global.urlStrategy ?? DEFAULT_URL_STRATEGY;
}

/**
 * Builds a bidirectional URL mapping for the given content paths.
 *
 * Under the `hash` strategy a collision would make two documents unreachable
 * through one another's URL, so collisions are surfaced as a build error rather
 * than silently resolving to whichever document happened to be scanned last.
 *
 * @param docPaths - Content-relative paths to include
 * @param strategy - URL strategy to apply
 * @returns The populated mapping
 * @throws Error if two distinct paths produce the same URL segment
 *
 * @example
 * ```typescript
 * const map = buildUrlMap(['intro', 'guides/quick-start'], 'path');
 * map.toUrl['guides/quick-start']; // 'guides/quick-start'
 * map.toPath['intro']; // 'intro'
 * ```
 */
export function buildUrlMap(docPaths: string[], strategy: UrlStrategy): UrlMap {
  const toUrl: Record<string, string> = {};
  const toPath: Record<string, string> = {};

  for (const rawPath of docPaths) {
    const docPath = normalizeSlug(rawPath);
    if (!docPath) continue;

    const url = strategy === 'hash' ? generatePathHash(docPath) : docPath;
    const existing = toPath[url];

    if (existing !== undefined && existing !== docPath) {
      throw new Error(
        `URL collision under the '${strategy}' strategy: ` +
          `'${existing}' and '${docPath}' both map to '${url}'.`,
      );
    }

    toUrl[docPath] = url;
    toPath[url] = docPath;
  }

  return { strategy, toUrl, toPath };
}

let memo: UrlMap | null = null;

/**
 * Returns the URL map for the whole content tree, memoised per process.
 *
 * Every document is included, not only those reachable from the sidebar, so
 * hidden pages and documents omitted from navigation still resolve.
 *
 * @returns The site-wide URL mapping
 */
export function getUrlMap(): UrlMap {
  const hit = cached(memo);
  if (hit) return hit;
  memo = buildUrlMap(getAllDocPaths(), getUrlStrategy());
  return memo;
}
