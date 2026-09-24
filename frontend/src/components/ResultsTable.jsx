export const ResultsTable = ({
  results,
  meta,
  source,
  textQuery,
  onTextQueryChange,
  sortField,
  onSortChange,
  wordCount,
  onWordCountChange,
  wordCountOptions
}) => {
  const sourceLabel = meta
    ? meta.filter
    : source === 'cache'
      ? 'No filter · cached (realtime)'
      : 'Waiting for data';

  const sortIndicator = (field) => {
    if (sortField !== field) return '';
    return ' ▼';
  };

  const headerClass = (field) =>
    `th-sortable${sortField === field ? ' th-sortable-active' : ''}`;

  return (
    <section className="results panel-main" aria-label="Results">
      <div className="results-header">
        <div>
          <h2>Results</h2>
          <p className="meta">{sourceLabel}</p>
        </div>
        <div className="results-stats">
          <label className="results-text-filter">
            <span className="sr-only">Filter by text</span>
            <input
              type="search"
              value={textQuery}
              onChange={(event) => onTextQueryChange(event.target.value)}
              placeholder="Filter by text…"
              aria-label="Filter entries by text"
            />
          </label>
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
                <th className="col-title">
                  <span className="title-header">
                    <span>Title</span>
                    <label className="word-count-label">
                      <span className="sr-only">Words</span>
                      <select
                        value={wordCount ?? ''}
                        onChange={(event) =>
                          onWordCountChange(event.target.value === '' ? null : Number(event.target.value))
                        }
                        aria-label="Filter by exact word count in title"
                      >
                        <option value="">Words</option>
                        {wordCountOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                  </span>
                </th>
                <th
                  className={`col-points ${headerClass('points')}`}
                  scope="col"
                  onClick={() => onSortChange('points')}
                  title="Sort by points"
                >
                  Points{sortIndicator('points')}
                </th>
                <th
                  className={`col-comments ${headerClass('comments')}`}
                  scope="col"
                  onClick={() => onSortChange('comments')}
                  title="Sort by comments"
                >
                  Comments{sortIndicator('comments')}
                </th>
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
