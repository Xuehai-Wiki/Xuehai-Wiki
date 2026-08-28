/**
 * Whether derived data may be memoised for the lifetime of the process.
 *
 * Everything the site renders is derived from files under `content/`. During a
 * build those files never change, so scanning and rendering them once and
 * reusing the result is pure win. During `next dev` they change constantly —
 * that is the entire point — and a process-lifetime cache would serve stale
 * pages until the server was restarted.
 *
 * Test runs keep caching on: content is fixed there too, and the memoisation
 * behaviour is itself something the tests assert.
 */
export const CACHE_DERIVED_CONTENT = process.env.NODE_ENV !== 'development';

/**
 * Returns the cached value when caching is enabled, otherwise nothing.
 *
 * Reads as a guard at the top of a memoised getter:
 *
 * @example
 * ```typescript
 * export function getThing(): Thing {
 *   const hit = cached(memo);
 *   if (hit) return hit;
 *
 *   memo = buildThing();
 *   return memo;
 * }
 * ```
 *
 * @param value - The memoised value, or null when nothing is stored yet
 * @returns The value in production and test, null in development
 */
export function cached<T>(value: T | null): T | null {
  return CACHE_DERIVED_CONTENT ? value : null;
}
