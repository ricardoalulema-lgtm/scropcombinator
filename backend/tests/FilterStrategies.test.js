import { describe, it, expect } from 'vitest';
import { WordCounter } from '../src/services/WordCounter.js';
import { FilterStrategy } from '../src/services/strategies/FilterStrategy.js';
import { MoreThanFiveWordsStrategy } from '../src/services/strategies/MoreThanFiveWordsStrategy.js';
import { LessOrEqualFiveWordsStrategy } from '../src/services/strategies/LessOrEqualFiveWordsStrategy.js';

const buildEntry = (number, title, points, comments) => ({ number, title, points, comments });

const entries = [
  buildEntry(1, 'Short title here', 300, 40),
  buildEntry(2, 'This is - a self-explained example', 250, 100),
  buildEntry(3, 'A much longer title with more than five words total', 120, 250),
  buildEntry(4, 'Another entry with even more words than required by the filter', 90, 60),
  buildEntry(5, 'Five words exactly here now', 0, 10)
];

describe('MoreThanFiveWordsStrategy', () => {
  const strategy = new MoreThanFiveWordsStrategy(new WordCounter());

  it('exposes its filter identifier', () => {
    expect(strategy.name).toBe('MORE_THAN_5_WORDS_BY_COMMENTS');
  });

  it('keeps only entries whose title has more than 5 words', () => {
    const result = strategy.apply(entries);
    expect(result.map((entry) => entry.number)).toEqual([3, 4]);
  });

  it('sorts results by comments in descending order', () => {
    const result = strategy.apply(entries);
    expect(result.map((entry) => entry.comments)).toEqual([250, 60]);
  });

  it('returns an empty array when no entry matches', () => {
    const result = strategy.apply([buildEntry(6, 'Tiny title', 10, 1)]);
    expect(result).toEqual([]);
  });

  it('does not mutate the original entries array', () => {
    const original = [...entries];
    strategy.apply(entries);
    expect(entries).toEqual(original);
  });
});

describe('LessOrEqualFiveWordsStrategy', () => {
  const strategy = new LessOrEqualFiveWordsStrategy(new WordCounter());

  it('exposes its filter identifier', () => {
    expect(strategy.name).toBe('LESS_OR_EQUAL_5_WORDS_BY_POINTS');
  });

  it('keeps only entries whose title has 5 words or fewer', () => {
    const result = strategy.apply(entries);
    expect(result.map((entry) => entry.number)).toEqual([1, 2, 5]);
  });

  it('includes the boundary case of exactly 5 words', () => {
    const result = strategy.apply(entries);
    expect(result.map((entry) => entry.number)).toContain(2);
    expect(result.map((entry) => entry.number)).toContain(5);
  });

  it('sorts results by points in descending order', () => {
    const result = strategy.apply(entries);
    expect(result.map((entry) => entry.points)).toEqual([300, 250, 0]);
  });

  it('returns an empty array when no entry matches', () => {
    const result = strategy.apply([buildEntry(7, 'One two three four five six seven', 500, 999)]);
    expect(result).toEqual([]);
  });

  it('does not mutate the original entries array', () => {
    const original = [...entries];
    strategy.apply(entries);
    expect(entries).toEqual(original);
  });
});

describe('FilterStrategy contract (LSP)', () => {
  it('allows any strategy to be substituted through the common abstraction', () => {
    const strategies = [
      new MoreThanFiveWordsStrategy(new WordCounter()),
      new LessOrEqualFiveWordsStrategy(new WordCounter())
    ];

    for (const strategy of strategies) {
      expect(strategy).toBeInstanceOf(FilterStrategy);
      expect(Array.isArray(strategy.apply(entries))).toBe(true);
    }
  });
});
