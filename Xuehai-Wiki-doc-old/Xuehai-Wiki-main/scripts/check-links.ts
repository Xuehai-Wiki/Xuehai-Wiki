#!/usr/bin/env tsx

/**
 * Reports on the shape of the link graph.
 *
 * Two kinds of finding, treated differently. An unresolved link is an error in
 * the content and `--strict` makes it fail the build, which is what CI passes.
 * A page nothing links to, or nothing links on from, is not an error — a
 * correct wiki can have either — so those are reported and never fail. They are
 * the shapes a set of documents falls into as it stops being a wiki, and
 * neither is visible from inside a single page.
 *
 * Reporting rather than failing on unresolved links by default is deliberate
 * too: a dangling link in one page is not a reason to block a deploy of the
 * other twenty, and content is often written before the page it references.
 */

import { getLinkGraph } from '../lib/graph/build';
import { getWikiHealth } from '../lib/graph/health';
import type { GraphNode } from '../lib/graph/build';

const strict = process.argv.includes('--strict');
const { broken, nodes, edges } = getLinkGraph();

/**
 * Prints a list of pages under a heading, or nothing when there are none.
 *
 * @param label - What the pages have in common, singular and plural
 * @param explanation - Why it is worth knowing
 * @param pages - The pages found
 */
function report(
  label: { one: string; many: string },
  explanation: string,
  pages: GraphNode[],
): void {
  if (pages.length === 0) return;

  const noun = pages.length === 1 ? label.one : label.many;

  console.log(`⚠️  ${pages.length} ${noun} — ${explanation}`);
  for (const page of pages) console.log(`     content/${page.path}.md`);
  console.log();
}

if (broken.length > 0) {
  console.log(`\n🔗 ${broken.length} unresolved link${broken.length === 1 ? '' : 's'}:\n`);

  for (const link of broken) {
    console.log(`  content/${link.from}.md`);

    if (link.reason === 'ambiguous') {
      console.log(`    [[${link.target}]] is ambiguous — matches ${link.candidates?.join(', ')}`);
      console.log('    Use the full path to disambiguate.');
    } else {
      console.log(`    [[${link.target}]] matches no page`);
    }
  }

  console.log();
} else {
  console.log(`\n🔗 Links OK — ${edges.length} links across ${nodes.length} pages\n`);
}

const { orphans, deadEnds } = getWikiHealth();

report(
  { one: 'orphaned page', many: 'orphaned pages' },
  'nothing links here, so a reader can only arrive from the sidebar',
  orphans,
);

report(
  { one: 'dead end', many: 'dead ends' },
  'no links out, so a reader arrives with nowhere to go',
  deadEnds,
);

if (broken.length > 0 && strict) {
  console.error('❌ Failing because --strict was passed.\n');
  process.exit(1);
}
