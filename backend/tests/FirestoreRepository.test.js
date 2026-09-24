import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((db, name) => ({ type: 'collection', db, name })),
  doc: vi.fn((...args) => ({ id: 'mock-doc-id', args })),
  setDoc: vi.fn(async () => {}),
  getDoc: vi.fn(async () => ({ exists: () => true, data: () => ({}) }))
}));

import { collection, doc, setDoc, getDoc } from 'firebase/firestore';
import { BaseRepository } from '../src/repositories/BaseRepository.js';
import {
  FirestoreRepository,
  DEFAULT_SYSTEM_CONFIG
} from '../src/repositories/FirestoreRepository.js';

const fakeDb = { projectId: 'test-2eb64' };

describe('BaseRepository', () => {
  it('throws when saveUsageLog is not implemented', async () => {
    const repository = new BaseRepository();
    await expect(repository.saveUsageLog({})).rejects.toThrow(
      'saveUsageLog() must be implemented'
    );
  });

  it('throws when saveEntries is not implemented', async () => {
    const repository = new BaseRepository();
    await expect(repository.saveEntries([])).rejects.toThrow(
      'saveEntries() must be implemented'
    );
  });

    it('throws when getSystemConfig is not implemented', async () => {
    const repository = new BaseRepository();
    await expect(repository.getSystemConfig()).rejects.toThrow(
      'getSystemConfig() must be implemented'
    );
  });

  it('throws when updateSystemConfig is not implemented', async () => {
    const repository = new BaseRepository();
    await expect(repository.updateSystemConfig({})).rejects.toThrow(
      'updateSystemConfig() must be implemented'
    );
  });
});

