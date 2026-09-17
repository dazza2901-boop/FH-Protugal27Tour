// ============================================================
//  app.js  —  Router, admin auth, toast, global wiring
// ============================================================

const App = (() => {

  let _currentPage = 'scoreboard';
  let _isAdmin = false;
  let _adminUnsub = null;
  let _config = {};
  const ADMIN_PIN_KEY = 'golf_admin_unlocked';

  // ── Init ─────────────────────────────────────────────────
  async function init() {
    // Correct team colors by name on every startup (name is source of truth)
    _fixTeamColors();

    // Load config without replacing the application header.
    DB.on('config', cfg => {
      _config = cfg || {};
    });

    // Restore admin state from session
    if (sessionStorage.getItem(ADMIN_PIN_KEY) === 'true') {
      _isAdmin = true;
      showAdminNav();
    }

    // Nav bindings
    document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
      btn.onclick = () => navigate(btn.dataset.page);
    });

    // Admin button
    document.getElementById('admin-btn').onclick = () => {
      if (_isAdmin) {
        // Toggle off
        _isAdmin = false;
        sessionStorage.removeItem(ADMIN_PIN_KEY);
        hideAdminNav();
        toast('Admin mode off');
        navigate(_currentPage);
      } else {
        openAdminModal();
      }
    };

    // Admin modal bindings
    document.getElementById('admin-pin-cancel').onclick = closeAdminModal;
    document.getElementById('admin-pin-confirm').onclick = confirmPin;
    document.getElementById('admin-pin-input').onkeydown = e => {
      if (e.key === 'Enter') confirmPin();
    };

    // Open with the tour selector so users choose the tour to view.
    navigate('tours');
    setTimeout(applyTourSettings, 0);

    // Hide loading
    document.getElementById('loading')?.remove();
  }

  // ── Navigation ───────────────────────────────────────────
  function navigate(page) {
    // Destroy current page module
    destroyCurrentPage();

    _currentPage = page;

    // Update nav
    document.querySelectorAll('.nav-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.page === page)
    );

    const main = document.getElementById('app-main');
    main.innerHTML = '';

    // Mount new page
    switch (page) {
      case 'tours':
        ToursPage.render(main);
        break;
      case 'touradmin':
        ToursPage.renderAdmin(main);
        break;
      case 'scoreboard':
        ScoreboardPage.render(main, _isAdmin);
        break;
      case 'scorecard':
        ScorecardPage.render(main);
        break;
      case 'schedule':
        SchedulePage.render(main, _isAdmin);
        break;
      case 'mytour':
        MyTourPage.render(main);
        break;
      case 'players':
        PlayersPage.render(main, _isAdmin);
        break;
      case 'teams':
        TeamsPage.render(main, _isAdmin);
        break;
      default:
        main.innerHTML = '<p class="center-msg">Page not found.</p>';
    }
    setTimeout(applyTourSettings, 0);
  }

  function destroyCurrentPage() {
    const destroyers = {
      tours:      ToursPage,
      touradmin:  ToursPage,
      scoreboard: ScoreboardPage,
      scorecard:  ScorecardPage,
      schedule:   SchedulePage,
      mytour:     MyTourPage,
      players:    PlayersPage,
      teams:      TeamsPage
    };
    destroyers[_currentPage]?.destroy?.();
  }

  // ── Admin PIN ────────────────────────────────────────────
  function openAdminModal() {
    document.getElementById('admin-pin-input').value = '';
    document.getElementById('admin-pin-error').classList.add('hidden');
    document.getElementById('admin-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('admin-pin-input').focus(), 100);
  }

  function closeAdminModal() {
    document.getElementById('admin-modal').classList.add('hidden');
  }

  async function confirmPin() {
    const entered = document.getElementById('admin-pin-input').value;
    // Load PIN from Firebase config (fallback to '1234')
    const storedPin = _config?.adminPin || '1234';
    if (entered === storedPin) {
      _isAdmin = true;
      sessionStorage.setItem(ADMIN_PIN_KEY, 'true');
      closeAdminModal();
      showAdminNav();
      toast('Admin mode unlocked ✓');
      navigate(_currentPage);
      applyTourSettings();
    } else {
      document.getElementById('admin-pin-error').classList.remove('hidden');
      document.getElementById('admin-pin-input').select();
    }
  }

  function showAdminNav() {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    document.getElementById('admin-btn').title = 'Lock Admin (tap to log out)';
    document.getElementById('admin-btn').textContent = '🔓';
  }

  function hideAdminNav() {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
    document.getElementById('admin-btn').title = 'Admin';
    document.getElementById('admin-btn').textContent = '⚙️';
  }

  // ── Fix team colors by name ──────────────────────────────
  // Runs on every startup. Team name is the source of truth.
  // Keywords match case-insensitively against the stored team name.
  async function _fixTeamColors() {
    const NAME_COLOR = [
      { keyword: 'red',   color: '#cc0000' },
      { keyword: 'blue',  color: '#0055cc' },
      { keyword: 'green', color: '#007a33' },
    ];
    try {
      const teams = await DB.get('teams');
      if (!teams) return;
      for (const [tid, team] of Object.entries(teams)) {
        const lower = (team.name || '').toLowerCase();
        for (const { keyword, color } of NAME_COLOR) {
          if (lower.includes(keyword) && team.color !== color) {
            await DB.update(`teams/${tid}`, { color });
            break;
          }
        }
      }
    } catch (e) {
      console.warn('_fixTeamColors:', e);
    }
  }

  // ── Toast ────────────────────────────────────────────────
  let _toastTimer = null;
  function toast(msg, duration = 2500) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.add('hidden'), duration);
  }

  async function applyTourSettings() {
    const tours = await DB.getTours();
    const tour = tours[DB.activeTour()] || {};
    sessionStorage.setItem('golf_rounds', String(tour.rounds || tour.days || 5));
    document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
      const visible = btn.dataset.page === 'tours' || btn.dataset.page === 'scoreboard' || btn.dataset.page === 'scorecard' || btn.dataset.page === 'schedule' || btn.dataset.page === 'mytour' || (btn.dataset.page === 'teams' && !!tour.teamBased) || (btn.dataset.page === 'touradmin' && _isAdmin) || (btn.dataset.page === 'players' && _isAdmin);
      btn.classList.toggle('hidden', !visible);
    });
    const tabs = tour.tabs || {};
    // 'tour' is team-only (shows team standings); hide it on individual tours unless explicitly enabled.
    // All other tabs are valid for both tour types — only hide them if the admin explicitly disabled them.
    const teamOnlyTabs = new Set(['tour']);
    const tabMap = { tour:'tour', dailyfocus:'dailyfocus', individual:'individual', bingo:'bingo', ntp:'ntp', matchplay:'matchplay', lostballs:'lostballs', comments:'comments' };
    Object.entries(tabMap).forEach(([key, value]) => {
      const tab = document.querySelector(`.tab-btn[data-tab="${value}"]`);
      if (!tab) return;
      const disabledByAdmin = tabs[key] === false;
      const teamOnlyHidden  = teamOnlyTabs.has(key) && !tour.teamBased;
      tab.classList.toggle('hidden', disabledByAdmin || teamOnlyHidden);
    });
    document.querySelector('.nav-btn[data-page="teams"]')?.classList.toggle('hidden', !tour.teamBased);
    if (_currentPage === 'scoreboard') {
      const firstTab = document.querySelector('.tab-btn:not(.hidden)');
      firstTab?.click();
    }
  }

  // ── Expose ───────────────────────────────────────────────
  return { init, navigate, toast, isAdmin: () => _isAdmin, applyTourSettings };
})();

// ── Boot ──────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => App.init());
