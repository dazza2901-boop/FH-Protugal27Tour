// ============================================================
//  teams.js  —  Team allocation page (3 teams of 4)
// ============================================================

const TeamsPage = (() => {

  const DEFAULT_TEAMS = [
    { name: 'Team Eagle',  color: '#c8a800' },
    { name: 'Team Birdie', color: '#1a5c2a' },
    { name: 'Team Par',    color: '#2e86ab' }
  ];

  let _teams   = {};
  let _players = {};
  let _unsub   = null;
  let _unsubP  = null;
  let _isAdmin = false;

  // ── Render ──────────────────────────────────────────────
  async function render(container, isAdmin) {
    _isAdmin = isAdmin;
    container.innerHTML = `<div class="page">
      <div class="flex-between mt-8">
        <span class="section-title">🏌️ Teams</span>
        ${isAdmin ? `<button class="btn-primary btn-sm" id="auto-assign-btn">Auto-Assign</button>` : ''}
      </div>
      <div id="teams-container" class="mt-12"></div>
      ${isAdmin ? `<div id="unassigned-card" class="card">
        <div class="card-header"><span class="card-title">Unassigned Players</span></div>
        <div id="unassigned-list"></div>
      </div>` : ''}
    </div>`;

    if (isAdmin) {
      document.getElementById('auto-assign-btn').onclick = autoAssign;
    }

    // Subscribe to both players and teams
    if (_unsub)  _unsub();
    if (_unsubP) _unsubP();

    _unsubP = DB.on('players', d => { _players = d || {}; renderAll(); });
    _unsub  = DB.on('teams',   d => { _teams   = d || {}; renderAll(); });

    // Seed default teams if none exist
    const existing = await DB.get('teams');
    if (!existing) {
      const batch = {};
      for (const t of DEFAULT_TEAMS) {
        const key = DB_pushKey();
        batch[key] = { ...t, playerIds: [] };
      }
      await DB.set('teams', batch);
    }
  }

  function renderAll() {
    renderTeams();
    if (_isAdmin) renderUnassigned();
    // Inject teamName into players for display elsewhere
    injectTeamNames();
  }

  function injectTeamNames() {
    // Attach teamName + teamColor to player data in memory (not persisted separately)
    Object.entries(_teams).forEach(([tid, team]) => {
      (team.playerIds || []).forEach(pid => {
        if (_players[pid]) {
          _players[pid]._teamId    = tid;
          _players[pid]._teamName  = team.name;
          _players[pid]._teamColor = team.color;
        }
      });
    });
  }

  function renderTeams() {
    const container = document.getElementById('teams-container');
    if (!container) return;
    const teamEntries = Object.entries(_teams);
    if (teamEntries.length === 0) {
      container.innerHTML = '<p class="center-msg">No teams set up yet.</p>';
      return;
    }
    container.innerHTML = teamEntries.map(([tid, team]) => {
      const members = (team.playerIds || [])
        .filter(pid => _players[pid])
        .sort((a, b) => (_players[a]?.handicap ?? 99) - (_players[b]?.handicap ?? 99))
        .map(pid => _players[pid]);
      return `
        <div class="card team-card" style="border-left: 4px solid ${team.color}">
          <div class="team-header">
            <div class="team-badge" style="background:${team.color}">${members.length}/4</div>
            ${_isAdmin
              ? `<input class="team-name-input" data-tid="${tid}" value="${team.name}"
                   style="border:none;font-weight:700;font-size:0.95rem;background:transparent;flex:1"
                   onchange="TeamsPage.renameTeam('${tid}', this.value)" />`
              : `<span class="team-name">${team.name}</span>`}
            <span class="tag" style="background:${team.color}20;color:${team.color}">
              ${members.length} player${members.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div class="team-members">
            ${members.length === 0
              ? '<span class="text-muted">No players assigned</span>'
              : members.map(p => `
                <span class="team-member-chip">
                  ${p.name}${p.handicap != null ? ` <span class="text-muted">(${p.handicap})</span>` : ''}
                  ${_isAdmin ? `<button style="background:none;border:none;cursor:pointer;color:#d93025;margin-left:4px"
                    onclick="TeamsPage.removeFromTeam('${tid}','${Object.keys(_players).find(k => _players[k] === p)}')">✕</button>` : ''}
                </span>`).join('')}
          </div>
        </div>`;
    }).join('');
  }

  function renderUnassigned() {
    const list = document.getElementById('unassigned-list');
    if (!list) return;
    const assignedIds = new Set(
      Object.values(_teams).flatMap(t => t.playerIds || [])
    );
    const unassigned = Object.entries(_players).filter(([id]) => !assignedIds.has(id));

    if (unassigned.length === 0) {
      list.innerHTML = '<p class="text-muted" style="padding:8px 0">All players assigned ✓</p>';
      return;
    }

    const teamOptions = Object.entries(_teams)
      .map(([tid, t]) => `<option value="${tid}">${t.name}</option>`).join('');

    list.innerHTML = unassigned.map(([pid, p]) => `
      <div class="player-item">
        <div class="player-avatar" style="background:${PlayersPage.COLORS[Object.keys(_players).indexOf(pid) % PlayersPage.COLORS.length]}">${PlayersPage.initials(p.name)}</div>
        <div class="player-info">
          <div class="player-name">${p.name}</div>
          <div class="player-meta">HCP: ${p.handicap ?? '—'}</div>
        </div>
        <select id="assign-${pid}" style="padding:6px;border-radius:6px;border:1.5px solid #d0d7de;font-size:0.82rem">
          <option value="">Assign to…</option>
          ${teamOptions}
        </select>
        <button class="btn-primary btn-sm" onclick="TeamsPage.assignPlayer('${pid}')">Add</button>
      </div>`).join('');
  }

  // ── Actions ──────────────────────────────────────────────
  async function assignPlayer(pid) {
    const sel = document.getElementById(`assign-${pid}`);
    const tid = sel?.value;
    if (!tid) { App.toast('Select a team first'); return; }

    const team = _teams[tid];
    const ids  = [...(team.playerIds || [])];
    if (ids.includes(pid)) { App.toast('Already in that team'); return; }
    if (ids.length >= 4)   { App.toast('Team already has 4 players'); return; }
    ids.push(pid);
    await DB.update(`teams/${tid}`, { playerIds: ids });
    App.toast(`Added to ${team.name}`);
  }

  async function removeFromTeam(tid, pid) {
    const team = _teams[tid];
    const ids  = (team.playerIds || []).filter(id => id !== pid);
    await DB.update(`teams/${tid}`, { playerIds: ids });
    App.toast('Player removed from team');
  }

  async function renameTeam(tid, name) {
    await DB.update(`teams/${tid}`, { name });
  }

  async function autoAssign() {
    const playerIds = Object.keys(_players);
    if (playerIds.length < 1) { App.toast('No players to assign'); return; }
    // Sort by handicap ascending, then distribute round-robin across teams
    const sorted = [...playerIds].sort((a, b) =>
      (_players[a].handicap || 0) - (_players[b].handicap || 0)
    );
    const teamIds = Object.keys(_teams);
    const assignment = { [teamIds[0]]: [], [teamIds[1]]: [], [teamIds[2]]: [] };
    sorted.forEach((pid, i) => {
      const tid = teamIds[i % teamIds.length];
      assignment[tid].push(pid);
    });
    for (const [tid, ids] of Object.entries(assignment)) {
      await DB.update(`teams/${tid}`, { playerIds: ids });
    }
    App.toast('Players auto-assigned by handicap');
  }

  function destroy() {
    if (_unsub)  { _unsub();  _unsub  = null; }
    if (_unsubP) { _unsubP(); _unsubP = null; }
  }

  function getTeams()   { return _teams; }
  function getPlayers() { return _players; }

  // ── Helper: generate a Firebase-style push key client-side ─
  function DB_pushKey() {
    return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
  }

  return { render, destroy, assignPlayer, removeFromTeam, renameTeam, autoAssign, getTeams, getPlayers };
})();
