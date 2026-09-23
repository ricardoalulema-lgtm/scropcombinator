import { load } from 'cheerio';

const DEFAULT_URL = 'https://news.ycombinator.com/';
const MAX_ENTRIES = 30;

const parsePoints = (scoreText) => {
  const match = scoreText.match(/(\d+)\s+points?/);
  return match ? Number.parseInt(match[1], 10) : 0;
};

const parseComments = (linkTexts) => {
  for (const text of linkTexts) {
    const match = text.trim().match(/^(\d+)\s+comments?$/);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }
  return 0;
};

export class HackerNewsScraper {
  constructor(fetcher = (url) => globalThis.fetch(url)) {
    this.fetcher = fetcher;
  }

  async scrape(url = DEFAULT_URL) {
    const html = await this.fetchHtml(url);
    return this.parse(html);
  }

  async fetchHtml(url) {
    const response = await this.fetcher(url);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Hacker News: ${response.status} ${response.statusText}`
      );
    }

    return response.text();
  }

  parse(html) {
    const $ = load(html);
    const rows = $('tr.athing').toArray();
    const entries = [];

    for (const row of rows) {
      if (entries.length >= MAX_ENTRIES) {
        break;
      }

      const $row = $(row);
      const $subtext = $row.next('tr').find('.subtext');
      const linkTexts = $subtext
        .find('a')
        .toArray()
        .map((link) => $(link).text());

      entries.push({
        number: entries.length + 1,
        title: $row.find('.titleline > a').first().text().trim(),
        points: parsePoints($subtext.find('.score').text()),
        comments: parseComments(linkTexts)
      });
    }

    return entries;
  }
}
