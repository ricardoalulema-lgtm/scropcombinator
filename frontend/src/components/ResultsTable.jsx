export const ResultsTable = ({ results, meta }) => (
  <section className="panel">
    <h2>Results</h2>
    {meta && (
      <p className="meta">
        {meta.filter} · {meta.results_count} entries · {meta.execution_time_ms} ms
      </p>
    )}
    {results.length === 0 ? (
      <p className="empty">No results yet. Select a filter and run it.</p>
    ) : (
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Title</th>
            <th>Points</th>
            <th>Comments</th>
          </tr>
        </thead>
        <tbody>
          {results.map((entry) => (
            <tr key={entry.number}>
              <td>{entry.number}</td>
              <td>{entry.title}</td>
              <td>{entry.points}</td>
              <td>{entry.comments}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </section>
);

export default ResultsTable;
