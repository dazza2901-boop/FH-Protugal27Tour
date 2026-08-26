// ============================================================
//  players.js  —  Tour Members management page
// ============================================================

const PlayersPage = (() => {

  const COLORS = ['#1a5c2a','#2e86ab','#a23b72','#f18f01','#c73e1d','#3b1f2b',
                  '#44cf6c','#0077b6','#7b2d8b','#e07b39','#264653','#e9c46a'];

  let _players = {};
  let _unsub = null;
  let _editId = null;

  // ── Render ──────────────────────────────────────────────
  function render(container, isAdmin) {
    container.innerHTML = `
      <div class="page">
        <div class="flex-between mt-8">
          <span class="section-title">👤 Tour Members</span>
          ${isAdmin ? `<button class="btn-primary btn-sm" id="add-player-btn">+ Add Player</button>` : ''}
        </div>
        <div id="players-list" class="card mt-12"></div>
        ${isAdmin ? `
        <div id="player-form-card" class="card hidden">
          <div class="card-header">
            <span class="card-title" id="player-form-title">Add Player</span>
            <button class="btn-icon" id="player-form-close">✕</button>
          </div>
          <div class="form-group">
            <label>Full Name</label>
            <input type="text" id="pf-name" placeholder="e.g. John Smith" />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Handicap Index</label>
              <input type="number" id="pf-handicap" min="0" max="54" step="0.1" placeholder="e.g. 14.5" />
            </div>
            <div class="form-group">
              <label>Nickname (optional)</label>
              <input type="text" id="pf-nickname" placeholder="e.g. Jonesy" />
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn-secondary" id="player-form-cancel">Cancel</button>
            <button class="btn-primary" id="player-form-save">Save Player</button>
          </div>
        </div>` : ''}
      </div>`;

    // Bind form buttons
    if (isAdmin) {
      document.getElementById('add-player-btn').onclick = () => openForm(null);
      document.getElementById('player-form-close').onclick = closeForm;
      document.getElementById('player-form-cancel').onclick = closeForm;
      document.getElementById('player-form-save').onclick = savePlayer;
    }

    // Start realtime listener
    if (_unsub) _unsub();
    _unsub = DB.on('players', (data) => {
      _players = data || {};
      renderList(isAdmin);
    });
  }

  function renderList(isAdmin) {
    const list = document.getElementById('players-list');
    if (!list) return;
    const entries = Object.entries(_players);
    if (entries.length === 0) {
      list.innerHTML = '<p class="center-msg">No players yet. Add your first player!</p>';
      return;
    }
    // Compute slot numbers (rank by handicap asc)
    const sorted = [...entries].sort((a, b) => (a[1].handicap ?? 99) - (b[1].handicap ?? 99));
    const slotMap = {};
    sorted.forEach(([id], i) => { slotMap[id] = i + 1; });

    list.innerHTML = entries
      .sort((a, b) => (a[1].handicap ?? 99) - (b[1].handicap ?? 99))
      .map(([id, p], idx) => `
      <div class="player-item">
        <div class="player-avatar" style="background:${COLORS[idx % COLORS.length]}">${initials(p.name)}</div>
        <div class="player-info">
          <div class="player-name">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;
              border-radius:50%;background:#1c1c1e;color:#fff;font-size:0.65rem;font-weight:700;
              margin-right:6px;vertical-align:middle;flex-shrink:0">${slotMap[id]}</span>
            ${p.name}${p.nickname ? ` <span class="text-muted">(${p.nickname})</span>` : ''}
          </div>
          <div class="player-meta">HCP: ${p.handicap ?? '—'} ${p._teamName ? `· ${p._teamName}` : ''}</div>
        </div>
        ${isAdmin ? `
        <div class="player-actions">
          <button class="btn-secondary btn-sm" onclick="PlayersPage.edit('${id}')">Edit</button>
          <button class="btn-danger btn-sm" onclick="PlayersPage.remove('${id}')">✕</button>
        </div>` : ''}
      </div>`).join('');
  }

  // ── Form helpers ─────────────────────────────────────────
  function openForm(id) {
    _editId = id;
    const card = document.getElementById('player-form-card');
    const title = document.getElementById('player-form-title');
    card.classList.remove('hidden');
    if (id && _players[id]) {
      const p = _players[id];
      title.textContent = 'Edit Player';
      document.getElementById('pf-name').value = p.name || '';
      document.getElementById('pf-handicap').value = p.handicap ?? '';
      document.getElementById('pf-nickname').value = p.nickname || '';
    } else {
      title.textContent = 'Add Player';
      document.getElementById('pf-name').value = '';
      document.getElementById('pf-handicap').value = '';
      document.getElementById('pf-nickname').value = '';
    }
    document.getElementById('pf-name').focus();
  }

  function closeForm() {
    document.getElementById('player-form-card').classList.add('hidden');
    _editId = null;
  }

  async function savePlayer() {
    const name = document.getElementById('pf-name').value.trim();
    const handicap = parseFloat(document.getElementById('pf-handicap').value) || 0;
    const nickname = document.getElementById('pf-nickname').value.trim();
    if (!name) { App.toast('Please enter a player name'); return; }

    const saveBtn = document.getElementById('player-form-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

    try {
      const data = { name, handicap, nickname };
      if (_editId) {
        await DB.update(`players/${_editId}`, data);
        App.toast('Player updated ✓');
      } else {
        await DB.push('players', data);
        App.toast('Player added ✓');
      }
    } catch (err) {
      console.error('savePlayer error:', err);
      App.toast('Error saving — check Firebase config');
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Player'; }
      closeForm();
    }
  }

  // ── Public ───────────────────────────────────────────────
  function edit(id) { openForm(id); }

  async function remove(id) {
    if (!confirm(`Remove ${_players[id]?.name}?`)) return;
    await DB.remove(`players/${id}`);
    App.toast('Player removed');
  }

  function destroy() {
    if (_unsub) { _unsub(); _unsub = null; }
  }

  function getPlayers() { return _players; }

  function initials(name = '') {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  return { render, destroy, edit, remove, getPlayers, initials, COLORS };
})();
