import { visit } from 'unist-util-visit';
import type {
  Root,
  Text,
  PhrasingContent,
  Parent,
  Paragraph,
  RootContent,
  BlockContent,
} from 'mdast';
import { WIKILINK_PATTERN, parseWikiLink, type WikiLink } from './wikilink';

/**
 * Turns `[[wiki links]]` into ordinary Markdown links.
 *
 * Runs on the Markdown AST, before conversion to HTML, so the resulting links
 * pass through the rest of the pipeline like any other. Only text nodes are
 * visited, which means links written inside code spans and fenced blocks are
 * left alone for free — documentation that explains the syntax has to be able
 * to show it.
 */

/** What a target resolved to. */
export interface WikiLinkTarget {
  /** Root-relative href for the document */
  url: string;
  /** Default display text when the author gave no label */
  title: string;
  /** One-line summary, carried on the link so a hover card needs no request */
  excerpt?: string;
}

/**
 * Resolves a wiki-link target to a destination, or null when there is none.
 */
export type WikiLinkResolver = (target: string) => WikiLinkTarget | null;

/**
 * Resolves an embed target to a static file, or null when there is none.
 */
export type EmbedResolver = (target: string) => { url: string } | null;

/** A document whose content is to be shown inside another. */
export interface TranscludeTarget {
  /** Content path, used to detect a page including itself */
  path: string;
  /** Href of the source document */
  url: string;
  /** Title of the source document */
  title: string;
  /** The Markdown nodes to splice in */
  nodes: RootContent[];
}

/**
 * Resolves an embed target to a document's content, or null when the target is
 * not a document or the named section does not exist.
 */
export type TranscludeResolver = (target: string, anchor?: string) => TranscludeTarget | null;

/** How a wiki link should be turned into a node. */
export interface WikiLinkResolvers {
  /** Resolves a document target */
  link: WikiLinkResolver;
  /** Resolves an embeddable file; absent when embeds are not supported */
  embed?: EmbedResolver;
  /** Resolves a document to include inline; absent disables transclusion */
  transclude?: TranscludeResolver;
}

/**
 * How deeply a transclusion may nest.
 *
 * A page including a page that includes a page is already hard to read; past
 * that it is more likely a mistake than an intent, and each level multiplies
 * the work the build does.
 */
const MAX_TRANSCLUSION_DEPTH = 3;

/**
 * Builds the replacement node for one wiki link.
 *
 * An unresolved link renders as marked-up text rather than an anchor: a link
 * that goes nowhere is worse than visibly broken text, because it looks
 * clickable and silently is not.
 */
function toNode(link: WikiLink, resolvers: WikiLinkResolvers): PhrasingContent {
  const resolve = resolvers.link;

  // `![[file.png]]` shows the file rather than linking to it. Only static
  // assets are embedded for now; `![[some-note]]` falls through to a link, so
  // an author who writes it gets a working reference instead of nothing.
  if (link.embed && resolvers.embed) {
    const asset = resolvers.embed(link.target);

    if (asset) {
      return {
        type: 'image',
        url: asset.url,
        alt: link.label ?? link.target,
      };
    }
  }

  // An anchor-only link points within the current page, so there is nothing to
  // resolve.
  if (!link.target && link.anchor) {
    return {
      type: 'link',
      url: `#${link.anchor}`,
      children: [{ type: 'text', value: link.label ?? link.anchor }],
    };
  }

  const resolved = resolve(link.target);

  if (!resolved) {
    return {
      // `emphasis` is a carrier for the rendered span: it is a known phrasing
      // type, so it degrades to <em> if the hName hint is ever ignored.
      type: 'emphasis',
      data: {
        hName: 'span',
        hProperties: {
          className: ['ezw-broken-link'],
          title: `Unresolved link: ${link.target}`,
        },
      },
      children: [{ type: 'text', value: link.label ?? link.target }],
    };
  }

  return {
    type: 'link',
    url: link.anchor ? `${resolved.url}#${link.anchor}` : resolved.url,
    data: {
      hProperties: {
        className: ['ezw-wikilink'],
        // The card's contents travel with the link rather than being fetched.
        // The build already knows them, and a reader who hovers should not wait
        // on a request to find out where a link goes.
        'data-preview-title': resolved.title,
        ...(resolved.excerpt ? { 'data-preview': resolved.excerpt } : {}),
      },
    },
    children: [{ type: 'text', value: link.label ?? resolved.title }],
  };
}

/**
 * Splits a text node into text and link nodes.
 *
 * @param node - The text node to split
 * @param resolvers - Target resolvers for links and embeds
 * @returns Replacement nodes, or null when the text contains no wiki links
 */
