export const AuditLogsTable = ({
  logs,
  error,
  page,
  pageSize,
  total,
  hasNext,
  onPrev,
  onNext,
  onPageSizeChange
}) => {
  const totalPages =
    total === null || total === undefined
      ? null
      : Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="audit-logs">
      <p className="schedule-intro">
        Live audit trail from Firestore <code>usage_logs</code> (realtime via
        onSnapshot). Total rows: <strong>{total ?? '—'}</strong>
      </p>

      <div className="logs-pagination">
        <label className="logs-page-size">
          Rows per page
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        </label>

        <button
          type="button"
          className="button-ghost"
          onClick={onPrev}
          disabled={page === 0}
        >
          ‹ Previous
        </button>

        <span className="logs-page-info">
          Page {page + 1}
          {totalPages !== null ? ` of ${totalPages}` : ''}
        </span>

        <button
          type="button"
          className="button-ghost"
          onClick={onNext}
          disabled={!hasNext}
        >
          Next ›
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {logs.length === 0 && !error ? (
        <p className="empty">
          {page > 0 ? 'No rows on this page.' : 'Waiting for Firestore usage_logs…'}
        </p>
      ) : (
        <div className="results-scroll logs-scroll">
          <table className="results-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Timestamp</th>
                <th>Filter applied</th>
                <th>Results</th>
                <th>Type</th>
                <th>Time (ms)</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, index) => (
                <tr key={log.id}>
                  <td>{page * pageSize + index + 1}</td>
                  <td className="log-time">{log.timestamp}</td>
                  <td>{log.filter_applied}</td>
                  <td>{log.results_count}</td>
                  <td>
                    <span className={`badge ${String(log.execution_type).toLowerCase()}`}>
                      {log.execution_type}
                    </span>
                  </td>
                  <td>{log.execution_time_ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AuditLogsTable;
