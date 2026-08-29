/**
 * Builds the wiki link graph for the Xuehai Wiki.
 *
 * Scans every Markdown document under src/content/docs/, resolves [[wiki links]]
 * (and normal relative markdown links) to other documents, and writes a JSON
 * graph to public/graph.json. The graph drives:
 *   - the backlinks section on each doc page (see src/components/starlight/Footer.astro)
 *
 * Run as part of the Astro build (see astro.config.mjs hooks) or manually:
 *   node scripts/build-graph.mjs
 *
 * Data shape written to public/graph.json:
 * {
 *   nodes:  [{ id, title, url, degree }],                 // every visible doc
 *   edges:  [{ from, to }],                               // resolved page->page links
 *   backlinks: { targetId: [sourceId, ...] },             // who links to whom
 *   outbound: { sourceId: [targetId, ...] },              // who each page links to
 *   broken: [{ from, target, reason }]                    // unresolved references
 * }
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = path.join(ROOT, 'src', 'content', 'docs');
const OUT_FILE = path.join(ROOT, 'public', 'graph.json');

/** Matches [[target]] and ![[embed]]; refuses ] and newlines inside brackets. */
const WIKILINK_PATTERN = /(!?)\[\[([^\]\n]+)\]\]/g;

/** Parse the inside of a wiki link into target + optional anchor + optional label. */
function parseWikiLink(inner, raw, embed) {
  const pipe = inner.indexOf('|');
  const label = pipe === -1 ? undefined : inner.slice(pipe + 1).trim();
  const locator = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
  const hash = locator.indexOf('#');
  const target = (hash === -1 ? locator : locator.slice(0, hash)).trim();
  const anchor = hash === -1 ? undefined : locator.slice(hash + 1).trim() || undefined;
  if (!target && !anchor) return null;
  return { target, anchor, label, embed, raw };
}

/** Finds every wiki link in a text string. */
function findWikiLinks(text) {
  const links = [];
  for (const match of text.matchAll(WIKILINK_PATTERN)) {
    const parsed = parseWikiLink(match[2], match[0], match[1] === '!');
    if (parsed) links.push(parsed);
  }
  return links;
}

/**
 * Resolve a wiki-link target to a doc id.
 *
 * Accepts the full id ("docs/xuehai-login-api") or a shorthand ("xuehai-login-api"
 * or the old content path "api/login"). Shorthand resolves to a unique doc by
 * matching the doc's basename or full path suffix.
 *
 * @returns the matching doc id, or null when none / ambiguous
 */
function resolveTarget(target, docs) {
  const clean = target.replace(/^docs\//, '').replace(/^\/+/, '').replace(/\.md$/i, '').replace(/\/+$/, '');

  // Exact id match first.
  const byId = docs.find((d) => d.id === target || d.id === `docs/${clean}`);
  if (byId) return byId.id;

  // Fallback: match by basename or path suffix, prefer exact basename.
  const matches = docs.filter((d) => {
    const base = d.id.split('/').pop();
    if (clean === base) return true;
    return d.id.endsWith('/' + clean) || d.id === `docs/${clean}`;
  });

  if (matches.length === 1) return matches[0].id;
  return null;
}

/** Collects every markdown file under a directory (non-recursive here). */
function readDocs() {
  const files = readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md') && !f.startsWith('_') && !f.startsWith('.'));
  return files.map((file) => {
    const raw = readFileSync(path.join(DOCS_DIR, file), 'utf-8');
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
    const frontmatter = match ? match[1] : '';
    const body = match ? raw.slice(match[0].length) : raw;
    const fm = {};
    for (const line of frontmatter.split(/\r?\n/)) {
      const m = /^([\w-]+):\s*(.*)$/.exec(line.trim());
      if (m) fm[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
    const id = `docs/${file.replace(/\.md$/, '')}`;
    return { id, file, title: fm.title || file.replace(/\.md$/, ''), body };
  });
}

/** Extract the content-relative path a normal markdown link points at, if any. */
function resolveMarkdownLink(url, docs) {
  if (!url || url.startsWith('#') || url.startsWith('http') || url.startsWith('//') || url.startsWith('mailto:')) return null;
  const p = url.split(/[#?]/)[0].replace(/^\/+/, '').replace(/\.md$/i, '').replace(/\/+$/, '');
  if (!p) return null;
  // Only treat links as page edges if they point at a docs id.
  const clean = p.replace(/^docs\//, '');
  const hit = docs.find((d) => d.id === p || d.id === `docs/${clean}` || d.id.split('/').pop() === clean);
  return hit ? hit.id : null;
}

function build() {
  if (!existsSync(DOCS_DIR)) {
    console.error(`Docs dir not found: ${DOCS_DIR}`);
    process.exit(1);
  }

  const docs = readDocs();
  const byId = new Map(docs.map((d) => [d.id, d]));

  const edges = [];
  const broken = [];
  const backlinks = new Map();
  const outbound = new Map();

  for (const doc of docs) {
    const targets = new Set();
    // Scan text for wiki links (crude: scan raw body text nodes).
    const textOnly = doc.body.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
    for (const link of findWikiLinks(textOnly)) {
      if (!link.target) continue;
      const resolved = resolveTarget(link.target, docs);
      if (resolved && resolved !== doc.id) {
        targets.add(resolved);
      } else if (!resolved && !link.embed) {
        broken.push({ from: doc.id, target: link.target, reason: 'missing' });
      }
    }
    // Scan normal markdown links.
    const linkRe = /\]\(([^)\s]+)\)/g;
    let lm;
    while ((lm = linkRe.exec(doc.body)) !== null) {
      const resolved = resolveMarkdownLink(lm[1], docs);
      if (resolved && resolved !== doc.id) targets.add(resolved);
    }

    const sorted = [...targets].sort();
    outbound.set(doc.id, sorted);
    for (const t of sorted) {
      edges.push({ from: doc.id, to: t });
      if (backlinks.has(t)) backlinks.get(t).push(doc.id);
      else backlinks.set(t, [doc.id]);
    }
  }

  for (const list of backlinks.values()) list.sort();

  const degree = new Map();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }

  const nodes = docs.map((d) => ({
    id: d.id,
    title: d.title,
    url: `/docs/${d.id.replace('docs/', '')}`,
    degree: degree.get(d.id) ?? 0,
  }));

  const graph = {
    nodes,
    edges,
    backlinks: Object.fromEntries(backlinks),
    outbound: Object.fromEntries(outbound),
    broken,
  };

  mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(graph, null, 2));
  console.log(`✓ Wrote graph with ${nodes.length} nodes, ${edges.length} edges, ${broken.length} broken links -> ${path.relative(ROOT, OUT_FILE)}`);
}

build();