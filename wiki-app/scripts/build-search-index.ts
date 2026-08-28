#!/usr/bin/env tsx

/**
 * Generates the client search index into `public/`.
 *
 * Runs before `next dev` and `next build`. Writing a static JSON file — rather
 * than exposing a route — keeps search working on any static host, with no
 * server to query.
 */

import fs from 'fs/promises';
import path from 'path';
import { buildSearchIndex } from '../lib/search/build';
import { SEARCH_INDEX_PATH } from '../lib/search/types';

async function main() {
  console.log('🔍 Building search index...');

  const index = await buildSearchIndex();
  const outputPath = path.join(process.cwd(), 'public', SEARCH_INDEX_PATH);
  const json = JSON.stringify(index);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, json, 'utf-8');

  const pages = new Set(index.docs.map((doc) => doc.path)).size;
  const kb = (Buffer.byteLength(json) / 1024).toFixed(1);

  console.log(`✅ Indexed ${index.docs.length} entries across ${pages} pages (${kb} kB)\n`);
}

main().catch((error) => {
  console.error('❌ Failed to build search index:');
  console.error(error);
  process.exit(1);
});
