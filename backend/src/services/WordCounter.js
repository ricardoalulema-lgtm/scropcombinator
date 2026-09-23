const WORD_SEPARATOR = /\s+/;
const ISOLATED_SYMBOL = /^[^\p{L}\p{N}]+$/u;

export class WordCounter {
  count(title) {
    if (typeof title !== 'string' || title.trim().length === 0) {
      return 0;
    }

    return title
      .trim()
      .split(WORD_SEPARATOR)
      .filter((token) => !ISOLATED_SYMBOL.test(token))
      .length;
  }
}