describe('FirestoreRepository', () => {
  let repository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new FirestoreRepository(fakeDb);
  });

  it('is a substitutable BaseRepository implementation (LSP/DIP)', () => {
    expect(repository).toBeInstanceOf(BaseRepository);
  });

  it('requires an injected database instance', () => {
    expect(() => new FirestoreRepository()).toThrow(
      'FirestoreRepository requires a Firestore database instance'
    );
  });

  describe('saveUsageLog', () => {
    const validLog = {
      filter_applied: 'MORE_THAN_5_WORDS_BY_COMMENTS',
      results_count: 12,
      execution_type: 'MANUAL',
      execution_time_ms: 42
    };

    it('writes a document to the usage_logs collection with all audit fields', async () => {
      await repository.saveUsageLog(validLog);

      expect(collection).toHaveBeenCalledWith(fakeDb, 'usage_logs');
      expect(setDoc).toHaveBeenCalledTimes(1);

      const [logRef, log] = setDoc.mock.calls[0];
      expect(logRef.id).toBe('mock-doc-id');
      expect(log).toEqual({
        timestamp: expect.any(String),
        filter_applied: 'MORE_THAN_5_WORDS_BY_COMMENTS',
        results_count: 12,
        execution_type: 'MANUAL',
        execution_time_ms: 42
      });
    });

    it('generates an ISO 8601 timestamp when none is provided', async () => {
      await repository.saveUsageLog(validLog);

      const [, log] = setDoc.mock.calls[0];
      expect(new Date(log.timestamp).toISOString()).toBe(log.timestamp);
    });

    it('keeps the exact timestamp when one is provided', async () => {
      await repository.saveUsageLog({
        ...validLog,
        timestamp: '2026-09-23T10:00:00.000Z'
      });

      const [, log] = setDoc.mock.calls[0];
      expect(log.timestamp).toBe('2026-09-23T10:00:00.000Z');
    });

    it('accepts execution_type SCHEDULED', async () => {
      await repository.saveUsageLog({ ...validLog, execution_type: 'SCHEDULED' });

      const [, log] = setDoc.mock.calls[0];
      expect(log.execution_type).toBe('SCHEDULED');
    });

    it('accepts execution_type ORDER', async () => {
      await repository.saveUsageLog({
        ...validLog,
        execution_type: 'ORDER',
        filter_applied: 'Order by points'
      });

      const [, log] = setDoc.mock.calls[0];
      expect(log.execution_type).toBe('ORDER');
      expect(log.filter_applied).toBe('Order by points');
    });

    it('accepts execution_type SEARCH', async () => {
      await repository.saveUsageLog({
        ...validLog,
        execution_type: 'SEARCH',
        filter_applied: 'filter by 5 words'
      });

      const [, log] = setDoc.mock.calls[0];
      expect(log.execution_type).toBe('SEARCH');
      expect(log.filter_applied).toBe('filter by 5 words');
    });

    it('rejects an invalid execution_type', async () => {
      await expect(
        repository.saveUsageLog({ ...validLog, execution_type: 'AUTO' })
      ).rejects.toThrow('Invalid execution_type "AUTO"');
      expect(setDoc).not.toHaveBeenCalled();
    });

    it('rejects a non-object payload', async () => {
      await expect(repository.saveUsageLog(null)).rejects.toThrow(
        'logData must be an object'
      );
      expect(setDoc).not.toHaveBeenCalled();
    });

    it('returns the created document id', async () => {
      const id = await repository.saveUsageLog(validLog);
      expect(id).toBe('mock-doc-id');
    });
  });

  describe('saveEntries', () => {
    const entries = [
      { number: 1, title: 'Short title here', points: 300, comments: 40 },
      { number: 2, title: 'Another story title', points: 10, comments: 0 }
    ];

    it('writes the entries array to entries_cache/latest with saved_at', async () => {
      await repository.saveEntries(entries);

      expect(doc).toHaveBeenCalledWith(fakeDb, 'entries_cache', 'latest');
      expect(setDoc).toHaveBeenCalledTimes(1);

      const [, payload] = setDoc.mock.calls[0];
      expect(payload).toEqual({
        saved_at: expect.any(String),
        entries
      });
      expect(new Date(payload.saved_at).toISOString()).toBe(payload.saved_at);
    });

    it('accepts an empty entries array', async () => {
      await repository.saveEntries([]);
      expect(setDoc).toHaveBeenCalledTimes(1);
    });

    it('rejects a non-array payload', async () => {
      await expect(repository.saveEntries({ number: 1 })).rejects.toThrow(
        'entries must be an array'
      );
      expect(setDoc).not.toHaveBeenCalled();
    });
  });

  describe('getSystemConfig', () => {
    it('returns the stored configuration merged with defaults', async () => {
      getDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ cron_enabled: true, cron_expression: '0 */15 * * * *' })
      });

      const config = await repository.getSystemConfig();

      expect(doc).toHaveBeenCalledWith(fakeDb, 'system_config', 'global');
      expect(config).toEqual({
        cron_enabled: true,
        cron_expression: '0 */15 * * * *',
        frequency_hours: 6,
        last_run_hour: null
      });
    });

    it('returns the default configuration when the document does not exist', async () => {
      getDoc.mockResolvedValueOnce({ exists: () => false });

      const config = await repository.getSystemConfig();

      expect(config).toEqual(DEFAULT_SYSTEM_CONFIG);
      expect(config).toEqual({
        cron_enabled: false,
        cron_expression: '0 */6 * * *',
        frequency_hours: 6,
        last_run_hour: null
      });
    });

    it('fills missing stored fields with defaults', async () => {
      getDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ cron_enabled: true })
      });

      const config = await repository.getSystemConfig();

      expect(config).toEqual({
        cron_enabled: true,
        cron_expression: DEFAULT_SYSTEM_CONFIG.cron_expression,
        frequency_hours: DEFAULT_SYSTEM_CONFIG.frequency_hours,
        last_run_hour: null
      });
    });
  });

  describe('updateSystemConfig', () => {
    it('merges the provided fields into system_config/global', async () => {
      await repository.updateSystemConfig({ cron_enabled: true });

      expect(doc).toHaveBeenCalledWith(fakeDb, 'system_config', 'global');
      expect(setDoc).toHaveBeenCalledWith(
        expect.anything(),
        { cron_enabled: true },
        { merge: true }
      );
    });

    it('returns the updated configuration merged with defaults', async () => {
      getDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ cron_enabled: true, cron_expression: '0 */1 * * *' })
      });

      const config = await repository.updateSystemConfig({ cron_enabled: true });

      expect(config).toEqual({
        cron_enabled: true,
        cron_expression: '0 */1 * * *',
        frequency_hours: 6,
        last_run_hour: null
      });
    });

    it('rejects a non-object payload', async () => {
      await expect(repository.updateSystemConfig('yes')).rejects.toThrow(
        'config must be an object'
      );
      expect(setDoc).not.toHaveBeenCalled();
    });
  });
});
