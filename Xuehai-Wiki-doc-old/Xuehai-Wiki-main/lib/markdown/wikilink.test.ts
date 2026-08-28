import { describe, it, expect } from 'vitest';
import { findWikiLinks, parseWikiLink } from './wikilink';

describe('parseWikiLink', () => {
  const parse = (inner: string) => parseWikiLink(inner, `[[${inner}]]`);

  it('parses a bare target', () => {
    expect(parse('guides/setup')).toMatchObject({
      target: 'guides/setup',
      anchor: undefined,
      label: undefined,
    });
  });

  it('parses a label after a pipe', () => {
    expect(parse('guides/setup|Setup Guide')).toMatchObject({
      target: 'guides/setup',
      label: 'Setup Guide',
    });
  });

  it('parses an anchor', () => {
    expect(parse('guides/setup#step-1')).toMatchObject({
      target: 'guides/setup',
      anchor: 'step-1',
    });
  });

  it('parses an anchor and a label together', () => {
    expect(parse('guides/setup#step-1|Step one')).toMatchObject({
      target: 'guides/setup',
      anchor: 'step-1',
      label: 'Step one',
    });
  });

  it('treats a hash in the label as part of the label', () => {
    expect(parse('setup|Step #1')).toMatchObject({
      target: 'setup',
      anchor: undefined,
      label: 'Step #1',
    });
  });

  it('keeps a pipe inside the label', () => {
    expect(parse('setup|a | b')).toMatchObject({ target: 'setup', label: 'a | b' });
  });

  it('trims surrounding whitespace', () => {
    expect(parse('  setup  |  Label  ')).toMatchObject({ target: 'setup', label: 'Label' });
  });

  it('allows an anchor-only link with no target', () => {
    expect(parse('#section')).toMatchObject({ target: '', anchor: 'section' });
  });

  it('returns null when there is neither target nor anchor', () => {
    expect(parse('')).toBeNull();
    expect(parse('   ')).toBeNull();
    expect(parse('|only a label')).toBeNull();
  });

  it('treats an empty label as absent', () => {
    expect(parse('setup|')).toMatchObject({ target: 'setup', label: undefined });
  });
});

describe('findWikiLinks', () => {
  it('finds every link in a string', () => {
    const links = findWikiLinks('See [[a]] and [[b|Bee]] today.');

    expect(links.map((link) => link.target)).toEqual(['a', 'b']);
    expect(links[1].label).toBe('Bee');
  });

  it('returns nothing when there are no links', () => {
    expect(findWikiLinks('plain text')).toEqual([]);
  });

  it('does not match across a newline', () => {
    expect(findWikiLinks('[[broken\nlink]]')).toEqual([]);
  });

  it('does not let an unterminated bracket swallow the rest', () => {
    expect(findWikiLinks('[[unclosed and then some text')).toEqual([]);
  });

  it('captures the raw source of each match', () => {
    expect(findWikiLinks('x [[a|B]] y')[0].raw).toBe('[[a|B]]');
  });
});

describe('embeds', () => {
  it('marks a leading ! as an embed', () => {
    const [link] = findWikiLinks('![[diagram.png]]');

    expect(link.embed).toBe(true);
    expect(link.target).toBe('diagram.png');
    expect(link.raw).toBe('![[diagram.png]]');
  });

  it('leaves a plain link unmarked', () => {
    const [link] = findWikiLinks('[[diagram.png]]');

    expect(link.embed).toBe(false);
  });

  // The `!` has to be part of the match. Matching only the brackets would
  // leave it behind as literal text in front of the rendered node.
  it('consumes the ! rather than leaving it in the text', () => {
    const [link] = findWikiLinks('before ![[a]] after');

    expect(link.raw.startsWith('!')).toBe(true);
  });

  it('accepts a label on an embed', () => {
    const [link] = findWikiLinks('![[diagram.png|Architecture]]');

    expect(link).toMatchObject({ target: 'diagram.png', label: 'Architecture', embed: true });
  });
});
