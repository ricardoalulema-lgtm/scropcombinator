import { useEffect, useState } from 'react';
import TopBar from './components/TopBar.jsx';
import Modal from './components/Modal.jsx';
import FilterControls from './components/FilterControls.jsx';
import ResultsTable from './components/ResultsTable.jsx';
import AuditLogsTable from './components/AuditLogsTable.jsx';
import ScheduleConfig from './components/ScheduleConfig.jsx';
import { fetchEntries, scrapeNow, getSystemConfig, updateSystemConfig } from './services/api.js';
import { subscribeUsageLogs, subscribeEntriesCache } from './services/firebase.js';
import './App.css';

const hoursToCron = (hours) => `0 */${hours} * * *`;

export default function App() {
  const [selectedFilter, setSelectedFilter] = useState('NO_FILTER');
  const [cachedEntries, setCachedEntries] = useState([]);
  const [results, setResults] = useState(null);
  const [meta, setMeta] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsError, setLogsError] = useState(null);
  const [config, setConfig] = useState(null);
  const [mode, setMode] = useState('manual');
  const [frequencyHours, setFrequencyHours] = useState(2);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [openPanel, setOpenPanel] = useState(null);

  const displayedResults = results ?? cachedEntries;
  const resultsSource = results ? 'api' : cachedEntries.length > 0 ? 'cache' : 'empty';

  useEffect(() => {
    const unsubscribeLogs = subscribeUsageLogs(setLogs, (err) => setLogsError(err.message));
    const unsubscribeEntries = subscribeEntriesCache(
      setCachedEntries,
      (err) => setError(err.message)
    );

    return () => {
      unsubscribeLogs();
      unsubscribeEntries();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    getSystemConfig()
      .then((data) => {
        if (cancelled) return;
        setConfig(data);
        setMode(data.cron_enabled ? 'scheduled' : 'manual');
        const match = /^0 \*\/(\d{1,3}) \* \* \*$/.exec(data.cron_expression ?? '');
        setFrequencyHours(match ? Number(match[1]) : 2);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const runFilter = async () => {
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const data = await fetchEntries(selectedFilter);
      setResults(data.results);
      setMeta(data);
      setNotice(
        selectedFilter === 'NO_FILTER'
          ? `Loaded ${data.results_count} entries in ${data.execution_time_ms} ms`
          : `Filter ${data.filter} completed in ${data.execution_time_ms} ms`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const runScrape = async () => {
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const data = await scrapeNow();
      setResults(null);
      setMeta(null);
      setNotice(`Saved ${data.entries_count} entries in ${data.execution_time_ms} ms`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);

    const payload = {
      cron_enabled: mode === 'scheduled',
      cron_expression: hoursToCron(frequencyHours)
    };

    try {
      const data = await updateSystemConfig(payload);
      setConfig(data);
      setNotice('Execution settings saved');
      setOpenPanel(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleFrequencyChange = (hours) => {
    setFrequencyHours(hours);
    setConfig((current) =>
      current ? { ...current, cron_expression: hoursToCron(hours) } : current
    );
  };

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    setConfig((current) =>
      current
        ? {
            ...current,
            cron_enabled: nextMode === 'scheduled',
            cron_expression: hoursToCron(frequencyHours)
          }
        : current
    );
  };

  const handleSelectFilter = (filterId) => {
    setSelectedFilter(filterId);

    if (filterId === 'NO_FILTER') {
      setResults(null);
      setMeta(null);
    }
  };

  return (
    <div className="app-shell">
      <TopBar
        logCount={logs.length}
        mode={mode}
        onOpenLogs={() => setOpenPanel('logs')}
        onOpenSchedule={() => setOpenPanel('schedule')}
      />

      <main className="app-main">
        {notice && <p className="notice">{notice}</p>}
        {error && <p className="error">{error}</p>}

        <FilterControls
          selectedFilter={selectedFilter}
          onSelectFilter={handleSelectFilter}
          onRun={runFilter}
          onScrape={runScrape}
          loading={loading}
        />

        <ResultsTable results={displayedResults} meta={meta} source={resultsSource} />
      </main>

      <Modal open={openPanel === 'logs'} title="Audit logs" onClose={() => setOpenPanel(null)}>
        <AuditLogsTable logs={logs} error={logsError} />
      </Modal>

      <Modal
        open={openPanel === 'schedule'}
        title="Execution type"
        onClose={() => setOpenPanel(null)}
        footer={
          <button type="button" className="button-primary" onClick={saveConfig} disabled={saving}>
            {saving ? 'Saving…' : 'Save execution settings'}
          </button>
        }
      >
        <ScheduleConfig
          config={config}
          mode={mode}
          onModeChange={handleModeChange}
          onFrequencyChange={handleFrequencyChange}
        />
      </Modal>
    </div>
  );
}
