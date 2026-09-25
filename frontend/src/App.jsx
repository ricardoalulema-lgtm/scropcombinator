import { useEffect, useMemo, useState } from 'react';
import TopBar from './components/TopBar.jsx';
import Modal from './components/Modal.jsx';
import FilterControls from './components/FilterControls.jsx';
import ResultsTable from './components/ResultsTable.jsx';
import AuditLogsTable from './components/AuditLogsTable.jsx';
import ScheduleConfig from './components/ScheduleConfig.jsx';
import { fetchEntries, scrapeNow, getSystemConfig, updateSystemConfig, saveUsageLog } from './services/api.js';
import { subscribeUsageLogsPage, countUsageLogs, subscribeEntriesCache } from './services/firebase.js';
import { applyViewOptions, countWords } from './utils/entriesView.js';
import './App.css';

const hoursToCron = (hours) => `0 */${hours} * * *`;

export default function App() {
  const [selectedFilter, setSelectedFilter] = useState('NO_FILTER');
  const [cachedEntries, setCachedEntries] = useState([]);
  const [results, setResults] = useState(null);
  const [meta, setMeta] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsError, setLogsError] = useState(null);
  const [logPage, setLogPage] = useState(0);
  const [logPageSize, setLogPageSize] = useState(20);
  const [logTotal, setLogTotal] = useState(null);
  const [logCursors, setLogCursors] = useState([null]);
  const [config, setConfig] = useState(null);
  const [mode, setMode] = useState('manual');
  const [frequencyHours, setFrequencyHours] = useState(2);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [openPanel, setOpenPanel] = useState(null);
  const [textQuery, setTextQuery] = useState('');
  const [sortField, setSortField] = useState(null);
  const [wordCount, setWordCount] = useState(null);

  const displayedResults = results ?? cachedEntries;
  const resultsSource = results ? 'api' : cachedEntries.length > 0 ? 'cache' : 'empty';

  const wordCountOptions = useMemo(() => {
    const counts = new Set(displayedResults.map((entry) => countWords(entry.title)));
    return [...counts].sort((a, b) => a - b);
  }, [displayedResults]);

  const viewResults = useMemo(
    () =>
      applyViewOptions(displayedResults, {
        text: textQuery,
        wordCount,
        sortField
      }),
    [displayedResults, textQuery, wordCount, sortField]
  );

  useEffect(() => {
    const unsubscribeEntries = subscribeEntriesCache(
      setCachedEntries,
      (err) => setError(err.message)
    );

    return () => {
      unsubscribeEntries();
    };
  }, []);

  // One query per page change: at most `logPageSize` rows (10/20/50).
  useEffect(() => {
    const cursor = logCursors[logPage] ?? null;

    const unsubscribeLogs = subscribeUsageLogsPage(
      cursor,
      logPageSize,
      (docs) => {
        setLogs(docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })));

        // Remember where the next page starts (cursor = last doc of this page).
        if (docs.length === logPageSize) {
          setLogCursors((previous) =>
            previous.length === logPage + 1
              ? [...previous, docs[docs.length - 1]]
              : previous
          );
        }
      },
      (err) => setLogsError(err.message)
    );

    return () => {
      unsubscribeLogs();
    };
    // `logCursors` is deliberately not a dependency: cursor pushes happen
    // while the current page is open and must not re-run this query.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [logPage, logPageSize]);

  // Total row count, refreshed on every page / page-size change.
  useEffect(() => {
    let cancelled = false;

    countUsageLogs()
      .then((count) => {
        if (!cancelled) setLogTotal(count);
      })
      .catch(() => {
        if (!cancelled) setLogTotal(null);
      });

    return () => {
      cancelled = true;
    };
  }, [logPage, logPageSize]);

  const hasLogNext =
    logCursors[logPage + 1] != null &&
    (logTotal === null || (logPage + 1) * logPageSize < logTotal);

  const changeLogPageSize = (size) => {
    setLogCursors([null]);
    setLogPageSize(size);
    setLogPage(0);
    setLogs([]);
  };

  useEffect(() => {
    let cancelled = false;

    getSystemConfig()
      .then((data) => {
        if (cancelled) return;
        setConfig(data);
        setMode(data.cron_enabled ? 'scheduled' : 'manual');
        const match = /^0 \*\/(\d{1,3}) \* \* \*$/.exec(data.cron_expression ?? '');
        const fallbackHours = match ? Number(match[1]) : 2;
        setFrequencyHours(Number(data.frequency_hours) || fallbackHours);
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
      cron_expression: hoursToCron(frequencyHours),
      frequency_hours: frequencyHours
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
      current
        ? {
            ...current,
            cron_expression: hoursToCron(hours),
            frequency_hours: hours
          }
        : current
    );
  };

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    setConfig((current) =>
      current
        ? {
            ...current,
            cron_enabled: nextMode === 'scheduled',
            cron_expression: hoursToCron(frequencyHours),
            frequency_hours: frequencyHours
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

  const logViewAction = async (executionType, filterApplied, resultsCount, executionTimeMs) => {
    try {
      await saveUsageLog({
        timestamp: new Date().toISOString(),
        filter_applied: filterApplied,
        results_count: resultsCount,
        execution_type: executionType,
        execution_time_ms: executionTimeMs
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSortChange = (field) => {
    const started = performance.now();
    const nextSort = sortField === field ? null : field;
    setSortField(nextSort);

    const nextCount = applyViewOptions(displayedResults, {
      text: textQuery,
      wordCount,
      sortField: nextSort
    }).length;

    const elapsed = Math.round(performance.now() - started);
    const label = field === 'points' ? 'Order by points' : 'Order by comments';
    void logViewAction('ORDER', label, nextCount, elapsed);
  };

  const handleWordCountChange = (nextCount) => {
    if (nextCount === null) {
      setWordCount(null);
      return;
    }

    const started = performance.now();
    setWordCount(nextCount);

    const nextList = applyViewOptions(displayedResults, {
      text: textQuery,
      wordCount: nextCount,
      sortField
    });
    const elapsed = Math.round(performance.now() - started);

    void logViewAction('SEARCH', `filter by ${nextCount} words`, nextList.length, elapsed);
  };

  const handleTextQueryChange = (value) => {
    setTextQuery(value);
  };

  return (
    <div className="app-shell">
      <TopBar
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

        <ResultsTable
          results={viewResults}
          meta={meta}
          source={resultsSource}
          textQuery={textQuery}
          onTextQueryChange={handleTextQueryChange}
          sortField={sortField}
          onSortChange={handleSortChange}
          wordCount={wordCount}
          onWordCountChange={handleWordCountChange}
          wordCountOptions={wordCountOptions}
        />
      </main>

      <Modal open={openPanel === 'logs'} title="Audit logs" onClose={() => setOpenPanel(null)}>
        <AuditLogsTable
          logs={logs}
          error={logsError}
          page={logPage}
          pageSize={logPageSize}
          total={logTotal}
          hasNext={hasLogNext}
          onPrev={() => setLogPage((current) => Math.max(0, current - 1))}
          onNext={() => setLogPage((current) => current + 1)}
          onPageSizeChange={changeLogPageSize}
        />
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
