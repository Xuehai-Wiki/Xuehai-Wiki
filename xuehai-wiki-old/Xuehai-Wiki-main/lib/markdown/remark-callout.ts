import { visit } from 'unist-util-visit';
import type { Root, Blockquote, PhrasingContent, BlockContent } from 'mdast';

/**
 * Turns `> [!NOTE]` blockquotes into callouts.
 *
 * The syntax is GitHub's and Obsidian's alike, which is the reason for
 * choosing it: a document written for either renders here, and one written
 * here still reads as an ordinary blockquote anywhere that does not know the
 * convention. Nothing is invented.
 *
 * Runs on the Markdown AST so the body passes through the rest of the pipeline
 * unchanged — links, code and wiki links inside a callout behave exactly as
 * they do outside one.
 */

/**
 * Marker opening a callout: the kind, an optional fold hint, and an optional
 * title on the same line.
 */
const MARKER = /^\[!([A-Za-z]+)\]([-+])?\s*(.*)$/;

/**
 * Callout kinds, and the ones that are the same thing under another name.
 *
 * GitHub defines five; Obsidian defines more and its vaults use them, so the
 * extra names map onto the nearest kind rather than falling back to a plain
 * quote. A vault should not lose its formatting on the way in.
 */
const KINDS: Record<string, string> = {
  note: 'note',
  info: 'note',
  abstract: 'note',
  summary: 'note',
  tip: 'tip',
  hint: 'tip',
  success: 'tip',
  check: 'tip',
  done: 'tip',
  important: 'important',
  example: 'important',
  question: 'important',
  help: 'important',
  faq: 'important',
  warning: 'warning',
  attention: 'warning',
  todo: 'warning',
  caution: 'caution',
  danger: 'caution',
  error: 'caution',
  failure: 'caution',
  fail: 'caution',
  bug: 'caution',
};

/** What a callout marker said. */
interface Marker {
  /** Normalised kind, one of the values in {@link KINDS} */
  kind: string;
  /** Heading text, defaulting to the kind when the author gave none */
  title: PhrasingContent[];
  /** Whether the body folds away, and whether it starts open */
  fold: 'none' | 'open' | 'closed';
}

/**
 * Reads the marker from the first line of a blockquote.
 *
 * @param node - The blockquote to inspect
 * @returns The marker, or null when this is an ordinary quote
 */
function readMarker(node: Blockquote): Marker | null {
  const [first] = node.children;
  if (!first || first.type !== 'paragraph') return null;

  const [lead] = first.children;
  if (!lead || lead.type !== 'text') return null;

  // Only the first line carries the marker; the rest of the paragraph is body.
  const newline = lead.value.indexOf('\n');
  const head = newline === -1 ? lead.value : lead.value.slice(0, newline);

  const match = MARKER.exec(head.trim());
  if (!match) return null;

  const kind = KINDS[match[1].toLowerCase()];
  if (!kind) return null;

  const rest = newline === -1 ? '' : lead.value.slice(newline + 1);
  const heading = match[3].trim();

  // Everything after the marker line stays in the body, including any inline
  // nodes that followed the opening text.
  const body: PhrasingContent[] = [
    ...(rest ? [{ type: 'text' as const, value: rest }] : []),
    ...first.children.slice(1),
  ];

  node.children = [
    ...(body.length ? [{ type: 'paragraph' as const, children: body }] : []),
    ...node.children.slice(1),
  ];

  return {
    kind,
    title: [{ type: 'text', value: heading || titleFor(kind) }],
    fold: match[2] === '-' ? 'closed' : match[2] === '+' ? 'open' : 'none',
  };
}

/** Default heading for a kind, when the author supplied none. */
function titleFor(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * Builds the callout node.
 *
 * A foldable callout becomes `<details>`, which opens and closes without any
 * script — the browser already knows how to do this, and a disclosure that
 * depends on JavaScript is one that fails with it disabled.
 */
function toCallout(node: Blockquote, marker: Marker): Blockquote {
  const foldable = marker.fold !== 'none';

  const heading: BlockContent = {
    type: 'paragraph',
    data: {
      hName: foldable ? 'summary' : 'p',
      hProperties: { className: ['ezw-callout__title'] },
    },
    children: marker.title,
  };

  return {
    type: 'blockquote',
    data: {
      hName: foldable ? 'details' : 'div',
      hProperties: {
        className: ['ezw-callout', `ezw-callout--${marker.kind}`],
        ...(marker.fold === 'open' ? { open: true } : {}),
      },
    },
    children: [heading, ...node.children],
  };
}

/**
 * Remark plugin factory.
 *
 * @example
 * ```typescript
 * unified().use(remarkParse).use(remarkCallouts);
 * // > [!WARNING] Mind the gap
 * // > Body text.
 * ```
 */
export function remarkCallouts() {
  return (tree: Root) => {
    visit(tree, 'blockquote', (node: Blockquote, index, parent) => {
      if (!parent || index === undefined) return;

      const marker = readMarker(node);
      if (!marker) return;

      parent.children[index] = toCallout(node, marker);

      // Skip the node just written: its children have already been read, and
      // revisiting would look at a blockquote that is now a callout.
      return index + 1;
    });
  };
}
