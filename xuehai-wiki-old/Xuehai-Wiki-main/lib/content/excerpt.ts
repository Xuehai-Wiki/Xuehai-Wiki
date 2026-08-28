import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import type { Root, RootContent } from 'mdast';
import { toString as mdastToString } from 'mdast-util-to-string';
import { getDoc } from './registry';
import { CACHE_DERIVED_CONTENT } from '../cache';

/**
 * Short plain-text summaries of documents.
 *
 * Used for the card that appears when a reader hovers a wiki link. Deriving it
 * from Markdown rather than from the rendered HTML keeps markup, syntax
 * highlighting, and the `ezw-` wrappers out of what is meant to be one or two
 * readable sentences.
 *
 * Server-only.
 */

/** How much of a document the card shows before trailing off. */
const MAX_LENGTH = 180;

/** Parser used only to reach the text; no rendering plugins. */
const parser = unified().use(remarkParse).use(remarkGfm);

/**
 * Node types that carry no prose worth previewing.
 *
 * A page opening with a diagram or a command should preview as the sentence
 * underneath it, not as an empty string or a line of shell.
 */
const SKIPPED = new Set(['code', 'thematicBreak', 'image', 'html', 'table', 'math']);

/**
 * Whether a node is the document's own title heading.
 *
 * The card shows the title separately, so repeating it as the first line of the
 * body wastes the little space there is.
 */
function isTitleHeading(node: RootContent): boolean {
  return node.type === 'heading' && node.depth === 1;
}

/**
 * Collapses a node's text into a single line.
 */
function flatten(node: RootContent): string {
  // An image alt is not prose; strip it so a paragraph that is only a figure
  // does not preview as its alt text.
  const clone: Root = { type: 'root', children: [structuredClone(node)] };
  visit(clone, 'image', (_image, index, parent) => {
    if (parent && index !== undefined) parent.children.splice(index, 1);
    return index;
  });

  return mdastToString(clone).replace(/\s+/g, ' ').trim();
}

/**
 * Builds a one-or-two sentence summary of a Markdown document.
 *
 * Prefers the frontmatter description, which an author wrote deliberately.
 * Otherwise takes prose from the top of the document, skipping the title and
 * anything that is not text, and stops at a word boundary so the card never
 * cuts mid-word.
 *
 * @param markdown - Document body, with frontmatter already stripped
 * @param description - `description` from the frontmatter, when present
 * @returns The summary, or an empty string when the document has no prose
 *
 * @example
 * ```typescript
 * buildExcerpt('# Title\n\nThe first sentence.'); // 'The first sentence.'
 * buildExcerpt('# Title\n\nIgnored.', 'From the frontmatter'); // 'From the frontmatter'
 * ```
 */
export function buildExcerpt(markdown: string, description?: string): string {
  if (description?.trim()) return truncate(description.trim());

  const tree = parser.parse(markdown) as Root;
  const parts: string[] = [];

  for (const node of tree.children) {
    if (isTitleHeading(node) || SKIPPED.has(node.type)) continue;

    const text = flatten(node);
    if (!text) continue;

    parts.push(text);
    if (parts.join(' ').length >= MAX_LENGTH) break;
  }

  return truncate(parts.join(' '));
}

const cache = new Map<string, string>();

/**
 * Returns a document's summary, memoised by path.
 *
 * A popular page is linked from dozens of others, and each of those links asks
 * for the same summary while its page is rendered. Parsing the target once per
 * build rather than once per link keeps that from showing up in build time.
 *
 * @param docPath - Content-relative path without extension
 * @returns The summary, or an empty string when there is no such document
 *
 * @example
 * ```typescript
 * getExcerpt('getting-started/quick-start'); // 'Get a wiki running in…'
 * ```
 */
export function getExcerpt(docPath: string): string {
  // Checked through the map rather than `cached()`, because an empty summary is
  // a legitimate result and would otherwise be indistinguishable from a miss.
  if (CACHE_DERIVED_CONTENT) {
    const hit = cache.get(docPath);
    if (hit !== undefined) return hit;
  }

  const doc = getDoc(docPath);
  const excerpt = doc ? buildExcerpt(doc.content, doc.description) : '';

  cache.set(docPath, excerpt);
  return excerpt;
}

/**
 * Shortens text to the preview length, breaking at a space.
 *
 * @param text - Text to shorten
 * @returns The text, with an ellipsis when it was cut
 */
function truncate(text: string): string {
  if (text.length <= MAX_LENGTH) return text;

  const cut = text.slice(0, MAX_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');

  return `${(lastSpace > MAX_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
