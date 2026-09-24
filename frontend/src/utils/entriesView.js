const WORD_SEPARATOR = /\s+/;
const ISOLATED_SYMBOL = /^[^\p{L}\p{N}]+$/u;

export const countWords = (title) => {
  if (typeof title !== 'string' || title.trim().length === 0) {
    return 0;
  }

  return title
    .trim()
    .split(WORD_SEPARATOR)
    .filter((token) => !ISOLATED_SYMBOL.test(token))
    .length;
};

export const filterByText = (entries, text) => {
  const query = String(text ?? '')
    .trim()
    .toLowerCase();

  if (!query) {
    return entries;
  }

  return entries.filter((entry) => String(entry.title).toLowerCase().includes(query));
};

export const filterByWordCount = (entries, wordCount) => {
  if (wordCount === null || wordCount === undefined || wordCount === '') {
    return entries;
  }

  const target = Number(wordCount);

  if (!Number.isFinite(target)) {
    return entries;
  }

  return entries.filter((entry) => countWords(entry.title) === target);
};

export const sortByField = (entries, field) => {
  if (field !== 'points' && field !== 'comments') {
    return entries;
  }

  return [...entries].sort((a, b) => Number(b[field]) - Number(a[field]));
};

export const applyViewOptions = (entries, { text = '', wordCount = null, sortField = null } = {}) => {
  let next = filterByText(entries, text);
  next = filterByWordCount(next, wordCount);

  if (sortField) {
    next = sortByField(next, sortField);
  }

  return next;
};
