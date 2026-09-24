import { describe, it, expect, vi } from 'vitest';
import { HackerNewsScraper } from '../src/services/HackerNewsScraper.js';

const buildEntryHtml = ({ id, rank, title, points, comments }) => {
  const scoreHtml =
    points !== undefined
      ? `<span class="score" id="score_${id}">${points} points</span> `
      : '';
  const commentsHtml =
    comments !== undefined
      ? ` | <a href="item?id=${id}">${comments}</a>`
      : '';

  return `
<tr class="athing submission" id="${id}">
  <td align="right" valign="top" class="title"><span class="rank">${rank}.</span></td>
  <td valign="top" class="votelinks"><center><a id="up_${id}" href="vote?id=${id}&amp;how=up"><div class="votearrow" title="upvote"></div></a></center></td>
  <td class="title">
    <span class="titleline">
      <a href="https://example.com/${id}">${title}</a>
      <span class="sitebit comhead"> (<a href="from?site=example.com"><span class="sitestr">example.com</span></a>)</span>
    </span>
  </td>
</tr>
<tr>
  <td colspan="2"></td>
  <td class="subtext">
    <span class="subline">
      ${scoreHtml}<a href="user?id=u${id}" class="hnuser">user${id}</a>
      <span class="age"><a href="item?id=${id}">2 hours ago</a></span>${commentsHtml}
    </span>
  </td>
</tr>
<tr class="spacer"><td colspan="4"><img height="1" src="s.gif" width="0"></td></tr>`;
};

const buildHtml = (entries) =>
  `<html><body><table border="0" cellpadding="0" cellspacing="0">${entries
    .map(buildEntryHtml)
    .join('')}</table></body></html>`;

const defaultEntries = [
  {
    id: 1,
    rank: 1,
    title: 'First story with a normal title',
    points: 250,
    comments: '120 comments'
  },
  {
    id: 2,
    rank: 2,
    title: 'This is - a self-explained example',
    points: 100,
    comments: '45 comments'
  },
  {
    id: 3,
    rank: 3,
    title: 'A job posting without score',
    comments: 'discuss'
  },
  {
    id: 4,
    rank: 4,
    title: 'Story with a single comment',
    points: 10,
    comments: '1 comment'
  },
  {
    id: 5,
    rank: 5,
    title: 'Story without any comments link',
    points: 5
  }
];

const generateEntries = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: 1000 + index,
    rank: index + 1,
    title: `Generated story number ${index + 1} with a decent title`,
    points: 50 + index,
    comments: `${index + 1} comments`
  }));

