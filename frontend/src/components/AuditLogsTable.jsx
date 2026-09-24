export const AuditLogsTable = ({ logs, error }) => (
  <section className="panel">
    <h2>Audit logs (realtime)</h2>
    {error && <p className="error">{error}</p>}
    {logs.length === 0 && !error ? (
      <p className="empty">Waiting for Firestore usage_logs…</p>
    ) : (
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Filter applied</th>
            <th>Results</th>
            <th>Type</th>
            <th>Time (ms)</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td>{log.timestamp}</td>
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
    )}
  </section>
);

export default AuditLogsTable;
