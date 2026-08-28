import crypto from 'crypto';

/**
 * Deterministic path hashing for the `hash` URL strategy.
 *
 * Node-only: this is used when building the URL map on the server. Client
 * components consume the finished map through `UrlMapProvider` and never hash
 * anything themselves, which keeps the digest implementation out of the browser
 * bundle.
 */

/**
 * Generates a stable, URL-safe hash for a content path.
 *
 * The same input always produces the same hash, so URLs stay valid across
 * builds as long as the file does not move.
 *
 * @param filePath - Content-relative path (e.g. 'guides/quick-start')
 * @returns Hash formatted as three 8-character groups
 *
 * @example
 * ```typescript
 * generatePathHash('guides/quick-start');
 * // 'a3f2e9d1-4b8c7e6f-9d2a1b3c'
 * ```
 */
export function generatePathHash(filePath: string): string {
  const hash = crypto.createHash('sha256').update(filePath).digest('hex');

  // Format: 8chars-8chars-8chars for readability
  return `${hash.slice(0, 8)}-${hash.slice(8, 16)}-${hash.slice(16, 24)}`;
}
