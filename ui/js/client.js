(function() {
  // Wait for dependencies
  if (!window.supabase || !window.ethers) {
    console.error('AgentGuardian: supabase or ethers not loaded. Check script order.');
    return;
  }

  const { createClient } = window.supabase;
  const ethers = window.ethers;

  // Supabase client
  const supabaseClient = createClient(
    window.ENV_SUPABASE_URL,
    window.ENV_SUPABASE_ANON_KEY
  );

  // ethers provider (read-only)
  const provider = new ethers.JsonRpcProvider(window.ENV_ARC_RPC_URL);

  function getContract(address, abi) {
    return new ethers.Contract(address, abi, provider);
  }

  async function getSigner() {
    if (!window.ethereum) throw new Error('No wallet detected. Install MetaMask.');
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    const browserProvider = new ethers.BrowserProvider(window.ethereum);
    return browserProvider.getSigner();
  }

  async function safeContractRead(fn, fallback) {
    if (window.ENV_MOCK_CONTRACTS) {
      console.log('Mock mode: returning fallback value');
      return fallback;
    }
    try {
      return await fn();
    } catch (e) {
      console.warn('Contract read failed:', e);
      return fallback;
    }
  }

  function timeAgo(isoString) {
    if (!isoString) return '—';
    const diff = Date.now() - new Date(isoString).getTime();
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  function truncate(addr, chars = 6) {
    if (!addr) return '—';
    return `${addr.slice(0, chars)}...${addr.slice(-4)}`;
  }

  function fmtUSD(val) {
    const n = Number(val);
    if (isNaN(n)) return '$—';
    if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${n.toFixed(2)}`;
  }

  function toast(message, type = 'success') {
    const colors = {
      success: '#10b981',
      error: '#dc2626',
      info: '#6366f1',
      warn: '#f59e0b'
    };
    const el = document.createElement('div');
    el.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      background: #e8eaf0; padding: 14px 20px; border-radius: 12px;
      box-shadow: 6px 6px 12px rgba(0,0,0,0.08), -6px -6px 12px rgba(255,255,255,0.6);
      border-left: 4px solid ${colors[type] || colors.info};
      font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14px;
      color: #2e3040; max-width: 320px; opacity: 1;
      transition: opacity 0.4s ease;
    `;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, 3600);
    setTimeout(() => { el.remove(); }, 4000);
  }

  async function loadTopBar() {
    try {
      const { data: alert } = await supabaseClient
        .from('sentinel_alerts')
        .select('defcon_level')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (alert) {
        const badge = document.getElementById('defcon-badge');
        if (badge) badge.textContent = `DEFCON-${alert.defcon_level}`;
      }
    } catch(e) { /* silent fail */ }

    try {
      const { count } = await supabaseClient
        .from('cross_chain_freezes')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'PROPAGATED');
      const el = document.getElementById('threats-blocked');
      if (el && count !== null) el.textContent = count.toLocaleString();
    } catch(e) { /* silent fail */ }
  }

  function setActiveNav() {
    const path = window.location.pathname;
    const navLinks = document.querySelectorAll('.nav-link');
    
    navLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href && path.includes(href)) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }

  // Expose globally
  window.AG = {
    supabase: supabaseClient,
    provider,
    getContract,
    getSigner,
    safeContractRead,
    timeAgo,
    truncate,
    fmtUSD,
    toast,
    loadTopBar,
    setActiveNav
  };

  // Also expose toast directly for nav.js usage
  window.toast = toast;

  // Expose helpers directly on window for backward compatibility
  window.fmtUSD = fmtUSD;
  window.timeAgo = timeAgo;
  window.truncate = truncate;
  window.safeContractRead = safeContractRead;

  // Dispatch ready event for other scripts
  window.dispatchEvent(new Event('ag:ready'));
})();