function splitText(node: Text, resolvers: WikiLinkResolvers): PhrasingContent[] | null {
  const { value } = node;
  if (!value.includes('[[')) return null;

  const replacement: PhrasingContent[] = [];
  let cursor = 0;
  let matched = false;

  // matchAll on a global pattern is safe here because the regex literal is
  // re-evaluated per call; lastIndex never leaks between documents.
  for (const match of value.matchAll(WIKILINK_PATTERN)) {
    const parsed = parseWikiLink(match[2], match[0], match[1] === '!');
    if (!parsed) continue;

    const start = match.index ?? 0;

    if (start > cursor) {
      replacement.push({ type: 'text', value: value.slice(cursor, start) });
    }

    replacement.push(toNode(parsed, resolvers));
    cursor = start + match[0].length;
    matched = true;
  }

  if (!matched) return null;

  if (cursor < value.length) {
    replacement.push({ type: 'text', value: value.slice(cursor) });
  }

  return replacement;
}

/**
 * Reads a paragraph that consists of nothing but one embed.
 *
 * Transclusion replaces a paragraph with whole blocks — headings, lists, code —
 * which cannot sit inside one. So it applies only when the embed is alone in
 * its paragraph, which is also how an author writes it. An embed with prose
 * beside it stays inline and becomes a link.
 *
 * @param node - Paragraph to inspect
 * @returns The embed, or null when the paragraph holds anything else
 */
function soleEmbed(node: Paragraph): WikiLink | null {
  if (node.children.length !== 1) return null;

  const [child] = node.children;
  if (child.type !== 'text') return null;

  const text = child.value.trim();
  const match = /^(!?)\[\[([^\]\n]+)\]\]$/.exec(text);
  if (!match || match[1] !== '!') return null;

  return parseWikiLink(match[2], match[0], true);
}

/**
 * Wraps included content so a reader can see where it came from.
 *
 * `blockquote` carries the block children — it is a known type that accepts
 * them — while `hName` renders it as a plain division.
 */
function wrapTranscluded(target: TranscludeTarget, nodes: RootContent[]): RootContent {
  return {
    type: 'blockquote',
    data: {
      hName: 'div',
      hProperties: { className: ['ezw-transclusion'] },
    },
    children: [
      ...(nodes as BlockContent[]),
      {
        type: 'paragraph',
        data: { hProperties: { className: ['ezw-transclusion__source'] } },
        children: [
          {
            type: 'link',
            url: target.url,
            children: [{ type: 'text', value: target.title }],
          },
        ],
      },
    ],
  };
}

/**
 * Marks headings that arrived by transclusion.
 *
 * The table of contents describes the page a reader is on. Headings pulled in
 * from elsewhere would list sections that belong to another document, so they
 * are flagged here and skipped when the contents are collected.
 */
function markTranscludedHeadings(tree: Root): void {
  visit(tree, 'heading', (heading) => {
    heading.data ??= {};
    const properties = (heading.data.hProperties ??= {}) as Record<string, unknown>;
    properties['data-transcluded'] = 'true';
  });
}

/**
 * Replaces sole-embed paragraphs with the content they name.
 *
 * @param tree - Tree to transform in place
 * @param resolvers - Target resolvers
 * @param stack - Paths already being included, innermost last
 */
function transclude(tree: Root, resolvers: WikiLinkResolvers, stack: string[]): void {
  const resolve = resolvers.transclude;
  if (!resolve) return;

  visit(tree, 'paragraph', (node: Paragraph, index, parent) => {
    if (!parent || index === undefined) return;

    const embed = soleEmbed(node);
    if (!embed || !embed.target) return;

    const target = resolve(embed.target, embed.anchor);
    if (!target) return;

    // A page including itself, directly or through a chain, would never finish.
    // Leaving the link is the honest outcome: the reference is real, it just
    // cannot be shown here.
    if (stack.includes(target.path) || stack.length >= MAX_TRANSCLUSION_DEPTH) return;

    const inner: Root = { type: 'root', children: target.nodes };
    transclude(inner, resolvers, [...stack, target.path]);
    markTranscludedHeadings(inner);

    parent.children.splice(index, 1, wrapTranscluded(target, inner.children));

    return index + 1;
  });
}

/**
 * Remark plugin factory.
 *
 * @param resolvers - Resolves a target to a document, and optionally to a file
 *
 * @example
 * ```typescript
 * unified().use(remarkParse).use(remarkWikiLinks, {
 *   link: (target) =>
 *     target === 'intro' ? { url: '/intro/', title: 'Introduction' } : null,
 *   embed: (target) => (target === 'logo.svg' ? { url: '/images/logo.svg' } : null),
 * });
 * ```
 */
export function remarkWikiLinks(resolvers: WikiLinkResolvers) {
  return (tree: Root, file: { data: Record<string, unknown> }) => {
    // Transclusion first: it works on whole paragraphs, and the inline pass
    // below would otherwise have already turned the embed into a link.
    const docPath = file?.data?.docPath;
    transclude(tree, resolvers, typeof docPath === 'string' ? [docPath] : []);

    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined) return;

      const replacement = splitText(node, resolvers);
      if (!replacement) return;

      (parent as Parent).children.splice(index, 1, ...replacement);

      // Continue after the nodes just inserted, so their text is not rescanned.
      return index + replacement.length;
    });
  };
}
