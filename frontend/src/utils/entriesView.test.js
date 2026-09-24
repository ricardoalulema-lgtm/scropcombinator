import { describe, it, expect } from 'vitest';
import { countWords, filterByText, filterByWordCount, sortByField, applyViewOptions } from './entriesView.js';

const entriesFixture = [
  { number: 1, title: 'Short title here', points: 300, comments: 40 },
  { number: 2, title: 'This is - a self-explained example', points: 250, comments: 100 },
  { number: 3, title: 'A much longer title with more than five words total', points: 120, comments: 250 },
  { number: 4, title: 'Z80 REPL', points: 81, comments: 10 }
];

describe('entriesView', () => {
  it('countWords matches the backend rule for isolated symbols', () => {
    expect(countWords('This is - a self-explained example')).toBe(5);
    expect(countWords('Z80 REPL')).toBe(2);
    expect(countWords('')).toBe(0);
    expect(countWords(null)).toBe(0);
  });

  it('filterByText keeps only entries whose title contains the text (case-insensitive)', () => {
    const result = filterByText(entriesFixture, 'z80');

    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(4);
  });

  it('filterByText returns all entries when the text is empty', () => {
    expect(filterByText(entriesFixture, '   ')).toHaveLength(4);
  });

  it('filterByWordCount keeps only entries with exactly N words', () => {
    expect(filterByWordCount(entriesFixture, 5).map((entry) => entry.number)).toEqual([2]);
    expect(filterByWordCount(entriesFixture, 10).map((entry) => entry.number)).toEqual([3]);
    expect(filterByWordCount(entriesFixture, 2).map((entry) => entry.number)).toEqual([4]);
  });

  it('filterByWordCount is ignored when no count is selected', () => {
    expect(filterByWordCount(entriesFixture, null)).toHaveLength(4);
  });

  it('sortByField sorts by points descending without mutating the input', () => {
    const original = [...entriesFixture];
    const result = sortByField(entriesFixture, 'points');

    expect(result.map((entry) => entry.points)).toEqual([300, 250, 120, 81]);
    expect(entriesFixture).toEqual(original);
    expect(result).not.toBe(entriesFixture);
  });

  it('sortByField sorts by comments descending', () => {
    const result = sortByField(entriesFixture, 'comments');

    expect(result.map((entry) => entry.comments)).toEqual([250, 100, 40, 10]);
  });

  it('applyViewOptions combines text filter, word count and sort', () => {
    const result = applyViewOptions(entriesFixture, {
      text: 'title',
      wordCount: 3,
      sortField: 'points'
    });

    expect(result.map((entry) => entry.number)).toEqual([1]);
  });
});
