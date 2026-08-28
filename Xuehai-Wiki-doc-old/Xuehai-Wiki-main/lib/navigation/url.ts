/**
 * URL strategy determining how content paths appear in the address bar.
 *
 * - `path` — readable, SEO-friendly URLs mirroring the content tree
 *   (`/guides/quick-start`)
 * - `hash` — opaque, deterministic hashes that conceal the content structure
 *   (`/a3f2e9d1-4b8c7e6f-9d2a1b3c`)
 */
export type UrlStrategy = 'path' | 'hash';

/** Strategy applied when the payload does not specify one. */
export const DEFAULT_URL_STRATEGY: UrlStrategy = 'path';

/**
 * A precomputed, bidirectional mapping between content paths and URL segments.
 *
 * The map is built once on the server and handed to client components as plain
 * data. Keeping it serialisable is deliberate: it means the browser never needs
 * the hashing implementation, only the results.
 */
export interface UrlMap {
  /** Strategy this map was built with */
  strategy: UrlStrategy;
  /** Content path to URL segment (e.g. 'guides/quick-start' -> 'a3f2e9d1-...') */
  toUrl: Record<string, string>;
  /** URL segment back to content path */
  toPath: Record<string, string>;
}

/** An empty map, used as a safe default before hydration. */
export const EMPTY_URL_MAP: UrlMap = {
  strategy: DEFAULT_URL_STRATEGY,
  toUrl: {},
  toPath: {},
};

/**
 * Strips leading and trailing slashes from a URL fragment.
 *
 * Route params arrive in several shapes depending on `trailingSlash` and on
 * whether the value came from `usePathname` or from a slug array; normalising
 * here keeps every caller from repeating the same trimming.
 *
 * @param value - Raw path or slug fragment
 * @returns The fragment without surrounding slashes
 *
 * @example
 * ```typescript
 * normalizeSlug('/guides/quick-start/'); // 'guides/quick-start'
 * normalizeSlug('guides/quick-start'); // 'guides/quick-start'
 * ```
 */
export function normalizeSlug(value: string): string {
  return value.replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * Resolves a content path to its URL segment.
 *
 * @param map - Precomputed URL mapping
 * @param docPath - Content-relative path without extension
 * @returns The URL segment, or null when the path is not part of the site
 *
 * @example
 * ```typescript
 * docPathToUrl(map, 'guides/quick-start');
 * // 'guides/quick-start' with the path strategy
 * // 'a3f2e9d1-4b8c7e6f-9d2a1b3c' with the hash strategy
 * ```
 */
export function docPathToUrl(map: UrlMap, docPath: string): string | null {
  const normalized = normalizeSlug(docPath);
  return map.toUrl[normalized] ?? null;
}

/**
 * Resolves a URL segment back to its content path.
 *
 * @param map - Precomputed URL mapping
 * @param slug - URL segment, with or without surrounding slashes
 * @returns The content path, or null when the segment matches no document
 */
export function urlToDocPath(map: UrlMap, slug: string): string | null {
  const normalized = normalizeSlug(slug);
  return map.toPath[normalized] ?? null;
}

/**
 * Builds an `href` for a content path, ready to hand to a link or router.
 *
 * Falls back to the root path when the document is unknown, which keeps
 * navigation from emitting `/null` for a stale or mistyped reference.
 *
 * @param map - Precomputed URL mapping
 * @param docPath - Content-relative path without extension
 * @returns A root-relative href
 *
 * @example
 * ```typescript
 * hrefFor(map, 'guides/quick-start'); // '/guides/quick-start'
 * hrefFor(map, 'does-not-exist'); // '/'
 * ```
 */
export function hrefFor(map: UrlMap, docPath: string | undefined): string {
  if (!docPath) return '/';
  const url = docPathToUrl(map, docPath);
  return url ? `/${url}` : '/';
}
