import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleFetch, handleScheduled } from '../src/worker.js';
import { createSessionToken } from '../src/utils/sessionToken.js';
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

const buildServices = (
  config = {
    cron_enabled: true,
    cron_expression: '0 */2 * * *',
    frequency_hours: 2,
    last_run_hour: null
  }
) => {
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
      cron_expression: '0 */2 * * *',
      frequency_hours: 2,
      last_run_hour: null
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
      cron_expression: '0 */2 * * *',
      frequency_hours: 2,
      last_run_hour: null
    });
  });

  it('updates the system config on PUT /api/config and anchors last_run_hour', async () => {
    const services = buildServices();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T15:30:00.000Z'));

    try {
      const response = await handleFetch(
        new Request('http://localhost/api/config', {
          method: 'PUT',
          headers: authHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify({ cron_enabled: false, frequency_hours: 4 })
        }),
        services
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(services.repository.updateSystemConfig).toHaveBeenCalledWith({
        cron_enabled: false,
        frequency_hours: 4,
        last_run_hour: '2026-09-24T15'
      });
      expect(body).toEqual({
        cron_enabled: false,
        frequency_hours: 4,
        cron_expression: '0 */2 * * *',
        last_run_hour: '2026-09-24T15'
      });
    } finally {
      vi.useRealTimers();
    }
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

  it('saves an ORDER usage log via POST /api/logs', async () => {
    const services = buildServices();
    const response = await handleFetch(
      new Request('http://localhost/api/logs', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          timestamp: '2026-09-24T10:00:00.000Z',
          filter_applied: 'Order by points',
          results_count: 3,
          execution_type: 'ORDER',
          execution_time_ms: 1
        })
      }),
      services
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ log_id: 'log-1', filter_applied: 'Order by points' });
    expect(services.repository.saveUsageLog).toHaveBeenCalledWith(
      expect.objectContaining({
        timestamp: '2026-09-24T10:00:00.000Z',
        filter_applied: 'Order by points',
        results_count: 3,
        execution_type: 'ORDER',
        execution_time_ms: 1
      })
    );
  });

  it('saves a SEARCH usage log via POST /api/logs', async () => {
    const services = buildServices();
    const response = await handleFetch(
      new Request('http://localhost/api/logs', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          filter_applied: 'filter by 5 words',
          results_count: 2,
          execution_type: 'SEARCH',
          execution_time_ms: 0
        })
      }),
      services
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(services.repository.saveUsageLog).toHaveBeenCalledWith(
      expect.objectContaining({
        filter_applied: 'filter by 5 words',
        results_count: 2,
        execution_type: 'SEARCH',
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
      })
    );
    expect(body.log_id).toBe('log-1');
  });

  it('rejects POST /api/logs with invalid JSON', async () => {
    const services = buildServices();
    const response = await handleFetch(
      new Request('http://localhost/api/logs', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: '{not-json'
      }),
      services
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('valid JSON');
    expect(services.repository.saveUsageLog).not.toHaveBeenCalled();
  });

  it('requires the API key on POST /api/logs', async () => {
    const services = buildServices();
    const response = await handleFetch(
      new Request('http://localhost/api/logs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ execution_type: 'ORDER', filter_applied: 'Order by points' })
      }),
      services
    );

    expect(response.status).toBe(401);
    expect(services.repository.saveUsageLog).not.toHaveBeenCalled();
  });
});

