// Unified top bar for AgentGuardian UI
export function initTopBar() {
  const pageTitle = document.querySelector('h1')?.textContent || 'Dashboard';
  
  const topbarHTML = `
    <header class="unified-topbar">
      <div class="topbar-left">
        <h1 class="topbar-title">${pageTitle}</h1>
      </div>
      
      <div class="topbar-center">
        <div class="search-bar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="text" placeholder="Search agents, transactions..." />
        </div>
      </div>
      
      <div class="topbar-right">
        <div class="defcon-badge">
          <div class="defcon-dot"></div>
          <span class="defcon-status">DEFCON-1</span>
        </div>
        
        <div class="threats-counter">
          <span class="threats-label">THREATS BLOCKED</span>
          <span class="threats-badge">0</span>
        </div>
        
        <button class="icon-btn notification-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <span class="notification-badge">0</span>
        </button>
        
        <button class="icon-btn settings-btn" onclick="window.location.href='settings.html'">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        
        <button class="icon-btn avatar-btn">
          <span>AD</span>
        </button>
      </div>
    </header>
  `;

  // Prepend topbar to body (after sidebar)
  const sidebar = document.querySelector('.unified-sidebar');
  if (sidebar) {
    sidebar.insertAdjacentHTML('afterend', topbarHTML);
  } else {
    document.body.insertAdjacentHTML('afterbegin', topbarHTML);
  }

  // Add CSS styles
  const style = document.createElement('style');
  style.textContent = `
    .unified-topbar {
      position: sticky;
      top: 0;
      left: 256px;
      right: 0;
      height: 64px;
      background: #e8eaf0;
      box-shadow: 0 6px 12px rgba(0,0,0,0.08), 0 -6px 12px rgba(255,255,255,0.6);
      z-index: 50;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 32px;
    }

    .topbar-left {
      flex: 0 0 auto;
    }

    .topbar-title {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 20px;
      font-weight: 700;
      color: #1e293b;
      margin: 0;
    }

    .topbar-center {
      flex: 1;
      display: flex;
      justify-content: center;
    }

    .search-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 320px;
      padding: 10px 16px;
      border-radius: 9999px;
      background: #e8eaf0;
      box-shadow: inset 4px 4px 8px rgba(0,0,0,0.06), inset -4px -4px 8px rgba(255,255,255,0.6);
    }

    .search-bar input {
      flex: 1;
      border: none;
      background: transparent;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 14px;
      color: #1e293b;
      outline: none;
    }

    .search-bar input::placeholder {
      color: #94a3b8;
    }

    .topbar-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .defcon-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 9999px;
      background: #e8eaf0;
      box-shadow: 4px 4px 8px rgba(0,0,0,0.04), -4px -4px 8px rgba(255,255,255,0.6);
    }

    .defcon-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
    }

    .defcon-status {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 12px;
      font-weight: 600;
      color: #1e293b;
    }

    .threats-counter {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      padding: 4px 12px;
      border-radius: 8px;
      background: #e8eaf0;
      box-shadow: 4px 4px 8px rgba(0,0,0,0.04), -4px -4px 8px rgba(255,255,255,0.6);
    }

    .threats-label {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 10px;
      font-weight: 500;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .threats-badge {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 16px;
      font-weight: 700;
      color: #1e293b;
    }

    .icon-btn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: none;
      background: #e8eaf0;
      box-shadow: 4px 4px 8px rgba(0,0,0,0.04), -4px -4px 8px rgba(255,255,255,0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s;
      color: #64748b;
      position: relative;
    }

    .icon-btn:hover {
      box-shadow: 2px 2px 4px rgba(0,0,0,0.04), -2px -2px 4px rgba(255,255,255,0.6);
      color: #1e293b;
    }

    .notification-badge {
      position: absolute;
      top: 0;
      right: 0;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #dc2626;
      color: white;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 10px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid #e8eaf0;
    }

    .avatar-btn {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 14px;
      font-weight: 600;
      color: #6366f1;
    }
  `;
  document.head.appendChild(style);

  // Load top bar data
  if (window.AG && window.AG.loadTopBar) {
    window.AG.loadTopBar();
  } else {
    // Retry after client.js has loaded
    window.addEventListener('ag:ready', () => window.AG.loadTopBar());
  }
}
