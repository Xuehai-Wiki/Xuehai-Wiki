import { CodeCopy } from './CodeCopy';
import { LinkPreview } from './LinkPreview';

/**
 * Props for the MarkdownContent component
 */
interface MarkdownContentProps {
  /** HTML produced at build time by the Markdown pipeline */
  html: string;
}

/**
 * Renders pre-compiled Markdown HTML.
 *
 * The markup arrives already parsed, highlighted, and link-resolved from
 * `renderDoc()`, so this is a server component that emits static HTML. The only
 * client-side code is the copy-button and link-preview listeners.
 *
 * Passing build-time output to `dangerouslySetInnerHTML` is safe here in the
 * sense that matters: the input is the repository's own content files, not user
 * submissions. Raw HTML in Markdown is intentionally supported.
 *
 * @param props - Component props
 * @param props.html - Rendered HTML for the document body
 *
 * @example
 * ```tsx
 * const rendered = await renderDoc('guides/quick-start');
 * <MarkdownContent html={rendered.html} />;
 * ```
 */
export function MarkdownContent({ html }: MarkdownContentProps) {
  return (
    <>
      <div className="ezw-prose" dangerouslySetInnerHTML={{ __html: html }} />
      <CodeCopy />
      <LinkPreview />
    </>
  );
}