describe('HackerNewsScraper', () => {
  const scraper = new HackerNewsScraper();

  const API_BASE = 'https://hacker-news.firebaseio.com/v0';
  const TOPSTORIES_URL = `${API_BASE}/topstories.json`;

  const apiItemUrl = (id) => `${API_BASE}/item/${id}.json`;

  const json = (data, status = 200, statusText = 'OK') =>
    new Response(JSON.stringify(data), {
      status,
      statusText,
      headers: { 'content-type': 'application/json' }
    });

  const buildApiFetcher = ({
    html = () => null,
    ids = [11, 22, 33],
    items = {
      11: { id: 11, title: 'First API story', score: 100, descendants: 10 },
      22: { id: 22, title: 'Second API story', score: 50, descendants: 5 },
      33: { id: 33, title: 'Third API story', score: 25, descendants: 2 }
    },
    failingItems = []
  } = {}) =>
    vi.fn(async (url) => {
      if (url.startsWith(API_BASE)) {
        if (url === TOPSTORIES_URL) {
          return json(ids);
        }

        const id = Number(url.match(/\/item\/(\d+)\.json$/)?.[1]);

        if (failingItems.includes(id)) {
          return json({ error: 'not found' }, 404, 'Not Found');
        }

        return json(items[id] ?? null);
      }

      return html();
    });

  describe('parse', () => {
    it('returns exactly 30 entries when the HTML contains 32 athing rows', () => {
      const entries = scraper.parse(buildHtml(generateEntries(32)));

      expect(entries).toHaveLength(30);
    });

    it('assigns sequential ordinal numbers from 1 to 30', () => {
      const entries = scraper.parse(buildHtml(generateEntries(32)));

      expect(entries[0].number).toBe(1);
      expect(entries[29].number).toBe(30);
    });

    it('parses title, points and comments from a typical entry', () => {
      const entries = scraper.parse(buildHtml([defaultEntries[0]]));

      expect(entries[0]).toEqual({
        number: 1,
        title: 'First story with a normal title',
        points: 250,
        comments: 120
      });
    });

    it('returns each entry with exactly number, title, points and comments', () => {
      const entries = scraper.parse(buildHtml(defaultEntries));

      for (const entry of entries) {
        expect(Object.keys(entry)).toEqual([
          'number',
          'title',
          'points',
          'comments'
        ]);
        expect(entry).toEqual({
          number: expect.any(Number),
          title: expect.any(String),
          points: expect.any(Number),
          comments: expect.any(Number)
        });
      }
    });

    it('decodes HTML entities in titles', () => {
      const entries = scraper.parse(
        buildHtml([
          {
            id: 9,
            rank: 1,
            title: 'Show HN: A &amp; B &lt;C&gt; release',
            points: 1,
            comments: '0 comments'
          }
        ])
      );

      expect(entries[0].title).toBe('Show HN: A & B <C> release');
    });

    it('defaults points to 0 when the score is missing', () => {
      const entries = scraper.parse(buildHtml(defaultEntries));

      expect(entries[2].points).toBe(0);
    });

    it('defaults comments to 0 when the link text is "discuss"', () => {
      const entries = scraper.parse(buildHtml(defaultEntries));

      expect(entries[2].comments).toBe(0);
    });

    it('defaults comments to 0 when there is no comments link', () => {
      const entries = scraper.parse(buildHtml(defaultEntries));

      expect(entries[4].comments).toBe(0);
    });

    it('parses the singular form "1 comment"', () => {
      const entries = scraper.parse(buildHtml(defaultEntries));

      expect(entries[3].comments).toBe(1);
    });

    it('ignores age and hide links when parsing comments', () => {
      const entries = scraper.parse(buildHtml(defaultEntries));

      expect(entries[0].comments).toBe(120);
      expect(entries[1].comments).toBe(45);
    });

    it('returns an empty array for empty HTML', () => {
      expect(scraper.parse('')).toEqual([]);
    });
  });

  describe('scrape', () => {
    it('fetches the default Hacker News URL and parses the entries', async () => {
      const fetcher = vi.fn(async (url) => {
        expect(url).toBe('https://news.ycombinator.com/');
        return new Response(buildHtml(defaultEntries), { status: 200 });
      });
      const mockScraper = new HackerNewsScraper(fetcher);

      const entries = await mockScraper.scrape();

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(entries).toHaveLength(5);
      expect(entries[0].title).toBe('First story with a normal title');
    });

    it('scrapes a custom url when one is provided', async () => {
      const fetcher = vi.fn(
        async () => new Response(buildHtml(defaultEntries), { status: 200 })
      );
      const mockScraper = new HackerNewsScraper(fetcher);

      await mockScraper.scrape('https://example.com/news');

      expect(fetcher).toHaveBeenCalledWith('https://example.com/news');
    });

    it('throws an error when the response is not ok', async () => {
      const fetcher = async () =>
        new Response('Not Found', { status: 404, statusText: 'Not Found' });
      const mockScraper = new HackerNewsScraper(fetcher);

      await expect(mockScraper.scrape()).rejects.toThrow('404 Not Found');
      expect(mockScraper.lastSource).toBeNull();
    });

    it('falls back to the official HN API when the HTML fetch returns 419', async () => {
      const fetcher = buildApiFetcher({
        html: () => new Response('Sorry', { status: 419, statusText: 'Sorry' })
      });
      const mockScraper = new HackerNewsScraper(fetcher);

      const entries = await mockScraper.scrape();

      expect(fetcher).toHaveBeenCalledWith(TOPSTORIES_URL);
      expect(fetcher).toHaveBeenCalledWith(apiItemUrl(11));
      expect(entries).toHaveLength(3);
      expect(mockScraper.lastSource).toBe('api');
    });

    it('falls back to the official HN API when the fetch rejects with a network error', async () => {
      const fetcher = buildApiFetcher({
        html: () => {
          throw new TypeError('fetch failed');
        }
      });
      const mockScraper = new HackerNewsScraper(fetcher);

      const entries = await mockScraper.scrape();

      expect(entries).toHaveLength(3);
      expect(mockScraper.lastSource).toBe('api');
    });

    it('falls back to the official HN API when HTML parses to zero entries', async () => {
      const fetcher = buildApiFetcher({
        html: () =>
          new Response(
            '<html><body><div>HN changed its markup</div></body></html>',
            { status: 200 }
          )
      });
      const mockScraper = new HackerNewsScraper(fetcher);

      const entries = await mockScraper.scrape();

      expect(entries).toHaveLength(3);
      expect(mockScraper.lastSource).toBe('api');
    });

    it('uses the HTML source without calling the API when parsing succeeds', async () => {
      const fetcher = buildApiFetcher({
        html: () => new Response(buildHtml(defaultEntries), { status: 200 })
      });
      const mockScraper = new HackerNewsScraper(fetcher);

      const entries = await mockScraper.scrape();

      expect(entries).toHaveLength(5);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(mockScraper.lastSource).toBe('html');
    });

    it('throws a combined error when both the HTML and API sources fail', async () => {
      const fetcher = vi.fn(
        async () => new Response('Blocked', { status: 419, statusText: 'Sorry' })
      );
      const mockScraper = new HackerNewsScraper(fetcher);

      await expect(mockScraper.scrape()).rejects.toThrow(
        'Failed to fetch Hacker News from HTML and API. HTML: Failed to fetch Hacker News: 419 Sorry. API: Failed to fetch Hacker News API: 419 Sorry'
      );
      expect(mockScraper.lastSource).toBeNull();
    });

    it('maps API items to number, title, points and comments with 0 defaults', async () => {
      const fetcher = buildApiFetcher({
        html: () => new Response('Sorry', { status: 419, statusText: 'Sorry' }),
        ids: [11, 22, 33],
        items: {
          11: { id: 11, title: '  API story title  ', score: 321, descendants: 55 },
          22: { id: 22, title: 'API job without score' },
          33: {
            id: 33,
            title: 'API story with zero comments',
            score: 10,
            descendants: 0
          }
        }
      });
      const mockScraper = new HackerNewsScraper(fetcher);

      const entries = await mockScraper.scrape();

      expect(entries).toEqual([
        { number: 1, title: 'API story title', points: 321, comments: 55 },
        { number: 2, title: 'API job without score', points: 0, comments: 0 },
        { number: 3, title: 'API story with zero comments', points: 10, comments: 0 }
      ]);
    });

    it('skips deleted or failing API items and renumbers the survivors', async () => {
      const fetcher = buildApiFetcher({
        html: () => new Response('Sorry', { status: 419, statusText: 'Sorry' }),
        ids: [11, 22, 33],
        items: {
          11: { id: 11, title: 'First valid API story', score: 1, descendants: 2 },
          33: { id: 33, title: 'Second valid API story', score: 3, descendants: 4 }
        },
        failingItems: [22]
      });
      const mockScraper = new HackerNewsScraper(fetcher);

      const entries = await mockScraper.scrape();

      expect(entries).toEqual([
        { number: 1, title: 'First valid API story', points: 1, comments: 2 },
        { number: 2, title: 'Second valid API story', points: 3, comments: 4 }
      ]);
    });

    it('throws when the API returns no usable items', async () => {
      const fetcher = buildApiFetcher({
        html: () => new Response('Sorry', { status: 419, statusText: 'Sorry' }),
        ids: [11],
        items: { 11: null }
      });
      const mockScraper = new HackerNewsScraper(fetcher);

      await expect(mockScraper.scrape()).rejects.toThrow(
        'Failed to fetch Hacker News from HTML and API. HTML: Failed to fetch Hacker News: 419 Sorry. API: official HN API returned no usable items'
      );
    });
  });
});
