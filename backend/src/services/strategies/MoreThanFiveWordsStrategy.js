import { FilterStrategy } from './FilterStrategy.js';

const MIN_WORD_COUNT = 5;

export class MoreThanFiveWordsStrategy extends FilterStrategy {
  constructor(wordCounter) {
    super('MORE_THAN_5_WORDS_BY_COMMENTS');
    this.wordCounter = wordCounter;
  }

  apply(entries) {
    return entries
      .filter((entry) => this.wordCounter.count(entry.title) > MIN_WORD_COUNT)
      .sort((a, b) => b.comments - a.comments);
  }
}
