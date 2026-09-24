const FILTERS = [
  {
    id: 'MORE_THAN_5_WORDS_BY_COMMENTS',
    label: 'More than 5 words (by comments)',
    description: 'Titles with more than 5 words, sorted by comments desc'
  },
  {
    id: 'LESS_OR_EQUAL_5_WORDS_BY_POINTS',
    label: '5 words or fewer (by points)',
    description: 'Titles with 5 words or fewer, sorted by points desc'
  }
];

export const FilterControls = ({ selectedFilter, onSelectFilter, onRun, onScrape, loading }) => (
  <section className="panel">
    <h2>Filters</h2>
    <div className="filter-options" role="radiogroup" aria-label="Filter selector">
      {FILTERS.map((filter) => (
        <label
          key={filter.id}
          className={`filter-option ${selectedFilter === filter.id ? 'selected' : ''}`}
        >
          <input
            type="radio"
            name="filter"
            value={filter.id}
            checked={selectedFilter === filter.id}
            onChange={() => onSelectFilter(filter.id)}
          />
          <span className="filter-label">{filter.label}</span>
          <span className="filter-description">{filter.description}</span>
        </label>
      ))}
    </div>
    <div className="actions">
      <button type="button" onClick={onRun} disabled={loading}>
        {loading ? 'Running…' : 'Run filter'}
      </button>
      <button type="button" className="secondary" onClick={onScrape} disabled={loading}>
        Scrape &amp; save now
      </button>
    </div>
  </section>
);

export default FilterControls;
