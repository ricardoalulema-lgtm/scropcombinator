import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FirestoreRestRepository } from '../src/repositories/FirestoreRestRepository.js';

const documentUrl = (path) =>
  expect.stringContaining(`/documents/${path}?key=`);

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });

describe('FirestoreRestRepository', () => {
  let fetcher;
  let repository;

  beforeEach(() => {
    fetcher = vi.fn(async () =>
      jsonResponse({ name: 'projects/p/databases/(default)/documents/x/id', fields: {} })
    );
    repository = new FirestoreRestRepository({
      projectId: 'test-project',
      apiKey: 'test-api-key',
      fetcher
    });
  });

  it('is a substitutable BaseRepository implementation', async () => {
    const { BaseRepository } = await import('../src/repositories/BaseRepository.js');
    expect(repository).toBeInstanceOf(BaseRepository);
  });

  it('requires projectId and apiKey', () => {
    expect(
      () => new FirestoreRestRepository({ projectId: '', apiKey: '' })
    ).toThrow('requires projectId and apiKey');
  });

  describe('saveUsageLog', () => {
    it('POSTs an encoded audit log to usage_logs and returns the document id', async () => {
      fetcher.mockResolvedValueOnce(
        jsonResponse({
          name: 'projects/p/databases/(default)/documents/usage_logs/abc123',
          fields: {}
        })
      );

      const logId = await repository.saveUsageLog({
        filter_applied: 'MORE_THAN_5_WORDS_BY_COMMENTS',
        results_count: 12,
        execution_type: 'MANUAL',
        execution_time_ms: 42
      });

      expect(logId).toBe('abc123');
      expect(fetcher).toHaveBeenCalledWith(
        documentUrl('usage_logs'),
        expect.objectContaining({ method: 'POST' })
      );

      const body = JSON.parse(fetcher.mock.calls[0][1].body);
      expect(body.fields.filter_applied).toEqual({
        stringValue: 'MORE_THAN_5_WORDS_BY_COMMENTS'
      });
      expect(body.fields.results_count).toEqual({ integerValue: '12' });
      expect(body.fields.execution_time_ms).toEqual({ integerValue: '42' });
      expect(body.fields.execution_type).toEqual({ stringValue: 'MANUAL' });
      expect(body.fields.timestamp.stringValue).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('rejects an invalid execution_type without calling the API', async () => {
      await expect(
        repository.saveUsageLog({
          filter_applied: 'x',
          results_count: 1,
          execution_type: 'AUTO',
          execution_time_ms: 1
        })
      ).rejects.toThrow('Invalid execution_type "AUTO"');
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('accepts execution_type ORDER and SEARCH', async () => {
      await repository.saveUsageLog({
        filter_applied: 'Order by points',
        results_count: 3,
        execution_type: 'ORDER',
        execution_time_ms: 1
      });
      await repository.saveUsageLog({
        filter_applied: 'filter by 5 words',
        results_count: 2,
        execution_type: 'SEARCH',
        execution_time_ms: 1
      });

      expect(fetcher).toHaveBeenCalledTimes(2);
      const first = JSON.parse(fetcher.mock.calls[0][1].body);
      const second = JSON.parse(fetcher.mock.calls[1][1].body);
      expect(first.fields.execution_type).toEqual({ stringValue: 'ORDER' });
      expect(second.fields.execution_type).toEqual({ stringValue: 'SEARCH' });
    });

    it('rejects a non-object payload', async () => {
      await expect(repository.saveUsageLog(null)).rejects.toThrow(
        'logData must be an object'
      );
    });
  });

  describe('saveEntries', () => {
    it('PATCHes the entries array to entries_cache/latest and returns the doc id', async () => {
      const entries = [
        { number: 1, title: 'Short title here', points: 300, comments: 40 }
      ];

      const docId = await repository.saveEntries(entries);

      expect(docId).toBe('latest');
      expect(fetcher).toHaveBeenCalledWith(
        documentUrl('entries_cache/latest'),
        expect.objectContaining({ method: 'PATCH' })
      );

      const body = JSON.parse(fetcher.mock.calls[0][1].body);
      expect(body.fields.entries.arrayValue.values).toHaveLength(1);
      expect(body.fields.entries.arrayValue.values[0].mapValue.fields).toEqual({
        number: { integerValue: '1' },
        title: { stringValue: 'Short title here' },
        points: { integerValue: '300' },
        comments: { integerValue: '40' }
      });
      expect(body.fields.saved_at.stringValue).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('rejects a non-array payload', async () => {
      await expect(repository.saveEntries({ number: 1 })).rejects.toThrow(
        'entries must be an array'
      );
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('throws when the API responds with an error', async () => {
      fetcher.mockResolvedValueOnce(
        new Response('permission denied', { status: 403 })
      );

      await expect(repository.saveEntries([])).rejects.toThrow(
        'Firestore REST request failed (403)'
      );
    });
  });

  describe('getSystemConfig', () => {
    it('returns the defaults when the document does not exist (404)', async () => {
      fetcher.mockResolvedValueOnce(new Response('{}', { status: 404 }));

      const config = await repository.getSystemConfig();

      expect(config).toEqual({
        cron_enabled: false,
        cron_expression: '0 */6 * * *',
        frequency_hours: 6,
        last_run_hour: null
      });
    });

    it('decodes and merges the stored document with the defaults', async () => {
      fetcher.mockResolvedValueOnce(
        jsonResponse({
          name: 'projects/p/databases/(default)/documents/system_config/global',
          fields: {
            cron_enabled: { booleanValue: true },
            cron_expression: { stringValue: '0 */2 * * *' },
            frequency_hours: { integerValue: '2' },
            last_run_hour: { stringValue: '2026-09-24T13' }
          }
        })
      );

      const config = await repository.getSystemConfig();

      expect(config).toEqual({
        cron_enabled: true,
        cron_expression: '0 */2 * * *',
        frequency_hours: 2,
        last_run_hour: '2026-09-24T13'
      });
      expect(fetcher).toHaveBeenCalledWith(
        documentUrl('system_config/global'),
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('updateSystemConfig', () => {
    it('PATCHes the merged configuration to system_config/global', async () => {
      const config = await repository.updateSystemConfig({
        cron_enabled: true,
        cron_expression: '0 */1 * * *'
      });

      expect(fetcher).toHaveBeenCalledWith(
        documentUrl('system_config/global'),
        expect.objectContaining({ method: 'PATCH' })
      );

      const body = JSON.parse(fetcher.mock.calls[0][1].body);
      expect(body.fields).toEqual({
        cron_enabled: { booleanValue: true },
        cron_expression: { stringValue: '0 */1 * * *' },
        frequency_hours: { integerValue: '6' },
        last_run_hour: { nullValue: null }
      });
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
      expect(fetcher).not.toHaveBeenCalled();
    });
  });
});
