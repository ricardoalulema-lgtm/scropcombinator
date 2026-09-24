import { describe, it, expect, vi } from 'vitest';
import { handleFetch, handleScheduled } from '../src/worker.js';
import { WordCounter } from '../src/services/WordCounter.js';
import { MoreThanFiveWordsStrategy } from '../src/services/strategies/MoreThanFiveWordsStrategy.js';
import { LessOrEqualFiveWordsStrategy } from '../src/services/strategies/LessOrEqualFiveWordsStrategy.js';

const entriesFixture = [
  { number: 1, title: 'Short title here', points: 300, comments: 40 },
  {
    number: 2,
    title: 'This is - a self-explained example',
    points: 250,
    comments: 100
  },
  {
    number: 3,
    title: 'A much longer title with more than five words total',
    points: 120,
    comments: 250
  }
];

const buildServices = (config = { cron_enabled: true, cron_expression: '0 */2 * * *' }) => {
  const wordCounter = new WordCounter();

  return {
    scraper: { scrape: vi.fn(async () => entriesFixture) },
    wordCounter,
    strategies: {
      MORE_THAN_5_WORDS_BY_COMMENTS: new MoreThanFiveWordsStrategy(wordCounter),
      LESS_OR_EQUAL_5_WORDS_BY_POINTS: new LessOrEqualFiveWordsStrategy(wordCounter)
    },
    repository: {
      saveUsageLog: vi.fn(async () => 'log-1'),
      saveEntries: vi.fn(async () => 'latest'),
      getSystemConfig: vi.fn(async () => ({ ...config })),
      updateSystemConfig: vi.fn(async (payload) => ({ ...config, ...payload }))
    }
  };
};

