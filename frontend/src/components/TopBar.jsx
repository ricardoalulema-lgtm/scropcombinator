export const TopBar = ({ onOpenLogs, onOpenSchedule, mode }) => (
  <header className="topbar">
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        Y
      </span>
      <div className="brand-text">
        <strong>Hacker News Scraper</strong>
        <span>Top 30 · filters · audit · cron</span>
      </div>
    </div>

    <nav className="topbar-menu" aria-label="App menu">
      <button type="button" className="menu-button" onClick={onOpenSchedule}>
        <span className="menu-button-label">Execution</span>
        <span className={`pill ${mode === 'scheduled' ? 'pill-success' : 'pill-muted'}`}>
          {mode === 'scheduled' ? 'Scheduled' : 'Manual'}
        </span>
      </button>
      <button type="button" className="menu-button" onClick={onOpenLogs}>
        <span className="menu-button-label">Logs</span>
      </button>
    </nav>
  </header>
);

export default TopBar;
