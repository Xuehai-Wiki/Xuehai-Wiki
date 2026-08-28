import { describe, it, expect } from 'vitest';
import { getWikiHealth } from './health';
import { getLinkGraph } from './build';
import { getReadingOrder } from '../navigation/sequence';

describe('getWikiHealth', () => {
  it('finds pages nothing links to', () => {
    const graph = getLinkGraph();

    for (const page of getWikiHealth().orphans) {
      expect(graph.backlinks.get(page.path) ?? []).toHaveLength(0);
    }
  });

  it('finds pages with no links out', () => {
    const graph = getLinkGraph();

    for (const page of getWikiHealth().deadEnds) {
      expect(graph.outbound.get(page.path) ?? []).toHaveLength(0);
    }
  });

  // Where a reader starts needs nothing pointing at it. Reporting it on every
  // build would teach everyone to ignore the report.
  it('never calls the entry page an orphan', () => {
    const [entry] = getReadingOrder();

    expect(getWikiHealth().orphans.map((page) => page.path)).not.toContain(entry);
  });

  it('reports only pages that are in the graph', () => {
    const paths = new Set(getLinkGraph().nodes.map((node) => node.path));
    const { orphans, deadEnds } = getWikiHealth();

    for (const page of [...orphans, ...deadEnds]) {
      expect(paths.has(page.path)).toBe(true);
    }
  });

  // Hidden pages are absent from the graph entirely, so an unlisted page is
  // not reported as disconnected — it is unlisted on purpose.
  it('says nothing about hidden pages', () => {
    const { orphans, deadEnds } = getWikiHealth();
    const reported = [...orphans, ...deadEnds].map((page) => page.path);
    const visible = new Set(getLinkGraph().nodes.map((node) => node.path));

    for (const path of reported) {
      expect(visible.has(path)).toBe(true);
    }
  });

  it('gives every reported page a title and a link', () => {
    const { orphans, deadEnds } = getWikiHealth();

    for (const page of [...orphans, ...deadEnds]) {
      expect(page.title).toBeTruthy();
      expect(page.url).toBeTruthy();
    }
  });
});
