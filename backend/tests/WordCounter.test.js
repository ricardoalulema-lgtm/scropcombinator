import { describe, it, expect } from 'vitest';
import { WordCounter } from '../src/services/WordCounter.js';

describe('WordCounter', () => {
  const wordCounter = new WordCounter();

  it('counts exactly 5 words for "This is - a self-explained example" (excludes the isolated symbol)', () => {
    expect(wordCounter.count('This is - a self-explained example')).toBe(5);
  });

  it('counts words separated by multiple whitespace characters (tabs, newlines)', () => {
    expect(wordCounter.count('Hello   world\tfoo\nbar')).toBe(4);
  });

  it('counts hyphenated compound words as a single word', () => {
    expect(wordCounter.count('self-explained')).toBe(1);
    expect(wordCounter.count('a state-of-the-art solution')).toBe(3);
  });

  it('counts words containing numbers', () => {
    expect(wordCounter.count('Top 10 news of 2026')).toBe(5);
  });

  it('excludes isolated symbols and punctuation from the count', () => {
    expect(wordCounter.count('Word - another # one + two')).toBe(4);
  });

  it('returns 0 for an empty or whitespace-only string', () => {
    expect(wordCounter.count('')).toBe(0);
    expect(wordCounter.count('    ')).toBe(0);
  });

  it('returns 0 for a string made of isolated symbols only', () => {
    expect(wordCounter.count('- -- ## .')).toBe(0);
  });

  it('returns 0 for null or undefined input', () => {
    expect(wordCounter.count(null)).toBe(0);
    expect(wordCounter.count(undefined)).toBe(0);
  });

  it('trims leading and trailing whitespace before counting', () => {
    expect(wordCounter.count('   Show HN: I built this   ')).toBe(5);
  });
});
