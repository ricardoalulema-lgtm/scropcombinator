const FREQUENCY_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 24];

const hoursFromCron = (cronExpression) => {
  const match = /^0 \*\/(\d{1,3}) \* \* \*$/.exec(cronExpression ?? '');
  return match ? Number(match[1]) : 2;
};

export const ScheduleConfig = ({ config, mode, onModeChange, onFrequencyChange, onSave, saving }) => {
  if (!config) {
    return (
      <section className="panel">
        <h2>Execution mode</h2>
        <p className="empty">Loading configuration…</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Execution mode</h2>
      <div className="mode-options" role="radiogroup" aria-label="Execution mode">
        <label className={`mode-option ${mode === 'manual' ? 'selected' : ''}`}>
          <input
            type="radio"
            name="execution-mode"
            value="manual"
            checked={mode === 'manual'}
            onChange={() => onModeChange('manual')}
          />
          <span className="mode-label">Manual (on-demand)</span>
          <span className="mode-description">Cron disabled; run scrapes yourself from the UI</span>
        </label>
        <label className={`mode-option ${mode === 'scheduled' ? 'selected' : ''}`}>
          <input
            type="radio"
            name="execution-mode"
            value="scheduled"
            checked={mode === 'scheduled'}
            onChange={() => onModeChange('scheduled')}
          />
          <span className="mode-label">Scheduled (cron)</span>
          <span className="mode-description">Cloudflare Worker cron trigger scrapes automatically</span>
        </label>
      </div>

      {mode === 'scheduled' && (
        <div className="frequency-row">
          <label htmlFor="frequency">Frequency</label>
          <select
            id="frequency"
            value={hoursFromCron(config.cron_expression)}
            onChange={(event) => onFrequencyChange(Number(event.target.value))}
          >
            {FREQUENCY_OPTIONS.map((hours) => (
              <option key={hours} value={hours}>
                Each {hours} h
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="actions">
        <button type="button" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save configuration'}
        </button>
        <span className="meta">
          cron_enabled: {String(config.cron_enabled)} · {config.cron_expression}
        </span>
      </div>
    </section>
  );
};

export default ScheduleConfig;
