import { BaseRepository } from './BaseRepository.js';
import { firebaseConfig } from '../config/firebaseConfig.js';

const USAGE_LOGS_COLLECTION = 'usage_logs';
const ENTRIES_CACHE_COLLECTION = 'entries_cache';
const SYSTEM_CONFIG_COLLECTION = 'system_config';
const LATEST_CACHE_DOC = 'latest';
const GLOBAL_CONFIG_DOC = 'global';

const VALID_EXECUTION_TYPES = ['MANUAL', 'SCHEDULED', 'ORDER', 'SEARCH'];

export const DEFAULT_SYSTEM_CONFIG = {
  cron_enabled: false,
  cron_expression: '0 */6 * * *',
  frequency_hours: 6,
  last_run_hour: null
};

const encodeValue = (value) => {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }

  if (typeof value === 'string') {
    return { stringValue: value };
  }

  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }

  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }

  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeValue) } };
  }

  if (typeof value === 'object') {
    return { mapValue: { fields: encodeFields(value) } };
  }

  throw new Error(`Unsupported value type: ${typeof value}`);
};

const encodeFields = (data) =>
  Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, encodeValue(value)])
  );

const decodeValue = (value) => {
  if ('stringValue' in value) {
    return value.stringValue;
  }

  if ('integerValue' in value) {
    return Number(value.integerValue);
  }

  if ('doubleValue' in value) {
    return value.doubleValue;
  }

  if ('booleanValue' in value) {
    return value.booleanValue;
  }

  if ('nullValue' in value) {
    return null;
  }

  if ('arrayValue' in value) {
    return (value.arrayValue.values ?? []).map(decodeValue);
  }

  if ('mapValue' in value) {
    return decodeFields(value.mapValue.fields ?? {});
  }

  return null;
};

const decodeFields = (fields) =>
  Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeValue(value)])
  );

const documentIdFromName = (name) => name.split('/').pop();

export class FirestoreRestRepository extends BaseRepository {
  constructor({
    projectId = firebaseConfig.projectId,
    apiKey = firebaseConfig.apiKey,
    fetcher = (input, init) => globalThis.fetch(input, init)
  } = {}) {
    super();

    if (!projectId || !apiKey) {
      throw new Error('FirestoreRestRepository requires projectId and apiKey');
    }

    this.projectId = projectId;
    this.apiKey = apiKey;
    this.fetcher = fetcher;
    this.baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  }

  async #request(method, documentPath, body) {
    const url = `${this.baseUrl}/${documentPath}?key=${this.apiKey}`;
    const response = await this.fetcher(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    if (response.status === 404) {
      return { notFound: true };
    }

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Firestore REST request failed (${response.status}): ${detail}`
      );
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  async saveUsageLog(logData) {
    if (!logData || typeof logData !== 'object') {
      throw new Error('logData must be an object');
    }

    if (!VALID_EXECUTION_TYPES.includes(logData.execution_type)) {
      throw new Error(
        `Invalid execution_type "${logData.execution_type}". Expected one of: ${VALID_EXECUTION_TYPES.join(', ')}`
      );
    }

    const log = {
      timestamp: logData.timestamp ?? new Date().toISOString(),
      filter_applied: logData.filter_applied,
      results_count: logData.results_count,
      execution_type: logData.execution_type,
      execution_time_ms: logData.execution_time_ms
    };

    const document = await this.#request('POST', USAGE_LOGS_COLLECTION, {
      fields: encodeFields(log)
    });

    return documentIdFromName(document.name);
  }

  async saveEntries(entries) {
    if (!Array.isArray(entries)) {
      throw new Error('entries must be an array');
    }

    await this.#request('PATCH', `${ENTRIES_CACHE_COLLECTION}/${LATEST_CACHE_DOC}`, {
      fields: encodeFields({
        saved_at: new Date().toISOString(),
        entries
      })
    });

    return LATEST_CACHE_DOC;
  }

  async getSystemConfig() {
    const document = await this.#request(
      'GET',
      `${SYSTEM_CONFIG_COLLECTION}/${GLOBAL_CONFIG_DOC}`
    );

    if (document.notFound) {
      return { ...DEFAULT_SYSTEM_CONFIG };
    }

    return { ...DEFAULT_SYSTEM_CONFIG, ...decodeFields(document.fields ?? {}) };
  }

  async updateSystemConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('config must be an object');
    }

    const merged = { ...DEFAULT_SYSTEM_CONFIG, ...config };

    await this.#request(
      'PATCH',
      `${SYSTEM_CONFIG_COLLECTION}/${GLOBAL_CONFIG_DOC}`,
      { fields: encodeFields(merged) }
    );

    return merged;
  }
}
