import { HackerNewsScraper } from './services/HackerNewsScraper.js';
import { WordCounter } from './services/WordCounter.js';
import { MoreThanFiveWordsStrategy } from './services/strategies/MoreThanFiveWordsStrategy.js';
import { LessOrEqualFiveWordsStrategy } from './services/strategies/LessOrEqualFiveWordsStrategy.js';
import { FirestoreRestRepository } from './repositories/FirestoreRestRepository.js';

// CORS headers to allow the backend to respond from different origins.
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
  'access-control-allow-headers': 'content-type, x-api-key, authorization'
};

// Helper function to return JSON responses with the specified status code.
const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...CORS_HEADERS
    }
  });

// Generates a descriptive text for the execution log based on the type.
const buildSaveReason = (executionType, frequencyLabel) =>
  executionType === 'SCHEDULED'
    ? `Scraping and save entries (${frequencyLabel})`
    : 'Scraping and save entries (manual)';

// Converts a cron expression into a more readable label for logs.
const describeFrequency = (cronExpression) => {
  const hourlyMatch = /^0 \*\/(\d{1,3}) \* \* \*$/.exec(cronExpression ?? '');

  if (hourlyMatch) {
    return `each ${hourlyMatch[1]} h`;
  }

  return cronExpression ?? 'custom';
};

// Extracts the API key sent in the request (x-api-key or Authorization Bearer).
const extractApiKey = (request) => {
  const headerKey = request.headers.get('x-api-key');

  if (headerKey) {
    return headerKey;
  }

  const authorization = request.headers.get('authorization');

  if (authorization) {
    const [scheme, ...rest] = authorization.split(' ');
    if (scheme?.toLowerCase() === 'bearer') {
      return rest.join(' ').trim();
    }
  }

  return null;
};

// Compares the incoming key with the static key configured in the environment.
const isAuthorized = (request, apiKey) => {
  if (!apiKey) {
    return false;
  }

  const providedKey = extractApiKey(request);
  return providedKey !== null && providedKey === apiKey;
};

// Creates all the services used by the worker.
export const createServices = (env = {}) => {
  // Repository responsible for saving data and configuration in Firestore.
  const repository = new FirestoreRestRepository({
    projectId: env.FIREBASE_PROJECT_ID,
    apiKey: env.FIREBASE_API_KEY
  });

  // Reusable word counter for filtering strategies.
  const wordCounter = new WordCounter();

  return {
    // Reader that fetches news from Hacker News.
    scraper: new HackerNewsScraper(),
    wordCounter,
    // Available strategies for filtering results.
    strategies: {
      MORE_THAN_5_WORDS_BY_COMMENTS: new MoreThanFiveWordsStrategy(wordCounter),
      LESS_OR_EQUAL_5_WORDS_BY_POINTS: new LessOrEqualFiveWordsStrategy(wordCounter)
    },
    repository,
    // Static API key required for each HTTP request.
    apiKey: env.API_KEY
  };
};

// Special filter that returns entries without applying any strategy.
const NO_FILTER = 'NO_FILTER';

const listValidFilters = (services) => [NO_FILTER, ...Object.keys(services.strategies)];

// Handles a GET request with a specific filter in the query string.
const handleEntriesQuery = async (url, services) => {
  const filterId = url.searchParams.get('filter');
  const strategy = services.strategies[filterId];
  const isNoFilter = filterId === NO_FILTER || filterId === null || filterId === '';

  // If the filter does not exist, return a 400 error with valid filters.
  if (!strategy && !isNoFilter) {
    return json(
      {
        error: `Unknown filter "${filterId}"`,
        valid_filters: listValidFilters(services)
      },
      400
    );
  }

  // Executes the scrape and applies the selected filter (or none when it is NO_FILTER).
  const startedAt = performance.now();
  const entries = await services.scraper.scrape();
  const results = strategy ? strategy.apply(entries) : entries;
  const appliedFilter = strategy ? filterId : NO_FILTER;
  const executionTimeMs = Math.round(performance.now() - startedAt);

  // Saves a usage log describing which filter was used.
  const logId = await services.repository.saveUsageLog({
    timestamp: new Date().toISOString(),
    filter_applied: appliedFilter,
    results_count: results.length,
    execution_type: 'MANUAL',
    execution_time_ms: executionTimeMs
  });

  return json({
    filter: appliedFilter,
    results_count: results.length,
    execution_time_ms: executionTimeMs,
    log_id: logId,
    results
  });
};

// Performs a manual scrape and saves all entries without filtering.
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

// Retrieves the current system configuration from Firestore.
const handleGetConfig = async (services) => {
  const config = await services.repository.getSystemConfig();
  return json(config);
};

// Updates the system configuration using JSON sent in the request body.
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

// Main router for handling all HTTP requests to the worker.
export const handleFetch = async (request, services) => {
  try {
    // Responds to OPTIONS requests for CORS preflight.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Blocks any method if the server does not have an API key configured.
    if (!services.apiKey) {
      return json({ error: 'API key is not configured on the server' }, 500);
    }

    // Requires the static API key in every request (GET, PUT, POST, DELETE).
    if (!isAuthorized(request, services.apiKey)) {
      return json(
        {
          error: 'Unauthorized: missing or invalid API key',
          header: 'x-api-key: <API_KEY> (or Authorization: Bearer <API_KEY>)'
        },
        401
      );
    }

    const url = new URL(request.url);
    const { pathname } = url;

    // Base route: service information and available endpoints.
    if (request.method === 'GET' && pathname === '/') {
      return json({
        service: 'hacker-news-scraper',
        status: 'ok',
        endpoints: [
          'GET /api/entries?filter=NO_FILTER | MORE_THAN_5_WORDS_BY_COMMENTS | LESS_OR_EQUAL_5_WORDS_BY_POINTS',
          'GET /api/scrape',
          'GET /api/config',
          'PUT /api/config'
        ]
      });
    }

    // Route to query filtered entries.
    if (request.method === 'GET' && pathname === '/api/entries') {
      return await handleEntriesQuery(url, services);
    }

    // Route to trigger a manual scrape.
    if (request.method === 'GET' && pathname === '/api/scrape') {
      return await handleManualScrape(services);
    }

    // System configuration routes.
    if (pathname === '/api/config') {
      if (request.method === 'GET') {
        return await handleGetConfig(services);
      }

      if (request.method === 'PUT' || request.method === 'POST') {
        return await handleUpdateConfig(request, services);
      }
    }

    // Route not found.
    return json({ error: `Route not found: ${request.method} ${pathname}` }, 404);
  } catch (error) {
    // Any internal error returns a 500 response with the message.
    return json({ error: error.message }, 500);
  }
};

// Executes the scraper automatically when the cron is enabled.
export const handleScheduled = async (services) => {
  const config = await services.repository.getSystemConfig();

  // If cron is disabled, do nothing.
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

// Exports the logic that Cloudflare Worker executes when receiving HTTP requests.
export default {
  async fetch(request, env, ctx) {
    return handleFetch(request, createServices(env));
  },

  // Exports the logic for scheduled cron executions.
  async scheduled(event, env, ctx) {
    return handleScheduled(createServices(env));
  }
};
