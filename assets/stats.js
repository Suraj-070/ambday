/* =========================================================
   Stats — kiss counter + visitor tracking via JSONBin
   ========================================================= */
(function () {
  'use strict';

  const MASTER_KEY = '$2a$10$yg.uDbnr8TKlXDrvSMEDjuy9ZnZhkgYCT.2YkIw4z/RSkkrbbYKte';
  const BIN_KEY    = 'ambday_stats_bin_id';
  const API        = 'https://api.jsonbin.io/v3/b';
  const ADMIN_KEY  = 'ambday2025';
  const isAdmin    = new URLSearchParams(location.search).get('admin') === ADMIN_KEY;

  let binId = localStorage.getItem(BIN_KEY) || null;
  let stats = { kisses: 0, visits: 0, firstVisit: null, lastVisit: null };

  /* ---- JSONBin ---- */
  async function fetchStats() {
    if (!binId) return null;
    try {
      const r = await fetch(`${API}/${binId}/latest`, {
        headers: { 'X-Master-Key': MASTER_KEY }
      });
      const j = await r.json();
      return j.record || null;
    } catch(e) { return null; }
  }

  async function saveStats() {
    try {
      if (!binId) {
        const r = await fetch(API, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Master-Key': MASTER_KEY,
            'X-Bin-Name': 'ambday-stats',
            'X-Bin-Private': 'true'
          },
          body: JSON.stringify(stats)
        });
        const j = await r.json();
        binId = j.metadata.id;
        localStorage.setItem(BIN_KEY, binId);
      } else {
        await fetch(`${API}/${binId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Master-Key': MASTER_KEY
          },
          body: JSON.stringify(stats)
        });
      }
    } catch(e) { console.warn('Stats save failed', e); }
  }

  /* ---- Kiss counter ---- */
  async function incrementKisses() {
    stats.kisses = (stats.kisses || 0) + 1;
    updateKissDisplay();
    await saveStats();
  }

  function updateKissDisplay() {
    const el = document.getElementById('kissCountDisplay');
    if (el) el.textContent = stats.kisses;
  }

  /* ---- Visitor tracking ---- */
  async function trackVisit() {
    const now = new Date().toISOString();
    const visited = sessionStorage.getItem('ambday_visited');
    if (!visited) {
      sessionStorage.setItem('ambday_visited', '1');
      stats.visits = (stats.visits || 0) + 1;
      if (!stats.firstVisit) stats.firstVisit = now;
      stats.lastVisit = now;
      await saveStats();
    }
  }

  /* ---- Admin dashboard ---- */
  function showAdminDashboard() {
    if (!isAdmin) return;
    const panel = document.createElement('div');
    panel.id = 'adminPanel';
    panel.style.cssText = `
      position: fixed; bottom: 16px; left: 16px; z-index: 99999;
      background: rgba(10,8,20,0.95); border: 1px solid rgba(255,255,255,0.15);
      border-radius: 16px; padding: 16px 20px; min-width: 200px;
      font-family: -apple-system, sans-serif; color: #fff;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      backdrop-filter: blur(12px);
    `;
    panel.innerHTML = `
      <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;
                  color:rgba(255,255,255,0.5);margin-bottom:12px;">Admin Stats</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:13px;color:rgba(255,255,255,0.7);">💋 Kisses sent</span>
          <span id="adminKisses" style="font-size:18px;font-weight:700;color:#e8837a;">—</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:13px;color:rgba(255,255,255,0.7);">👀 Total visits</span>
          <span id="adminVisits" style="font-size:18px;font-weight:700;color:#7ab8e8;">—</span>
        </div>
        <div style="margin-top:4px;font-size:11px;color:rgba(255,255,255,0.4);line-height:1.5;" id="adminDates"></div>
      </div>
      <button id="adminClose" style="position:absolute;top:8px;right:10px;
              background:none;border:none;color:rgba(255,255,255,0.4);
              font-size:16px;cursor:pointer;">✕</button>
    `;
    document.body.appendChild(panel);

    document.getElementById('adminClose').addEventListener('click', () => panel.remove());

    function updatePanel() {
      const k = document.getElementById('adminKisses');
      const v = document.getElementById('adminVisits');
      const d = document.getElementById('adminDates');
      if (k) k.textContent = stats.kisses || 0;
      if (v) v.textContent = stats.visits || 0;
      if (d) {
        const first = stats.firstVisit ? new Date(stats.firstVisit).toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
        const last  = stats.lastVisit  ? new Date(stats.lastVisit).toLocaleDateString('en-AU',  { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
        d.innerHTML = `First visit: ${first}<br>Last visit: ${last}`;
      }
    }
    updatePanel();
  }

  /* ---- Wire kiss button ---- */
  function wireKissButton() {
    const btn = document.getElementById('kissBtn');
    if (!btn) return;

    // Inject kiss count display near the button
    const label = document.createElement('div');
    label.style.cssText = `
      text-align:center; font-family:-apple-system,sans-serif;
      font-size:12px; color:rgba(255,255,255,0.6); margin-top:6px;
    `;
    label.innerHTML = `<span id="kissCountDisplay">${stats.kisses}</span> kisses sent 💋`;
    btn.parentElement.appendChild(label);

    btn.addEventListener('click', () => {
      incrementKisses();
    }, { capture: true });
  }

  /* ---- Init ---- */
  async function init() {
    const saved = await fetchStats();
    if (saved) stats = { ...stats, ...saved };

    await trackVisit();
    updateKissDisplay();
    wireKissButton();

    if (isAdmin) showAdminDashboard();
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.AmbishStats = { incrementKisses, stats };
})();
