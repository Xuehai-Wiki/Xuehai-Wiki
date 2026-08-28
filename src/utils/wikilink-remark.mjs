/**
 * Astro remark plugin: turns [[wiki links]] into ordinary markdown links at
 * parse time, so the rest of Astro's markdown pipeline handles them like any
 * other link. Also turns ![[embed]] into images.
 *
 * Ported from the old xuehai-wiki-doc (lib/markdown/remark-wikilink.ts) so the
 * wiki-link authoring syntax survives the migration into this Astro site.
 *
 * Usage (astro.config.mjs):
 *   markdown: { remarkPlugins: ['./src/utils/wikilink-remark.mjs'] }
 *
 * Resolver: a target maps to a doc id. Supported forms:
 *   [[docs/xuehai-login-api]]   full id
 *   [[xuehai-login-api]]        basename shorthand
 *   [[api/login]]               old content path (migrated) shorthand
 *   [[target|label]]            custom display text
 *   [[target#anchor]]           in-page anchor
 *   ![[file.png]]               image embed
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { visit } from 'unist-util-visit';

const WIKILINK_PATTERN = /(!?)\[\[([^\]\n]+)\]\]/g;

/** Registry of every doc id, derived from src/content/docs/*.md. */
let DOC_IDS = null;

function getDocIds() {
  if (DOC_IDS) return DOC_IDS;
  const dir = path.resolve(process.cwd(), 'src', 'content', 'docs');
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('_'));
  } catch {
    files = [];
  }
  DOC_IDS = files.map((f) => `docs/${f.replace(/\.md$/, '')}`);
  return DOC_IDS;
}

/** Resolve a wiki-link target to a /docs/ url, or null when unresolvable. */
function resolveTarget(target) {
  const ids = getDocIds();
  const clean = target.replace(/^docs\//, '').replace(/^\/+/, '').replace(/\.md$/i, '').replace(/\/+$/, '');
  if (!clean) return null;
  if (ids.includes(`docs/${clean}`)) return `/docs/${clean}`;
  const base = clean.split('/').pop();
  const exact = ids.find((id) => id === `docs/${base}`) || ids.find((id) => id === `docs/${clean}`);
  if (exact) return `/docs/${exact.replace('docs/', '')}`;
  const suffix = ids.find((id) => id.endsWith('/' + clean));
  if (suffix) return `/docs/${suffix.replace('docs/', '')}`;
  return null;
}

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

/** Build the replacement node for one link. */
function toNode(link) {
  // Image embed: ![[file.png]]
  if (link.embed) {
    // If it looks like an image file under public/, emit an image.
    if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(link.target)) {
      return {
        type: 'image',
        url: `/images/${link.target.replace(/^.*[/\\]/, '')}`,
        alt: link.label || link.target,
      };
    }
    // Non-image embed falls through to a link.
  }

  // Anchor-only link stays within the current page.
  if (!link.target && link.anchor) {
    return {
      type: 'link',
      url: `#${link.anchor}`,
      children: [{ type: 'text', value: link.label || link.anchor }],
    };
  }

  const url = resolveTarget(link.target);
  if (!url) {
    return {
      type: 'text',
      value: link.raw,
    };
  }

  return {
    type: 'link',
    url: link.anchor ? `${url}#${link.anchor}` : url,
    children: [{ type: 'text', value: link.label || link.target }],
  };
}

/** Split a text node into text and link nodes. */
function splitText(node) {
  const { value } = node;
  if (!value.includes('[[')) return null;

  const replacement = [];
  let cursor = 0;
  let matched = false;

  for (const match of value.matchAll(WIKILINK_PATTERN)) {
    const parsed = parseWikiLink(match[2], match[0], match[1] === '!');
    if (!parsed) continue;
    const start = match.index ?? 0;
    if (start > cursor) replacement.push({ type: 'text', value: value.slice(cursor, start) });
    replacement.push(toNode(parsed));
    cursor = start + match[0].length;
    matched = true;
  }

  if (!matched) return null;
  if (cursor < value.length) replacement.push({ type: 'text', value: value.slice(cursor) });
  return replacement;
}

/** Remark plugin factory. */
export default function remarkWikiLinks() {
  return (tree) => {
    visit(tree, 'text', (node, index, parent) => {
      if (!parent || index === undefined) return;
      const replacement = splitText(node);
      if (!replacement) return;
      parent.children.splice(index, 1, ...replacement);
      return index + replacement.length;
    });
  };
}