describe('worker - session tokens', () => {
  it('issues a bearer token from POST /api/session without credentials', async () => {
    const response = await handleFetch(
      new Request('http://localhost/api/session', { method: 'POST' }),
      buildServices()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.token).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(900);
    expect(body.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns 429 when the rate limiter rejects the session request', async () => {
    const services = buildServices();
    services.sessionRateLimiter = {
      limit: vi.fn(async () => ({ success: false }))
    };

    const response = await handleFetch(
      new Request('http://localhost/api/session', { method: 'POST' }),
      services
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toContain('Too many session requests');
    expect(services.sessionRateLimiter.limit).toHaveBeenCalledWith({
      key: 'unknown'
    });
  });

  it('passes the client IP to the rate limiter and issues the token', async () => {
    const services = buildServices();
    services.sessionRateLimiter = {
      limit: vi.fn(async () => ({ success: true }))
    };

    const response = await handleFetch(
      new Request('http://localhost/api/session', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '203.0.113.7' }
      }),
      services
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(services.sessionRateLimiter.limit).toHaveBeenCalledWith({
      key: '203.0.113.7'
    });
    expect(body.token).toMatch(/^\d+\.[0-9a-f]{64}$/);
  });

  it('accepts a valid session token via Authorization Bearer', async () => {
    const { token } = await createSessionToken(API_KEY);
    const response = await handleFetch(
      new Request('http://localhost/api/entries?filter=NO_FILTER', {
        headers: { authorization: `Bearer ${token}` }
      }),
      buildServices()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results).toEqual(entriesFixture);
  });

  it('rejects an expired session token with 401', async () => {
    const { token } = await createSessionToken(API_KEY, -10);
    const services = buildServices();

    const response = await handleFetch(
      new Request('http://localhost/api/entries?filter=NO_FILTER', {
        headers: { authorization: `Bearer ${token}` }
      }),
      services
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toContain('Unauthorized');
    expect(services.scraper.scrape).not.toHaveBeenCalled();
  });

  it('rejects a tampered session token with 401', async () => {
    const { token } = await createSessionToken(API_KEY);
    const tampered = `${token.slice(0, -1)}${token.at(-1) === 'a' ? 'b' : 'a'}`;

    const response = await handleFetch(
      new Request('http://localhost/api/entries?filter=NO_FILTER', {
        headers: { authorization: `Bearer ${tampered}` }
      }),
      buildServices()
    );

    expect(response.status).toBe(401);
  });

  it('fails closed with 500 when the server has no API key to sign tokens', async () => {
    const services = buildServices();
    services.apiKey = undefined;

    const response = await handleFetch(
      new Request('http://localhost/api/session', { method: 'POST' }),
      services
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain('API key is not configured');
  });

  it('still accepts the legacy static key sent in x-api-key', async () => {
    const response = await handleFetch(
      new Request('http://localhost/api/config', { headers: authHeaders() }),
      buildServices()
    );

    expect(response.status).toBe(200);
  });
});

describe('worker - scheduled handler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T15:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs on first execution (no last_run_hour) and audits as "(each 2 h)"', async () => {
    const services = buildServices({
      cron_enabled: true,
      cron_expression: '0 */2 * * *',
      frequency_hours: 2,
      last_run_hour: null
    });

    const result = await handleScheduled(services);

    expect(services.scraper.scrape).toHaveBeenCalledTimes(1);
    expect(services.repository.saveEntries).toHaveBeenCalledWith(entriesFixture);
    expect(services.repository.updateSystemConfig).toHaveBeenCalledWith({
      last_run_hour: '2026-09-24T15'
    });
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
      filter_applied: 'Scraping and save entries (each 2 h)',
      last_run_hour: '2026-09-24T15'
    });
  });

  it('skips when frequency_hours have not elapsed since last_run_hour', async () => {
    const services = buildServices({
      cron_enabled: true,
      frequency_hours: 2,
      last_run_hour: '2026-09-24T14'
    });

    const result = await handleScheduled(services);

    expect(result).toEqual({
      skipped: true,
      reason: 'frequency_not_reached',
      frequency_hours: 2,
      last_run_hour: '2026-09-24T14',
      current_hour: '2026-09-24T15'
    });
    expect(services.scraper.scrape).not.toHaveBeenCalled();
    expect(services.repository.saveUsageLog).not.toHaveBeenCalled();
  });

  it('runs when frequency_hours have elapsed since last_run_hour', async () => {
    const services = buildServices({
      cron_enabled: true,
      frequency_hours: 2,
      last_run_hour: '2026-09-24T13'
    });

    const result = await handleScheduled(services);

    expect(result.skipped).toBe(false);
    expect(services.scraper.scrape).toHaveBeenCalledTimes(1);
    expect(services.repository.updateSystemConfig).toHaveBeenCalledWith({
      last_run_hour: '2026-09-24T15'
    });
  });

  it('runs across midnight when frequency_hours have elapsed', async () => {
    vi.setSystemTime(new Date('2026-09-25T01:00:00.000Z'));
    const services = buildServices({
      cron_enabled: true,
      frequency_hours: 2,
      last_run_hour: '2026-09-24T23'
    });

    const result = await handleScheduled(services);

    expect(result.skipped).toBe(false);
    expect(services.repository.updateSystemConfig).toHaveBeenCalledWith({
      last_run_hour: '2026-09-25T01'
    });
  });

  it('uses frequency_hours for the audit label', async () => {
    const services = buildServices({
      cron_enabled: true,
      cron_expression: '0 */6 * * *',
      frequency_hours: 6,
      last_run_hour: null
    });

    const result = await handleScheduled(services);

    expect(result.filter_applied).toBe('Scraping and save entries (each 6 h)');
  });

  it('skips the execution when cron_enabled is false', async () => {
    const services = buildServices({
      cron_enabled: false,
      cron_expression: '0 */2 * * *',
      frequency_hours: 2,
      last_run_hour: null
    });

    const result = await handleScheduled(services);

    expect(result).toEqual({ skipped: true, reason: 'cron_disabled' });
    expect(services.scraper.scrape).not.toHaveBeenCalled();
    expect(services.repository.saveEntries).not.toHaveBeenCalled();
    expect(services.repository.saveUsageLog).not.toHaveBeenCalled();
  });
});
