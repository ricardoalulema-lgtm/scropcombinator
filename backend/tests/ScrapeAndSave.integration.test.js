import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createFirestoreDb } from '../src/config/firebase.js';
import { HackerNewsScraper } from '../src/services/HackerNewsScraper.js';
import { FirestoreRepository } from '../src/repositories/FirestoreRepository.js';
import { buildSaveReason, scheduledFrequencyLabel } from '../src/utils/schedule.js';

const buildAuditReason = async (repository, executionType) => {
  if (executionType !== 'SCHEDULED') {
    return buildSaveReason(executionType);
  }

  const config = await repository.getSystemConfig();
  return buildSaveReason('SCHEDULED', scheduledFrequencyLabel(config));
};

const scrapeAndSaveEntries = async ({ scraper, repository, executionType }) => {
  const flowStartedAt = performance.now();

  const entries = await scraper.scrape();
  const scrapeTimeMs = Math.round(performance.now() - flowStartedAt);

  const saveStartedAt = performance.now();
  const docId = await repository.saveEntries(entries);
  const saveTimeMs = Math.round(performance.now() - saveStartedAt);

  const executionTimeMs = Math.round(performance.now() - flowStartedAt);

  const logPayload = {
    timestamp: new Date().toISOString(),
    filter_applied: await buildAuditReason(repository, executionType),
    results_count: entries.length,
    execution_type: executionType,
    execution_time_ms: executionTimeMs
  };

  const logId = await repository.saveUsageLog(logPayload);

  return { entries, docId, logId, scrapeTimeMs, saveTimeMs, logPayload };
};

describe('Scraping and save to Firebase - real flow', () => {
  let scraper;
  let repository;

  beforeAll(() => {
    scraper = new HackerNewsScraper();
    repository = new FirestoreRepository(createFirestoreDb());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    'manual: scrapes real entries, saves them and audits reason "(manual)" with real execution time',
    { timeout: 60000 },
    async () => {
      const logSpy = vi.spyOn(repository, 'saveUsageLog');

      const result = await scrapeAndSaveEntries({
        scraper,
        repository,
        executionType: 'MANUAL'
      });

      console.log('MANUAL flow ->', {
        entriesCount: result.entries.length,
        scrapeTimeMs: result.scrapeTimeMs,
        saveTimeMs: result.saveTimeMs,
        executionTimeMs: result.logPayload.execution_time_ms,
        docId: result.docId,
        logId: result.logId,
        log: result.logPayload
      });

      expect(result.entries).toHaveLength(30);
      expect(result.docId).toBe('latest');
      expect(result.logId).toBeTruthy();

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          filter_applied: 'Scraping and save entries (manual)',
          results_count: 30,
          execution_type: 'MANUAL',
          execution_time_ms: expect.any(Number)
        })
      );

      const [logData] = logSpy.mock.calls[0];
      expect(logData.execution_time_ms).toBeGreaterThan(0);
      expect(new Date(logData.timestamp).toISOString()).toBe(logData.timestamp);
    }
  );

  it(
    'scheduled: scrapes real entries, saves them and audits the configured frequency label with real execution time',
    { timeout: 60000 },
    async () => {
      const logSpy = vi.spyOn(repository, 'saveUsageLog');
      const config = await repository.getSystemConfig();

      const result = await scrapeAndSaveEntries({
        scraper,
        repository,
        executionType: 'SCHEDULED'
      });

      console.log('SCHEDULED flow ->', {
        entriesCount: result.entries.length,
        scrapeTimeMs: result.scrapeTimeMs,
        saveTimeMs: result.saveTimeMs,
        executionTimeMs: result.logPayload.execution_time_ms,
        docId: result.docId,
        logId: result.logId,
        frequency_hours: config.frequency_hours,
        log: result.logPayload
      });

      expect(result.entries).toHaveLength(30);
      expect(result.docId).toBe('latest');
      expect(result.logId).toBeTruthy();

      const expectedReason = `Scraping and save entries (each ${config.frequency_hours} h)`;

      expect(result.logPayload.filter_applied).toBe(expectedReason);

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          filter_applied: expectedReason,
          results_count: 30,
          execution_type: 'SCHEDULED',
          execution_time_ms: expect.any(Number)
        })
      );

      const [logData] = logSpy.mock.calls[0];
      expect(logData.execution_time_ms).toBeGreaterThan(0);
      expect(new Date(logData.timestamp).toISOString()).toBe(logData.timestamp);
    }
  );
});
