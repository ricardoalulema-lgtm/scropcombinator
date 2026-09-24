export const ResultsTable = ({ results, meta, source }) => {
  const sourceLabel = meta
    ? meta.filter
    : source === 'cache'
      ? 'No filter · cached (realtime)'
      : 'Waiting for data';

  return (
    <section className="results panel-main" aria-label="Results">
      <div className="results-header">
        <div>
          <h2>Results</h2>
          <p className="meta">{sourceLabel}</p>
        </div>
        <div className="results-stats">
          <span className="stat">
            <strong>{results.length}</strong>
            entries
          </span>
          {meta && (
            <span className="stat">
              <strong>{meta.execution_time_ms}</strong>
              ms
            </span>
          )}
        </div>
      </div>

      {results.length === 0 ? (
        <div className="results-empty">
          <p>No entries yet.</p>
          <p className="empty">They will appear here from the cache, or use Load all / Apply filter.</p>
        </div>
      ) : (
        <div className="results-scroll">
          <table className="results-table">
            <thead>
              <tr>
                <th className="col-number">#</th>
                <th>Title</th>
                <th className="col-points">Points</th>
                <th className="col-comments">Comments</th>
              </tr>
            </thead>
            <tbody>
              {results.map((entry) => (
                <tr key={entry.number}>
                  <td className="col-number">{entry.number}</td>
                  <td className="col-title">{entry.title}</td>
                  <td className="col-points">
                    <span className="badge-stat">{entry.points}</span>
                  </td>
                  <td className="col-comments">
                    <span className="badge-stat">{entry.comments}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default ResultsTable;
