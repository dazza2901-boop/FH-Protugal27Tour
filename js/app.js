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
    // Load config for tournament name
    DB.on('config', cfg => {
      _config = cfg || {};
      if (cfg?.tournamentName) {
        document.getElementById('header-title').textContent = `⛳ ${cfg.tournamentName}`;
      }
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

    // Navigate to default page
    navigate('scoreboard');

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
      case 'scoreboard':
        ScoreboardPage.render(main, _isAdmin);
        break;
      case 'scorecard':
        ScorecardPage.render(main);
        break;
      case 'schedule':
        SchedulePage.render(main, _isAdmin);
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
  }

  function destroyCurrentPage() {
    const destroyers = {
      scoreboard: ScoreboardPage,
      scorecard:  ScorecardPage,
      schedule:   SchedulePage,
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

  // ── Toast ────────────────────────────────────────────────
  let _toastTimer = null;
  function toast(msg, duration = 2500) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.add('hidden'), duration);
  }

  // ── Expose ───────────────────────────────────────────────
  return { init, navigate, toast, isAdmin: () => _isAdmin };
})();

// ── Boot ──────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => App.init());
