import { HackerNewsScraper } from './services/HackerNewsScraper.js';
import { WordCounter } from './services/WordCounter.js';
import { MoreThanFiveWordsStrategy } from './services/strategies/MoreThanFiveWordsStrategy.js';
import { LessOrEqualFiveWordsStrategy } from './services/strategies/LessOrEqualFiveWordsStrategy.js';
import { FirestoreRestRepository } from './repositories/FirestoreRestRepository.js';

// Headers CORS para permitir que el backend responda desde distintos orígenes.
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
  'access-control-allow-headers': 'content-type, x-api-key, authorization'
};

// Función auxiliar para devolver respuestas JSON con el código de estado indicado.
const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...CORS_HEADERS
    }
  });

// Genera un texto descriptivo para el log de la ejecución según el tipo.
const buildSaveReason = (executionType, frequencyLabel) =>
  executionType === 'SCHEDULED'
    ? `Scraping and save entries (${frequencyLabel})`
    : 'Scraping and save entries (manual)';

// Traduce una expresión cron a un texto más legible para los logs.
const describeFrequency = (cronExpression) => {
  const hourlyMatch = /^0 \*\/(\d{1,3}) \* \* \*$/.exec(cronExpression ?? '');

  if (hourlyMatch) {
    return `each ${hourlyMatch[1]} h`;
  }

  return cronExpression ?? 'custom';
};

// Extrae la API key enviada en la petición (x-api-key o Authorization Bearer).
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

// Compara la clave recibida con la clave estática configurada en el entorno.
const isAuthorized = (request, apiKey) => {
  if (!apiKey) {
    return false;
  }

  const providedKey = extractApiKey(request);
  return providedKey !== null && providedKey === apiKey;
};

// Crea la instancia de todos los servicios que usará el worker.
export const createServices = (env = {}) => {
  // Repositorio encargado de guardar data y configuración en Firestore.
  const repository = new FirestoreRestRepository({
    projectId: env.FIREBASE_PROJECT_ID,
    apiKey: env.FIREBASE_API_KEY
  });

  // Contador de palabras reutilizable para las estrategias de filtrado.
  const wordCounter = new WordCounter();

  return {
    // Lector que obtiene noticias desde Hacker News.
    scraper: new HackerNewsScraper(),
    wordCounter,
    // Estrategias disponibles para filtrar resultados.
    strategies: {
      MORE_THAN_5_WORDS_BY_COMMENTS: new MoreThanFiveWordsStrategy(wordCounter),
      LESS_OR_EQUAL_5_WORDS_BY_POINTS: new LessOrEqualFiveWordsStrategy(wordCounter)
    },
    repository,
    // API key estática requerida en cada petición HTTP.
    apiKey: env.API_KEY
  };
};

// Maneja una petición GET con un filtro específico en la query string.
const handleEntriesQuery = async (url, services) => {
  const filterId = url.searchParams.get('filter');
  const strategy = services.strategies[filterId];

  // Si el filtro no existe, devuelve un error 400 con los filtros válidos.
  if (!strategy) {
    return json(
      {
        error: `Unknown filter "${filterId}"`,
        valid_filters: Object.keys(services.strategies)
      },
      400
    );
  }

  // Ejecuta el scraping y aplica el filtro elegido.
  const startedAt = performance.now();
  const entries = await services.scraper.scrape();
  const results = strategy.apply(entries);
  const executionTimeMs = Math.round(performance.now() - startedAt);

  // Guarda un registro del uso con la categoría del filtro aplicado.
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

// Realiza un scraping manual y guarda todas las entradas sin filtrar.
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

// Obtiene la configuración actual del sistema desde Firestore.
const handleGetConfig = async (services) => {
  const config = await services.repository.getSystemConfig();
  return json(config);
};

// Actualiza la configuración del sistema con un JSON enviado en la petición.
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

// Enrutador principal para manejar todas las peticiones HTTP del worker.
export const handleFetch = async (request, services) => {
  try {
    // Responde a peticiones OPTIONS para CORS preflight.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Bloquea cualquier método si el servidor no tiene API key configurada.
    if (!services.apiKey) {
      return json({ error: 'API key is not configured on the server' }, 500);
    }

    // Exige la API key estática en cada petición (GET, PUT, POST, DELETE).
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

    // Ruta base: información del servicio y endpoints disponibles.
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

    // Ruta para consultar entradas filtradas.
    if (request.method === 'GET' && pathname === '/api/entries') {
      return await handleEntriesQuery(url, services);
    }

    // Ruta para disparar un scrape manual.
    if (request.method === 'GET' && pathname === '/api/scrape') {
      return await handleManualScrape(services);
    }

    // Rutas de configuración del sistema.
    if (pathname === '/api/config') {
      if (request.method === 'GET') {
        return await handleGetConfig(services);
      }

      if (request.method === 'PUT' || request.method === 'POST') {
        return await handleUpdateConfig(request, services);
      }
    }

    // Ruta no encontrada.
    return json({ error: `Route not found: ${request.method} ${pathname}` }, 404);
  } catch (error) {
    // Cualquier error interno genera una respuesta 500 con el mensaje.
    return json({ error: error.message }, 500);
  }
};

// Ejecuta el scraper de manera automática si el cron está habilitado.
export const handleScheduled = async (services) => {
  const config = await services.repository.getSystemConfig();

  // Si cron está desactivado, no hace nada.
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

// Exporta la lógica que Cloudflare Worker ejecuta al recibir peticiones HTTP.
export default {
  async fetch(request, env, ctx) {
    return handleFetch(request, createServices(env));
  },

  // Exporta la lógica para ejecuciones programadas por cron.
  async scheduled(event, env, ctx) {
    return handleScheduled(createServices(env));
  }
};
