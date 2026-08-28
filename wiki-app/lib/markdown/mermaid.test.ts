import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './render';

/** Wraps a diagram in a fence tagged `mermaid`. */
function fence(body: string): string {
  return ['```mermaid', body, '```', ''].join('\n');
}

describe('mermaid diagrams', () => {
  it('draws a fence as SVG during the build', async () => {
    const { html } = await renderMarkdown(fence('flowchart TD\n  A[One] --> B[Two]'));

    expect(html).toContain('class="ezw-mermaid"');
    expect(html).toContain('<svg');
    expect(html).toContain('One');
  });

  // The site self-hosts and subsets its fonts; the renderer inlines a Google
  // Fonts import that would undo that on every page carrying a diagram.
  it('carries no third-party request', async () => {
    const { html } = await renderMarkdown(fence('flowchart TD\n  A --> B'));

    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('@import');
  });

  // Fixed inline, the colours would survive a switch to dark; left to CSS, the
  // diagram follows the theme like everything else.
  it('leaves its colours to the stylesheet', async () => {
    const { html } = await renderMarkdown(fence('flowchart TD\n  A --> B'));

    expect(html).toMatch(/var\(--(bg|fg)\)/);
    expect(html).not.toMatch(/<svg[^>]*style="[^"]*--bg/);
  });

  // Nothing is drawn in the browser, so a crawler and a reader without
  // JavaScript see the same diagram everyone else does.
  it('needs no script to appear', async () => {
    const { html } = await renderMarkdown(fence('flowchart TD\n  A --> B'));

    expect(html).not.toContain('<script');
  });

  it('draws the kinds a wiki actually uses', async () => {
    const kinds = [
      'sequenceDiagram\n  A->>B: hello',
      'stateDiagram-v2\n  [*] --> Draft',
      'classDiagram\n  class Page',
      'erDiagram\n  PAGE ||--o{ LINK : has',
    ];

    for (const source of kinds) {
      expect((await renderMarkdown(fence(source))).html).toContain('ezw-mermaid');
    }
  });

  // A kind the renderer cannot draw leaves the reader exactly what they had
  // before diagrams existed, rather than stopping the build.
  it('falls back to a code block on an unsupported diagram', async () => {
    const { html } = await renderMarkdown(fence('pie title X\n  "a" : 1'));

    expect(html).not.toContain('ezw-mermaid');
    expect(html).toContain('data-language="mermaid"');
  });

  it('leaves ordinary code fences alone', async () => {
    const { html } = await renderMarkdown('```js\nconst a = 1;\n```\n');

    expect(html).toContain('ezw-code');
    expect(html).not.toContain('ezw-mermaid');
  });
});
