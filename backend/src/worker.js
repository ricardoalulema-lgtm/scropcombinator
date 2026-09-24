import { HackerNewsScraper } from './services/HackerNewsScraper.js';
import { WordCounter } from './services/WordCounter.js';
import { MoreThanFiveWordsStrategy } from './services/strategies/MoreThanFiveWordsStrategy.js';
import { LessOrEqualFiveWordsStrategy } from './services/strategies/LessOrEqualFiveWordsStrategy.js';
import { FirestoreRestRepository } from './repositories/FirestoreRestRepository.js';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
  'access-control-allow-headers': 'content-type'
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...CORS_HEADERS
    }
  });

const buildSaveReason = (executionType, frequencyLabel) =>
  executionType === 'SCHEDULED'
    ? `Scraping and save entries (${frequencyLabel})`
    : 'Scraping and save entries (manual)';

const describeFrequency = (cronExpression) => {
  const hourlyMatch = /^0 \*\/(\d{1,3}) \* \* \*$/.exec(cronExpression ?? '');

  if (hourlyMatch) {
    return `each ${hourlyMatch[1]} h`;
  }

  return cronExpression ?? 'custom';
};

export const createServices = (env = {}) => {
  const repository = new FirestoreRestRepository({
    projectId: env.FIREBASE_PROJECT_ID,
    apiKey: env.FIREBASE_API_KEY
  });
  const wordCounter = new WordCounter();

  return {
    scraper: new HackerNewsScraper(),
    wordCounter,
    strategies: {
      MORE_THAN_5_WORDS_BY_COMMENTS: new MoreThanFiveWordsStrategy(wordCounter),
      LESS_OR_EQUAL_5_WORDS_BY_POINTS: new LessOrEqualFiveWordsStrategy(wordCounter)
    },
    repository
  };
};

const handleEntriesQuery = async (url, services) => {
  const filterId = url.searchParams.get('filter');
  const strategy = services.strategies[filterId];

  if (!strategy) {
    return json(
      {
        error: `Unknown filter "${filterId}"`,
        valid_filters: Object.keys(services.strategies)
      },
      400
    );
  }

  const startedAt = performance.now();
  const entries = await services.scraper.scrape();
  const results = strategy.apply(entries);
  const executionTimeMs = Math.round(performance.now() - startedAt);

  const logId = await services.repository.saveUsageLog({
    timestamp: new Date().toISOString(),
    filter_applied: filterId,
    results_count: results.length,
    execution_type: 'MANUAL',
    execution_time_ms: executionTimeMs
  });

  return json({
    filter: filterId,
    results_count: results.length,
    execution_time_ms: executionTimeMs,
    log_id: logId,
    results
  });
};

const handleManualScrape = async (services) => {
  const startedAt = performance.now();
  const entries = await services.scraper.scrape();
  const docId = await services.repository.saveEntries(entries);
  const executionTimeMs = Math.round(performance.now() - startedAt);

  const filterApplied = buildSaveReason('MANUAL');
  const logId = await services.repository.saveUsageLog({
    timestamp: new Date().toISOString(),
    filter_applied: filterApplied,
    results_count: entries.length,
    execution_type: 'MANUAL',
    execution_time_ms: executionTimeMs
  });

  return json({
    doc_id: docId,
    entries_count: entries.length,
    execution_time_ms: executionTimeMs,
    log_id: logId,
    filter_applied: filterApplied
  });
};

const handleGetConfig = async (services) => {
  const config = await services.repository.getSystemConfig();
  return json(config);
};

const handleUpdateConfig = async (request, services) => {
  let payload;

  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON' }, 400);
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return json({ error: 'Request body must be a JSON object' }, 400);
  }

  const config = await services.repository.updateSystemConfig(payload);
  return json(config);
};

export const handleFetch = async (request, services) => {
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'GET' && pathname === '/') {
      return json({
        service: 'hacker-news-scraper',
        status: 'ok',
        endpoints: [
          'GET /api/entries?filter=<FILTER_ID>',
          'GET /api/scrape',
          'GET /api/config',
          'PUT /api/config'
        ]
      });
    }

    if (request.method === 'GET' && pathname === '/api/entries') {
      return await handleEntriesQuery(url, services);
    }

    if (request.method === 'GET' && pathname === '/api/scrape') {
      return await handleManualScrape(services);
    }

    if (pathname === '/api/config') {
      if (request.method === 'GET') {
        return await handleGetConfig(services);
      }

      if (request.method === 'PUT' || request.method === 'POST') {
        return await handleUpdateConfig(request, services);
      }
    }

    return json({ error: `Route not found: ${request.method} ${pathname}` }, 404);
  } catch (error) {
    return json({ error: error.message }, 500);
  }
};

export const handleScheduled = async (services) => {
  const config = await services.repository.getSystemConfig();

  if (!config.cron_enabled) {
    console.log('[scheduled] skipped: cron_enabled is false');
    return { skipped: true, reason: 'cron_disabled' };
  }

  const frequencyLabel = describeFrequency(config.cron_expression);
  const startedAt = performance.now();
  const entries = await services.scraper.scrape();
  await services.repository.saveEntries(entries);
  const executionTimeMs = Math.round(performance.now() - startedAt);

  const filterApplied = buildSaveReason('SCHEDULED', frequencyLabel);
  const logId = await services.repository.saveUsageLog({
    timestamp: new Date().toISOString(),
    filter_applied: filterApplied,
    results_count: entries.length,
    execution_type: 'SCHEDULED',
    execution_time_ms: executionTimeMs
  });

  const result = {
    skipped: false,
    entries_count: entries.length,
    execution_time_ms: executionTimeMs,
    log_id: logId,
    filter_applied: filterApplied
  };

  console.log('[scheduled]', result);
  return result;
};

export default {
  async fetch(request, env, ctx) {
    return handleFetch(request, createServices(env));
  },

  async scheduled(event, env, ctx) {
    return handleScheduled(createServices(env));
  }
};
