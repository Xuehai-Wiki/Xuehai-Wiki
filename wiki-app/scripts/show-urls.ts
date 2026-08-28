#!/usr/bin/env tsx

/**
 * Lists the URL of every page the site will build.
 *
 * Useful for finding the address of a hidden page, and for confirming what the
 * configured URL strategy actually produces before deploying.
 *
 * Run with: npm run show-urls
 */

import { payload } from '../payload/config';
import { getContentRegistry } from '../lib/content/registry';
import { getUrlMap } from '../lib/navigation/urlMap';

const { docs } = getContentRegistry();
const urlMap = getUrlMap();
const baseUrl = payload.global.baseUrl || 'http://localhost:3000';

console.log(`\n📋 Page URLs  (strategy: ${urlMap.strategy})\n`);
console.log('='.repeat(80));

for (const doc of docs) {
  const url = urlMap.toUrl[doc.path];
  if (!url) continue;

  console.log(`${doc.hidden ? '🔒 [HIDDEN]' : '📄'} ${doc.title}`);
  console.log(`   source → content/${doc.path}.md`);
  console.log(`   url    → ${baseUrl}/${url}`);
  console.log();
}

const hiddenCount = docs.filter((doc) => doc.hidden).length;

console.log('='.repeat(80));
console.log(`\nTotal pages: ${docs.length}`);
console.log(`Hidden pages: ${hiddenCount}`);

if (hiddenCount > 0) {
  console.log('\n💡 Hidden pages are absent from navigation but reachable at the URL above.');
}

if (urlMap.strategy === 'hash') {
  console.log(
    "\n💡 URLs are hashed. Set global.urlStrategy to 'path' in payload/config.ts for\n" +
      '   readable, indexable URLs.',
  );
}
