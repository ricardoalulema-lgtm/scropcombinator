import { load } from 'cheerio';

const DEFAULT_URL = 'https://news.ycombinator.com/';
const API_BASE_URL = 'https://hacker-news.firebaseio.com/v0';
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
    this.lastSource = null;
  }

  async scrape(url = DEFAULT_URL) {
    let htmlError = null;

    try {
      const html = await this.fetchHtml(url);
      const entries = this.parse(html);

      if (entries.length > 0) {
        this.lastSource = 'html';
        return entries;
      }

      htmlError = new Error('HTML parsed to zero entries');
    } catch (error) {
      htmlError = error;
    }

    console.log(
      `[scraper] HTML source unavailable (${htmlError.message}); using official HN API`
    );

    try {
      const entries = await this.scrapeViaApi();
      this.lastSource = 'api';
      return entries;
    } catch (apiError) {
      this.lastSource = null;
      throw new Error(
        `Failed to fetch Hacker News from HTML and API. HTML: ${htmlError.message}. API: ${apiError.message}`
      );
    }
  }

  async scrapeViaApi() {
    const ids = await this.fetchJson(`${API_BASE_URL}/topstories.json`);

    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('official HN API returned no top story ids');
    }

    const topIds = ids.slice(0, MAX_ENTRIES);
    const settled = await Promise.allSettled(
      topIds.map((id) => this.fetchJson(`${API_BASE_URL}/item/${id}.json`))
    );

    const entries = [];

    for (const result of settled) {
      if (entries.length >= MAX_ENTRIES) {
        break;
      }

      if (result.status !== 'fulfilled') {
        continue;
      }

      const item = result.value;

      if (!item || typeof item.title !== 'string' || !item.title.trim()) {
        continue;
      }

      entries.push({
        number: entries.length + 1,
        title: item.title.trim(),
        points: Number.isFinite(item.score) ? item.score : 0,
        comments: Number.isFinite(item.descendants) ? item.descendants : 0
      });
    }

    if (entries.length === 0) {
      throw new Error('official HN API returned no usable items');
    }

    return entries;
  }

  async fetchJson(url) {
    const response = await this.fetcher(url);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Hacker News API: ${response.status} ${response.statusText}`
      );
    }

    return response.json();
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
