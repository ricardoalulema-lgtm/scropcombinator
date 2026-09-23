import { FilterStrategy } from './FilterStrategy.js';

const MAX_WORD_COUNT = 5;

export class LessOrEqualFiveWordsStrategy extends FilterStrategy {
  constructor(wordCounter) {
    super('LESS_OR_EQUAL_5_WORDS_BY_POINTS');
    this.wordCounter = wordCounter;
  }

  apply(entries) {
    return entries
      .filter((entry) => this.wordCounter.count(entry.title) <= MAX_WORD_COUNT)
      .sort((a, b) => b.points - a.points);
  }
}
