// Unified navigation sidebar for AgentGuardian UI
export function initNav(activePage) {
  const navHTML = `
    <aside class="unified-sidebar">
      <div class="sidebar-header">
        <div class="sidebar-logo">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="6" fill="#6366f1"/>
            <path d="M16 6L6 11V21L16 26L26 21V11L16 6Z" stroke="white" stroke-width="2" fill="none"/>
            <path d="M16 10V22M10 14L16 10L22 14" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="sidebar-title">AgentGuardian</div>
        <div class="sidebar-subtitle">Enterprise Shield</div>
      </div>

      <nav class="sidebar-nav">
        <div class="nav-section-label">MAIN</div>
        <a href="dashboard.html" class="nav-link ${activePage === 'dashboard' ? 'active' : ''}" data-page="dashboard">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7"/>
            <rect x="14" y="3" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/>
          </svg>
          <span>Dashboard</span>
        </a>
        <a href="#" class="nav-link" onclick="event.preventDefault(); toast('Threat Intel module — coming in v2.1', 'info')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <span>Threat Intel</span>
        </a>

        <div class="nav-section-label">AGENT NETWORK</div>
        <a href="agent-registry.html" class="nav-link ${activePage === 'agents' ? 'active' : ''}" data-page="agents">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="8" r="5"/>
            <path d="M3 21c0-4 4-7 9-7s9 3 9 7"/>
          </svg>
          <span>Agents</span>
        </a>
        <a href="system-logs.html" class="nav-link ${activePage === 'system-logs' ? 'active' : ''}" data-page="system-logs">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          <span>System Logs</span>
        </a>
        <a href="council-deliberation.html" class="nav-link ${activePage === 'council' ? 'active' : ''}" data-page="council">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <span>Council</span>
        </a>
        <a href="analytics.html" class="nav-link ${activePage === 'analytics' ? 'active' : ''}" data-page="analytics">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="20" x2="18" y2="10"/>
            <line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
          <span>Analytics</span>
        </a>

        <div class="nav-section-label">SECURITY LAYERS</div>
        <a href="zk-ml.html" class="nav-link ${activePage === 'zk-ml' ? 'active' : ''}" data-page="zk-ml">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4"/>
            <polyline points="14 2 14 8 20 8"/>
            <path d="M2 15h10"/>
            <path d="M9 18l3-3-3-3"/>
          </svg>
          <span>ZK-ML Dive</span>
        </a>
        <a href="vaccine-shield.html" class="nav-link ${activePage === 'vaccine-shield' ? 'active' : ''}" data-page="vaccine-shield">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
            <polyline points="14 2 14 8 20 8"/>
            <path d="M12 18v-6"/>
            <path d="M8 15l4 3 4-3"/>
          </svg>
          <span>Vaccine Shield</span>
        </a>
        <a href="cross-chain-sentinel.html" class="nav-link ${activePage === 'chain-monitors' ? 'active' : ''}" data-page="chain-monitors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
          </svg>
          <span>Chain Monitors</span>
        </a>
        <a href="neural-symbolic.html" class="nav-link ${activePage === 'symbolic-verifier' ? 'active' : ''}" data-page="symbolic-verifier">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/>
            <path d="M8.5 8.5v.01"/>
            <path d="M16 15.5v.01"/>
            <path d="M12 12v.01"/>
            <path d="M11 17v.01"/>
            <path d="M7 14v.01"/>
          </svg>
          <span>Symbolic Verifier</span>
        </a>

        <div class="nav-section-label">INSURANCE</div>
        <a href="insurance-pool.html" class="nav-link ${activePage === 'insurance-pool' ? 'active' : ''}" data-page="insurance-pool">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <span>Insurance Pool</span>
        </a>
        <a href="batch-proofs.html" class="nav-link ${activePage === 'batch-proofs' ? 'active' : ''}" data-page="batch-proofs">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
          <span>Batch Proofs</span>
        </a>
        <a href="nanopayments.html" class="nav-link ${activePage === 'nanopayments' ? 'active' : ''}" data-page="nanopayments">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
            <line x1="1" y1="10" x2="23" y2="10"/>
          </svg>
          <span>Nanopayments</span>
        </a>

        <div class="nav-section-label">SYSTEM</div>
        <a href="architecture.html" class="nav-link ${activePage === 'architecture' ? 'active' : ''}" data-page="architecture">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M3 9h18"/>
            <path d="M9 21V9"/>
          </svg>
          <span>Architecture</span>
        </a>
        <a href="layer6f-research.html" class="nav-link ${activePage === 'layer-6f' ? 'active' : ''}" data-page="layer-6f">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4"/>
            <path d="M12 8h.01"/>
          </svg>
          <span>Layer 6F Research</span>
        </a>
        <a href="settings.html" class="nav-link ${activePage === 'settings' ? 'active' : ''}" data-page="settings">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          <span>Settings</span>
        </a>
      </nav>

      <div class="sidebar-footer">
        <button class="lock-btn" onclick="toast('System locked — admin only', 'error')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span>Lock System</span>
        </button>
        <a href="#" class="support-link" onclick="event.preventDefault(); toast('Support — contact admin@agentguardian.io', 'info')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>Support</span>
        </a>
      </div>
    </aside>
  `;

  // Prepend sidebar to body
  document.body.insertAdjacentHTML('afterbegin', navHTML);

  // Add CSS styles
  const style = document.createElement('style');
  style.textContent = `
    .unified-sidebar {
      position: fixed;
      left: 0;
      top: 0;
      width: 256px;
      height: 100vh;
      background: #e8eaf0;
      box-shadow: 6px 0px 12px rgba(0,0,0,0.05);
      z-index: 40;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }

    .sidebar-header {
      padding: 24px 20px;
      border-bottom: 1px solid rgba(0,0,0,0.05);
    }

    .sidebar-logo {
      margin-bottom: 12px;
    }

    .sidebar-title {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 18px;
      font-weight: 700;
      color: #6366f1;
      margin-bottom: 4px;
    }

    .sidebar-subtitle {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 12px;
      color: #64748b;
    }

    .sidebar-nav {
      flex: 1;
      padding: 16px 12px;
    }

    .nav-section-label {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #94a3b8;
      padding: 16px 16px 4px;
    }

    .nav-link {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
      border-radius: 8px;
      color: #64748b;
      text-decoration: none;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s;
      margin-bottom: 2px;
    }

    .nav-link:hover {
      color: #334155;
      box-shadow: 4px 4px 8px rgba(0,0,0,0.04), -4px -4px 8px rgba(255,255,255,0.6);
    }

    .nav-link.active {
      color: #6366f1;
      font-weight: 600;
      box-shadow: inset 4px 4px 8px rgba(0,0,0,0.06), inset -4px -4px 8px rgba(255,255,255,0.5);
    }

    .nav-link svg {
      flex-shrink: 0;
    }

    .sidebar-footer {
      padding: 16px 12px;
      border-top: 1px solid rgba(0,0,0,0.05);
    }

    .lock-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 10px 16px;
      border: none;
      border-radius: 8px;
      background: #e8eaf0;
      box-shadow: 4px 4px 8px rgba(0,0,0,0.04), -4px -4px 8px rgba(255,255,255,0.6);
      color: #dc2626;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      margin-bottom: 8px;
    }

    .lock-btn:hover {
      box-shadow: 2px 2px 4px rgba(0,0,0,0.04), -2px -2px 4px rgba(255,255,255,0.6);
    }

    .support-link {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      border-radius: 8px;
      color: #94a3b8;
      text-decoration: none;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 13px;
      transition: all 0.2s;
    }

    .support-link:hover {
      color: #64748b;
    }

    /* Breadcrumb styles */
    .breadcrumb {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 24px;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 13px;
      color: #64748b;
    }

    .breadcrumb-back {
      color: #6366f1;
      text-decoration: none;
      font-weight: 500;
      transition: color 0.2s;
    }

    .breadcrumb-back:hover {
      color: #4f46e5;
    }

    .breadcrumb-separator {
      color: #cbd5e1;
    }

    .breadcrumb-item {
      color: #64748b;
    }

    .breadcrumb-item.active {
      color: #1e293b;
      font-weight: 500;
    }
  `;
  document.head.appendChild(style);

  // Adjust main content
  const mainContent = document.querySelector('main') || document.querySelector('.main-content') || document.body;
  if (mainContent && mainContent !== document.body) {
    mainContent.style.marginLeft = '256px';
    mainContent.style.paddingTop = '64px';
  }
}
