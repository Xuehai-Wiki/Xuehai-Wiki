import { describe, it, expect } from 'vitest';
import { buildExcerpt, getExcerpt } from './excerpt';

describe('buildExcerpt', () => {
  it('prefers the description an author wrote', () => {
    expect(buildExcerpt('# Title\n\nThe body.', 'A deliberate summary')).toBe(
      'A deliberate summary',
    );
  });

  it('falls back to the opening prose', () => {
    expect(buildExcerpt('# Title\n\nThe first sentence.')).toBe('The first sentence.');
  });

  // The card shows the title on its own line, so repeating it as the summary
  // would waste the space there is.
  it('skips the title heading', () => {
    expect(buildExcerpt('# Page Title\n\nBody text.')).not.toContain('Page Title');
  });

  it('skips code, rules and tables to reach the prose', () => {
    const markdown = '# T\n\n```bash\nnpm install\n```\n\n---\n\nThe actual sentence.';

    expect(buildExcerpt(markdown)).toBe('The actual sentence.');
  });

  // A page opening with a figure should preview as the sentence under it, not
  // as the image's alt text.
  it('leaves image alt text out', () => {
    expect(buildExcerpt('# T\n\n![a diagram of the pipeline](/x.png)\n\nReal prose.')).toBe(
      'Real prose.',
    );
  });

  it('flattens inline markup and whitespace', () => {
    expect(buildExcerpt('# T\n\nSome **bold**\nand `code` here.')).toBe('Some bold and code here.');
  });

  it('cuts at a word boundary rather than mid-word', () => {
    const long = `# T\n\n${'alpha '.repeat(80)}`;
    const excerpt = buildExcerpt(long);

    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt).not.toMatch(/alph…$/);
    expect(excerpt.length).toBeLessThanOrEqual(181);
  });

  it('returns nothing for a document with no prose', () => {
    expect(buildExcerpt('# Only a title\n')).toBe('');
  });
});

describe('getExcerpt', () => {
  // `intro` is the one document both this repository and a freshly scaffolded
  // project have, so this test travels with the engine rather than having to be
  // held back from it.
  it('summarises a document from the registry', () => {
    expect(getExcerpt('intro').length).toBeGreaterThan(0);
  });

  it('returns the same summary on a repeat call', () => {
    expect(getExcerpt('intro')).toBe(getExcerpt('intro'));
  });

  it('returns an empty summary for an unknown path', () => {
    expect(getExcerpt('no/such/document')).toBe('');
  });
});
