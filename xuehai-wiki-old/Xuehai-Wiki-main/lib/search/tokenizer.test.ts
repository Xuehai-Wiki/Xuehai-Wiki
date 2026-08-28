import { describe, it, expect } from 'vitest';
import { bigrams, tokenize } from './tokenizer';

describe('bigrams', () => {
  it('produces overlapping character pairs', () => {
    expect(bigrams('위키문서')).toEqual(['위키', '키문', '문서']);
  });

  it('keeps a single character as-is', () => {
    expect(bigrams('한')).toEqual(['한']);
  });

  it('returns nothing for empty input', () => {
    expect(bigrams('')).toEqual([]);
  });
});

describe('tokenize', () => {
  it('splits Latin text on non-word characters and lower-cases it', () => {
    expect(tokenize('Quick Start Guide')).toEqual(['quick', 'start', 'guide']);
    expect(tokenize('dark-mode, enabled!')).toEqual(['dark', 'mode', 'enabled']);
  });

  it('keeps digits as terms', () => {
    expect(tokenize('Next.js 14')).toEqual(['next', 'js', '14']);
  });

  it('expands CJK runs into bigrams alongside the whole term', () => {
    expect(tokenize('시작하기')).toEqual(['시작하기', '시작', '작하', '하기']);
  });

  it('handles mixed scripts in one string', () => {
    expect(tokenize('Quick Start 시작하기')).toEqual([
      'quick',
      'start',
      '시작하기',
      '시작',
      '작하',
      '하기',
    ]);
  });

  it('does not bigram a term that merely contains CJK', () => {
    // Mixed-script terms are left whole; splitting them would produce bigrams
    // that straddle the script boundary and match nothing.
    expect(tokenize('API키')).toEqual(['api키']);
  });

  it('lets a CJK query match the terms stored for a document', () => {
    const indexed = new Set(tokenize('한국어 위키문서를 만들어 봅시다'));
    const query = tokenize('위키');

    expect(query.every((term) => indexed.has(term))).toBe(true);
  });

  it('returns nothing for whitespace or punctuation alone', () => {
    expect(tokenize('   ')).toEqual([]);
    expect(tokenize('--- ...')).toEqual([]);
  });
});
