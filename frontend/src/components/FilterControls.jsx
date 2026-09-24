const FILTERS = [
  {
    id: 'NO_FILTER',
    label: 'All entries',
    hint: 'No filter · original order',
    icon: '☰'
  },
  {
    id: 'MORE_THAN_5_WORDS_BY_COMMENTS',
    label: '> 5 words',
    hint: 'Long titles · by comments',
    icon: '💬'
  },
  {
    id: 'LESS_OR_EQUAL_5_WORDS_BY_POINTS',
    label: '≤ 5 words',
    hint: 'Short titles · by points',
    icon: '★'
  }
];

export const FilterControls = ({ selectedFilter, onSelectFilter, onRun, onScrape, loading }) => (
  <section className="filter-bar" aria-label="Filter controls">
    <div className="filter-bar-row">
      <div className="chip-group" role="radiogroup" aria-label="Choose a filter">
        {FILTERS.map((filter) => {
          const active = selectedFilter === filter.id;

          return (
            <button
              key={filter.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`chip ${active ? 'chip-active' : ''}`}
              onClick={() => onSelectFilter(filter.id)}
              title={filter.hint}
            >
              <span className="chip-icon" aria-hidden="true">
                {filter.icon}
              </span>
              <span className="chip-label">{filter.label}</span>
            </button>
          );
        })}
      </div>

      <div className="filter-bar-actions">
        <button type="button" className="button-primary" onClick={onRun} disabled={loading}>
          {loading ? 'Working…' : selectedFilter === 'NO_FILTER' ? 'Load all' : 'Apply filter'}
        </button>
        <button type="button" className="button-ghost" onClick={onScrape} disabled={loading}>
          Scrape &amp; save
        </button>
      </div>
    </div>

    <p className="filter-bar-hint">
      {FILTERS.find((filter) => filter.id === selectedFilter)?.hint}
    </p>
  </section>
);

export default FilterControls;
