import { collection, doc, setDoc, getDoc } from 'firebase/firestore';
import { BaseRepository } from './BaseRepository.js';

// Names of the collections in Firestore.
// Each one represents a persistent data type in the system.
const USAGE_LOGS_COLLECTION = 'usage_logs';
const ENTRIES_CACHE_COLLECTION = 'entries_cache';
const SYSTEM_CONFIG_COLLECTION = 'system_config';
const LATEST_CACHE_DOC = 'latest';
const GLOBAL_CONFIG_DOC = 'global';

// Execution types allowed for logging.
// This prevents storing inconsistent or misspelled data.
const VALID_EXECUTION_TYPES = ['MANUAL', 'SCHEDULED', 'ORDER', 'SEARCH'];

// Default system configuration.
// If no configuration document exists in Firestore, this will be used.
export const DEFAULT_SYSTEM_CONFIG = {
  cron_enabled: false,
  cron_expression: '0 */6 * * *'
};

// Concrete repository for persisting data in Firestore.
// It inherits the required base interface that enforces implementing certain methods.
export class FirestoreRepository extends BaseRepository {
  constructor(db) {
    super();

    // The repository requires a valid Firestore instance.
    // If it is missing, the operation stops immediately.
    if (!db) {
      throw new Error('FirestoreRepository requires a Firestore database instance');
    }

    this.db = db;
  }

  // Saves a usage log for the scraper or system.
  // It is used to audit manual or scheduled executions.
  async saveUsageLog(logData) {
    // A log object must be provided.
    if (!logData || typeof logData !== 'object') {
      throw new Error('logData must be an object');
    }

    // The execution type must be MANUAL or SCHEDULED.
    if (!VALID_EXECUTION_TYPES.includes(logData.execution_type)) {
      throw new Error(
        `Invalid execution_type "${logData.execution_type}". Expected one of: ${VALID_EXECUTION_TYPES.join(', ')}`
      );
    }

    // Normalize the data before saving it.
    const log = {
      timestamp: logData.timestamp ?? new Date().toISOString(),
      filter_applied: logData.filter_applied,
      results_count: logData.results_count,
      execution_type: logData.execution_type,
      execution_time_ms: logData.execution_time_ms
    };

    // Creates a new document inside the usage_logs collection.
    // Firestore generates an automatic ID for each document.
    const logRef = doc(collection(this.db, USAGE_LOGS_COLLECTION));
    await setDoc(logRef, log);

    // Returns the ID of the newly saved document.
    return logRef.id;
  }

  // Saves the current set of entries in a cache.
  // The 'latest' document replaces the previous content to always keep
  // the most recent version available.
  async saveEntries(entries) {
    if (!Array.isArray(entries)) {
      throw new Error('entries must be an array');
    }

    // Accesses the 'latest' document inside entries_cache.
    const cacheRef = doc(this.db, ENTRIES_CACHE_COLLECTION, LATEST_CACHE_DOC);
    await setDoc(cacheRef, {
      saved_at: new Date().toISOString(),
      entries
    });

    return cacheRef.id;
  }

  // Retrieves the system configuration from Firestore.
  // If it does not exist, it returns the default project configuration.
  async getSystemConfig() {
    const configRef = doc(this.db, SYSTEM_CONFIG_COLLECTION, GLOBAL_CONFIG_DOC);
    const snapshot = await getDoc(configRef);

    // If the document does not exist, return a copy of the base configuration.
    if (!snapshot.exists()) {
      return { ...DEFAULT_SYSTEM_CONFIG };
    }

    // If it exists, combine the base configuration with the stored values.
    // The actual document values override the defaults.
    return { ...DEFAULT_SYSTEM_CONFIG, ...snapshot.data() };
  }

  // Updates the system configuration with a partial payload.
  // Only the provided fields are merged into the stored document.
  async updateSystemConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('config must be an object');
    }

    const configRef = doc(this.db, SYSTEM_CONFIG_COLLECTION, GLOBAL_CONFIG_DOC);
    await setDoc(configRef, config, { merge: true });

    return this.getSystemConfig();
  }
}
