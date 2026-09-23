import { describe, it, expect, beforeAll } from 'vitest';
import { createFirestoreDb } from '../src/config/firebase.js';
import { FirestoreRepository } from '../src/repositories/FirestoreRepository.js';

// This test exercises the concrete repository implementation stored in the repositories folder.
// The repository extends BaseRepository and is expected to persist data in Firestore for:
// 1) the latest entries cache,
// 2) usage logs,
// 3) system configuration.

// Sample entries used to validate that the repository stores a real dataset.
// These objects simulate scraped items with their metadata.
const entries = [
  { number: 1, title: 'Short title here', points: 300, comments: 40 },
  { number: 2, title: 'This is - a self-explained example', points: 250, comments: 100 },
  { number: 3, title: 'A much longer title with more than five words total', points: 120, comments: 250 }
];

describe('FirestoreRepository - real Firebase persistence flow', () => {
  // Repository instance used by all tests in this suite.
  // It is initialized once before the tests run.
  let repository;

  beforeAll(() => {
    repository = new FirestoreRepository(createFirestoreDb());
  });

  it(
    'creates the entries in entries_cache',
    { timeout: 30000 },
    async () => {
      // Measures how long the save operation takes.
      const startedAt = performance.now();
      const docId = await repository.saveEntries(entries);
      const executionTimeMs = Math.round(performance.now() - startedAt);

      // Logs the result for manual inspection while running the test.
      console.log('saveEntries ->', { docId, entriesCount: entries.length, executionTimeMs });

      // The repository is designed to overwrite the latest cache document,
      // so the ID should be the fixed document name 'latest'.
      expect(docId).toBe('latest');
      expect(entries).toHaveLength(3);
    }
  );

  it(
    'creates the usage log auditing the entries creation',
    { timeout: 30000 },
    async () => {
      // This simulates a real execution of the scraper or processing pipeline.
      const startedAt = performance.now();
      const logId = await repository.saveUsageLog({
        timestamp: new Date().toISOString(),
        filter_applied: 'MORE_THAN_5_WORDS_BY_COMMENTS',
        results_count: entries.length,
        execution_type: 'MANUAL',
        execution_time_ms: Math.round(performance.now() - startedAt)
      });

      // Prints the generated identifier and number of processed results.
      console.log('saveUsageLog ->', { logId, resultsCount: entries.length });

      // The method should return a valid Firestore document ID as a string.
      expect(logId).toBeTruthy();
      expect(typeof logId).toBe('string');
    }
  );

  it(
    'retrieves the system configuration',
    { timeout: 30000 },
    async () => {
      // Reads the configuration stored in Firestore.
      const config = await repository.getSystemConfig();

      console.log('getSystemConfig ->', config);

      // The repository should always return an object with the required config fields.
      expect(config).toEqual(
        expect.objectContaining({
          cron_enabled: expect.any(Boolean),
          cron_expression: expect.any(String)
        })
      );
    }
  );

  it(
    'updates the system configuration and persists the changes',
    { timeout: 30000 },
    async () => {
      // This simulates updating the cron configuration used by scheduled tasks.
      const updatedConfig = {
        cron_enabled: true,
        cron_expression: '0 */1 * * *'
      };

      const updated = await repository.updateSystemConfig(updatedConfig);
      console.log('updateSystemConfig ->', updated);

      // The repository should merge the new values and return the full config.
      expect(updated).toEqual(
        expect.objectContaining(updatedConfig)
      );

      // Reloads the configuration from Firestore to validate persistence.
      const reloaded = await repository.getSystemConfig();
      console.log('getSystemConfig after update ->', reloaded);

      // Confirms that the saved values persisted and are readable after the update.
      expect(reloaded).toEqual(expect.objectContaining(updatedConfig));
    }
  );
});
