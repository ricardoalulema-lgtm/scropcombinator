// Generates a descriptive text for the execution log based on the type.
export const buildSaveReason = (executionType, frequencyLabel) =>
  executionType === 'SCHEDULED'
    ? `Scraping and save entries (${frequencyLabel})`
    : 'Scraping and save entries (manual)';

// Current hour key without minutes, e.g. "2026-09-24T15" (UTC).
export const currentHourKey = () => new Date().toISOString().slice(0, 13);

// Whole hours elapsed between two hour keys ("YYYY-MM-DDTHH").
export const hoursBetween = (fromHourKey, toHourKey) => {
  const from = Date.parse(`${fromHourKey}:00:00.000Z`);
  const to = Date.parse(`${toHourKey}:00:00.000Z`);

  if (Number.isNaN(from) || Number.isNaN(to)) {
    return null;
  }

  return Math.floor((to - from) / 3_600_000);
};

// Resolves the configured scrape frequency in hours from the stored config.
export const resolveFrequencyHours = (config) => {
  const frequencyHours = Number(config.frequency_hours);

  if (Number.isFinite(frequencyHours) && frequencyHours > 0) {
    return frequencyHours;
  }

  const match = /^0 \*\/(\d{1,3}) \* \* \*$/.exec(config.cron_expression ?? '');

  if (match) {
    return Number(match[1]);
  }

  return 1;
};

// Audit label for a scheduled run derived from the stored config, e.g. "each 1 h".
export const scheduledFrequencyLabel = (config) =>
  `each ${resolveFrequencyHours(config)} h`;
