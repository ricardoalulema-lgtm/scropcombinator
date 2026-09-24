import { describe, it, expect } from 'vitest';
import {
  buildSaveReason,
  currentHourKey,
  hoursBetween,
  resolveFrequencyHours,
  scheduledFrequencyLabel
} from '../src/utils/schedule.js';

describe('schedule utils', () => {
  describe('buildSaveReason', () => {
    it('builds the scheduled reason with the provided label', () => {
      expect(buildSaveReason('SCHEDULED', 'each 1 h')).toBe(
        'Scraping and save entries (each 1 h)'
      );
    });

    it('builds the manual reason ignoring the label', () => {
      expect(buildSaveReason('MANUAL', 'each 1 h')).toBe(
        'Scraping and save entries (manual)'
      );
    });
  });

  describe('currentHourKey', () => {
    it('returns the current UTC hour key without minutes', () => {
      expect(currentHourKey()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
      expect(currentHourKey()).toBe(new Date().toISOString().slice(0, 13));
    });
  });

  describe('hoursBetween', () => {
    it('returns whole elapsed hours between hour keys', () => {
      expect(hoursBetween('2026-09-24T14', '2026-09-24T17')).toBe(3);
    });

    it('handles ranges across midnight', () => {
      expect(hoursBetween('2026-09-24T23', '2026-09-25T02')).toBe(3);
    });

    it('returns null for invalid keys', () => {
      expect(hoursBetween('not-a-date', '2026-09-24T17')).toBeNull();
    });
  });

  describe('resolveFrequencyHours', () => {
    it('prefers frequency_hours over cron_expression', () => {
      expect(
        resolveFrequencyHours({ frequency_hours: 1, cron_expression: '0 */2 * * *' })
      ).toBe(1);
    });

    it('falls back to the cron expression when frequency_hours is missing', () => {
      expect(resolveFrequencyHours({ cron_expression: '0 */6 * * *' })).toBe(6);
    });

    it('defaults to 1 when config is empty', () => {
      expect(resolveFrequencyHours({})).toBe(1);
    });
  });

  describe('scheduledFrequencyLabel', () => {
    it('derives the label from the stored frequency', () => {
      expect(scheduledFrequencyLabel({ frequency_hours: 1 })).toBe('each 1 h');
      expect(scheduledFrequencyLabel({ frequency_hours: 24 })).toBe('each 24 h');
    });
  });
});