describe('worker - fetch handler', () => {
  it('returns service info on GET /', async () => {
    const response = await handleFetch(new Request('http://localhost/'), buildServices());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.service).toBe('hacker-news-scraper');
    expect(body.status).toBe('ok');
  });

  it('answers OPTIONS with CORS headers', async () => {
    const response = await handleFetch(
      new Request('http://localhost/api/entries', { method: 'OPTIONS' }),
      buildServices()
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('rejects an unknown filter with 400 and the valid filter list', async () => {
    const services = buildServices();
    const response = await handleFetch(
      new Request('http://localhost/api/entries?filter=TOTO'),
      services
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Unknown filter "TOTO"');
    expect(body.valid_filters).toEqual([
      'MORE_THAN_5_WORDS_BY_COMMENTS',
      'LESS_OR_EQUAL_5_WORDS_BY_POINTS'
    ]);
    expect(services.scraper.scrape).not.toHaveBeenCalled();
  });

  it('runs MORE_THAN_5_WORDS_BY_COMMENTS: scrapes, filters, sorts by comments and audits as MANUAL', async () => {
    const services = buildServices();
    const response = await handleFetch(
      new Request(
        'http://localhost/api/entries?filter=MORE_THAN_5_WORDS_BY_COMMENTS'
      ),
      services
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(services.scraper.scrape).toHaveBeenCalledTimes(1);
    expect(body.filter).toBe('MORE_THAN_5_WORDS_BY_COMMENTS');
    expect(body.results_count).toBe(1);
    expect(body.results[0].number).toBe(3);
    expect(body.log_id).toBe('log-1');
    expect(body.execution_time_ms).toBeGreaterThanOrEqual(0);

    expect(services.repository.saveUsageLog).toHaveBeenCalledWith(
      expect.objectContaining({
        filter_applied: 'MORE_THAN_5_WORDS_BY_COMMENTS',
        results_count: 1,
        execution_type: 'MANUAL',
        execution_time_ms: expect.any(Number),
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
      })
    );
  });

  it('runs LESS_OR_EQUAL_5_WORDS_BY_POINTS: filters and sorts by points desc', async () => {
    const services = buildServices();
    const response = await handleFetch(
      new Request(
        'http://localhost/api/entries?filter=LESS_OR_EQUAL_5_WORDS_BY_POINTS'
      ),
      services
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results_count).toBe(2);
    expect(body.results.map((entry) => entry.number)).toEqual([1, 2]);
    expect(body.results.map((entry) => entry.points)).toEqual([300, 250]);
    expect(services.repository.saveUsageLog).toHaveBeenCalledWith(
      expect.objectContaining({
        filter_applied: 'LESS_OR_EQUAL_5_WORDS_BY_POINTS',
        execution_type: 'MANUAL'
      })
    );
  });

  it('scrapes and saves entries on GET /api/scrape with reason "(manual)"', async () => {
    const services = buildServices();
    const response = await handleFetch(
      new Request('http://localhost/api/scrape'),
      services
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(services.repository.saveEntries).toHaveBeenCalledWith(entriesFixture);
    expect(body).toEqual({
      doc_id: 'latest',
      entries_count: 3,
      execution_time_ms: expect.any(Number),
      log_id: 'log-1',
      filter_applied: 'Scraping and save entries (manual)'
    });
    expect(services.repository.saveUsageLog).toHaveBeenCalledWith(
      expect.objectContaining({
        filter_applied: 'Scraping and save entries (manual)',
        results_count: 3,
        execution_type: 'MANUAL'
      })
    );
  });

  it('returns the system config on GET /api/config', async () => {
    const services = buildServices();
    const response = await handleFetch(
      new Request('http://localhost/api/config'),
      services
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      cron_enabled: true,
      cron_expression: '0 */2 * * *'
    });
  });

  it('updates the system config on PUT /api/config', async () => {
    const services = buildServices();
    const response = await handleFetch(
      new Request('http://localhost/api/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cron_enabled: false })
      }),
      services
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(services.repository.updateSystemConfig).toHaveBeenCalledWith({
      cron_enabled: false
    });
    expect(body).toEqual({
      cron_enabled: false,
      cron_expression: '0 */2 * * *'
    });
  });

  it('rejects an invalid JSON body on PUT /api/config with 400', async () => {
    const response = await handleFetch(
      new Request('http://localhost/api/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: 'not-json'
      }),
      buildServices()
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Request body must be valid JSON');
  });

  it('returns 404 for unknown routes', async () => {
    const response = await handleFetch(
      new Request('http://localhost/api/unknown'),
      buildServices()
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toContain('Route not found');
  });

  it('returns 500 with the error message when a service fails', async () => {
    const services = buildServices();
    services.scraper.scrape.mockRejectedValueOnce(new Error('HN is down'));

    const response = await handleFetch(
      new Request('http://localhost/api/scrape'),
      services
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'HN is down' });
  });
});

describe('worker - scheduled handler', () => {
  it('scrapes, saves entries and audits as SCHEDULED with reason "(each 2 h)"', async () => {
    const services = buildServices({
      cron_enabled: true,
      cron_expression: '0 */2 * * *'
    });

    const result = await handleScheduled(services);

    expect(services.scraper.scrape).toHaveBeenCalledTimes(1);
    expect(services.repository.saveEntries).toHaveBeenCalledWith(entriesFixture);
    expect(services.repository.saveUsageLog).toHaveBeenCalledWith(
      expect.objectContaining({
        filter_applied: 'Scraping and save entries (each 2 h)',
        results_count: 3,
        execution_type: 'SCHEDULED',
        execution_time_ms: expect.any(Number)
      })
    );
    expect(result).toEqual({
      skipped: false,
      entries_count: 3,
      execution_time_ms: expect.any(Number),
      log_id: 'log-1',
      filter_applied: 'Scraping and save entries (each 2 h)'
    });
  });

  it('describes hourly cron expressions as "each N h"', async () => {
    const services = buildServices({
      cron_enabled: true,
      cron_expression: '0 */6 * * *'
    });

    const result = await handleScheduled(services);

    expect(result.filter_applied).toBe('Scraping and save entries (each 6 h)');
  });

  it('skips the execution when cron_enabled is false', async () => {
    const services = buildServices({
      cron_enabled: false,
      cron_expression: '0 */2 * * *'
    });

    const result = await handleScheduled(services);

    expect(result).toEqual({ skipped: true, reason: 'cron_disabled' });
    expect(services.scraper.scrape).not.toHaveBeenCalled();
    expect(services.repository.saveEntries).not.toHaveBeenCalled();
    expect(services.repository.saveUsageLog).not.toHaveBeenCalled();
  });
});
