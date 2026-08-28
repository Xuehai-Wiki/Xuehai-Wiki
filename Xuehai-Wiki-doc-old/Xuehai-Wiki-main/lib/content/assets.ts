import fs from 'fs';
import path from 'path';
import { cached } from '../cache';

/**
 * Index of the static files a page can embed.
 *
 * `![[diagram.png]]` names a file the way a vault does — by its name, with no
 * path — because that is what an author remembers and what Obsidian accepts.
 * Turning that into a URL means knowing every file under `public/`, so they are
 * scanned once and indexed by both their full path and their bare filename.
 *
 * Server-only: reads the filesystem.
 */

/** Directory whose contents are served from the site root. */
export const PUBLIC_DIR = path.join(process.cwd(), 'public');

/**
 * Directories under `public/` that hold generated or structural files rather
 * than embeddable assets. Indexing them would let `![[search-index.json]]`
 * resolve, which is never what an author meant.
 */
const SKIP_DIRS = new Set(['fonts']);

/** Extensions an embed may point at. */
const EMBEDDABLE = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.svg',
  '.bmp',
  '.ico',
]);

/** A file under `public/` that a page may embed. */
export interface Asset {
  /** Path relative to `public/`, e.g. 'images/docs/sample.jpg' */
  path: string;
  /** Root-relative URL, before the deployment base path is applied */
  url: string;
}

/** Assets indexed for lookup. */
export interface AssetRegistry {
  /** Every embeddable asset found */
  assets: Asset[];
  /** By path relative to `public/`, lowercased */
  byPath: Map<string, Asset>;
  /** By bare filename, lowercased; several files may share one */
  byName: Map<string, Asset[]>;
}

let memo: AssetRegistry | null = null;

/**
 * Collects embeddable files beneath a directory.
 *
 * @param dir - Directory to scan
 * @param root - Directory that paths are made relative to
 * @returns Paths relative to `root`, using forward slashes
 */
function walkAssets(dir: string, root: string): string[] {
  if (!fs.existsSync(dir)) return [];

  const found: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (dir === root && SKIP_DIRS.has(entry.name)) continue;
      found.push(...walkAssets(full, root));
      continue;
    }

    if (!EMBEDDABLE.has(path.extname(entry.name).toLowerCase())) continue;

    found.push(path.relative(root, full).split(path.sep).join('/'));
  }

  return found;
}

/**
 * Scans `public/` and indexes what an embed may point at.
 *
 * Memoised for the process, like the content registry, and for the same
 * reason: the files cannot change during a build.
 *
 * @returns The populated registry
 *
 * @example
 * ```typescript
 * const { byName } = getAssetRegistry();
 * byName.get('sample.jpg')?.[0].url; // '/images/docs/sample.jpg'
 * ```
 */
export function getAssetRegistry(): AssetRegistry {
  const hit = cached(memo);
  if (hit) return hit;

  const assets: Asset[] = walkAssets(PUBLIC_DIR, PUBLIC_DIR).map((relative) => ({
    path: relative,
    url: `/${relative}`,
  }));

  const byPath = new Map(assets.map((asset) => [asset.path.toLowerCase(), asset]));
  const byName = new Map<string, Asset[]>();

  for (const asset of assets) {
    const name = path.basename(asset.path).toLowerCase();
    const existing = byName.get(name);
    if (existing) existing.push(asset);
    else byName.set(name, [asset]);
  }

  memo = { assets, byPath, byName };
  return memo;
}

/**
 * Resolves an embed target to a file under `public/`.
 *
 * A full path wins over a bare filename, so `![[icons/logo.svg]]` is
 * unambiguous even when another `logo.svg` exists elsewhere. A bare name that
 * matches more than one file resolves to nothing rather than guessing: picking
 * whichever was scanned first would silently embed the wrong image, and the
 * author would have no indication of it.
 *
 * @param target - Text between the brackets, e.g. 'sample.jpg'
 * @returns The asset, or null when nothing or too much matches
 *
 * @example
 * ```typescript
 * resolveAsset('sample.jpg')?.url; // '/images/docs/sample.jpg'
 * resolveAsset('/images/docs/sample.jpg')?.url; // '/images/docs/sample.jpg'
 * ```
 */
export function resolveAsset(target: string): Asset | null {
  const key = target.trim().replace(/^\/+/, '').toLowerCase();
  if (!key) return null;

  const { byPath, byName } = getAssetRegistry();

  const exact = byPath.get(key);
  if (exact) return exact;

  const matches = byName.get(key);
  if (matches?.length === 1) return matches[0];

  return null;
}
