import { describe, it, expect, vi } from 'vitest';
import { handleFetch, handleScheduled } from '../src/worker.js';
import { WordCounter } from '../src/services/WordCounter.js';
import { MoreThanFiveWordsStrategy } from '../src/services/strategies/MoreThanFiveWordsStrategy.js';
import { LessOrEqualFiveWordsStrategy } from '../src/services/strategies/LessOrEqualFiveWordsStrategy.js';

const API_KEY = 'test-static-api-key';

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
    },
    apiKey: API_KEY
  };
};

const authHeaders = (extra = {}) => ({ 'x-api-key': API_KEY, ...extra });

describe('worker - fetch handler', () => {
  it('returns service info on GET / with a valid API key', async () => {
    const response = await handleFetch(
      new Request('http://localhost/', { headers: authHeaders() }),
      buildServices()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.service).toBe('hacker-news-scraper');
    expect(body.status).toBe('ok');
  });

  it('answers OPTIONS with CORS headers without requiring an API key', async () => {
    const response = await handleFetch(
      new Request('http://localhost/api/entries', { method: 'OPTIONS' }),
      buildServices()
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-headers')).toContain('x-api-key');
  });

  it('rejects any request without an API key with 401', async () => {
    const services = buildServices();

    const getResponse = await handleFetch(
      new Request('http://localhost/api/entries?filter=MORE_THAN_5_WORDS_BY_COMMENTS'),
      services
    );
    const putResponse = await handleFetch(
      new Request('http://localhost/api/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cron_enabled: false })
      }),
      services
    );

    const getBody = await getResponse.json();
    const putBody = await putResponse.json();

    expect(getResponse.status).toBe(401);
    expect(getBody.error).toContain('Unauthorized');
    expect(putResponse.status).toBe(401);
    expect(putBody.error).toContain('Unauthorized');
    expect(services.scraper.scrape).not.toHaveBeenCalled();
    expect(services.repository.updateSystemConfig).not.toHaveBeenCalled();
  });

  it('rejects an invalid API key with 401', async () => {
    const services = buildServices();
    const response = await handleFetch(
      new Request('http://localhost/api/config', {
        headers: { 'x-api-key': 'wrong-key' }
      }),
      services
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toContain('Unauthorized');
    expect(services.repository.getSystemConfig).not.toHaveBeenCalled();
  });

  it('accepts the API key via Authorization Bearer header', async () => {
    const response = await handleFetch(
      new Request('http://localhost/api/config', {
        headers: { authorization: `Bearer ${API_KEY}` }
      }),
      buildServices()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      cron_enabled: true,
      cron_expression: '0 */2 * * *'
    });
  });

  it('returns 500 when the server has no API key configured', async () => {
    const services = buildServices();
    services.apiKey = undefined;

    const response = await handleFetch(
      new Request('http://localhost/api/config', { headers: authHeaders() }),
      services
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('API key is not configured on the server');
    expect(services.repository.getSystemConfig).not.toHaveBeenCalled();
  });

  it('rejects an unknown filter with 400 and the valid filter list', async () => {
    const services = buildServices();
    const response = await handleFetch(
      new Request('http://localhost/api/entries?filter=TOTO', { headers: authHeaders() }),
      services
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Unknown filter "TOTO"');
    expect(body.valid_filters).toEqual([
      'NO_FILTER',
      'MORE_THAN_5_WORDS_BY_COMMENTS',
      'LESS_OR_EQUAL_5_WORDS_BY_POINTS'
    ]);
    expect(services.scraper.scrape).not.toHaveBeenCalled();
  });

  it('returns all entries unfiltered on NO_FILTER and audits as NO_FILTER', async () => {
    const services = buildServices();
    const response = await handleFetch(
      new Request('http://localhost/api/entries?filter=NO_FILTER', { headers: authHeaders() }),
      services
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.filter).toBe('NO_FILTER');
    expect(body.results_count).toBe(3);
    expect(body.results).toEqual(entriesFixture);
    expect(services.repository.saveUsageLog).toHaveBeenCalledWith(
      expect.objectContaining({
        filter_applied: 'NO_FILTER',
        results_count: 3,
        execution_type: 'MANUAL'
      })
    );
  });

  it('runs MORE_THAN_5_WORDS_BY_COMMENTS: scrapes, filters, sorts by comments and audits as MANUAL', async () => {
    const services = buildServices();
    const response = await handleFetch(
      new Request(
        'http://localhost/api/entries?filter=MORE_THAN_5_WORDS_BY_COMMENTS',
        { headers: authHeaders() }
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
        'http://localhost/api/entries?filter=LESS_OR_EQUAL_5_WORDS_BY_POINTS',
        { headers: authHeaders() }
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
      new Request('http://localhost/api/scrape', { headers: authHeaders() }),
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
      new Request('http://localhost/api/config', { headers: authHeaders() }),
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
        headers: authHeaders({ 'content-type': 'application/json' }),
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
        headers: authHeaders({ 'content-type': 'application/json' }),
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
      new Request('http://localhost/api/unknown', { headers: authHeaders() }),
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
      new Request('http://localhost/api/scrape', { headers: authHeaders() }),
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
