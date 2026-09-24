const FREQUENCY_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 24];

const hoursFromCron = (cronExpression) => {
  const match = /^0 \*\/(\d{1,3}) \* \* \*$/.exec(cronExpression ?? '');
  return match ? Number(match[1]) : 2;
};

export const ScheduleConfig = ({ config, mode, onModeChange, onFrequencyChange }) => {
  if (!config) {
    return <p className="empty">Loading configuration…</p>;
  }

  const frequencyHours = hoursFromCron(config.cron_expression);

  return (
    <div className="schedule-config">
      <p className="schedule-intro">
        Choose how the top 30 entries are fetched. Manual runs from this UI; Scheduled runs on the
        Cloudflare cron trigger.
      </p>

      <div className="mode-toggle" role="radiogroup" aria-label="Execution mode">
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'manual'}
          className={`mode-segment ${mode === 'manual' ? 'active' : ''}`}
          onClick={() => onModeChange('manual')}
        >
          <span className="mode-segment-title">Manual</span>
          <span className="mode-segment-hint">Run on demand</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'scheduled'}
          className={`mode-segment ${mode === 'scheduled' ? 'active' : ''}`}
          onClick={() => onModeChange('scheduled')}
        >
          <span className="mode-segment-title">Scheduled</span>
          <span className="mode-segment-hint">Cron on Workers</span>
        </button>
      </div>

      {mode === 'scheduled' && (
        <label className="frequency-field">
          <span>How often?</span>
          <select
            value={frequencyHours}
            onChange={(event) => onFrequencyChange(Number(event.target.value))}
          >
            {FREQUENCY_OPTIONS.map((hours) => (
              <option key={hours} value={hours}>
                Every {hours} hour{hours > 1 ? 's' : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="schedule-meta">
        <code>
          {config.cron_enabled ? 'enabled' : 'disabled'} · {config.cron_expression}
        </code>
      </div>
    </div>
  );
};

export default ScheduleConfig;
