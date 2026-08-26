// ============================================================
//  teams.js  —  Team allocation page (3 teams of 4)
//
//  Slot system:
//    Players are ranked 1–12 by handicap (lowest = 1).
//    Team A = slots 1, 4, 9, 10
//    Team B = slots 2, 6, 7, 12
//    Team C = slots 3, 5, 8, 11
//  Auto-Assign rewrites team membership based on current handicaps.
//  Slot numbers are shown on every member chip so admin can see
//  who is in which slot at a glance.
// ============================================================

const TeamsPage = (() => {

  const DEFAULT_TEAMS = [
    { name: 'Team Eagle',  color: '#c8a800' },
    { name: 'Team Birdie', color: '#1a5c2a' },
    { name: 'Team Par',    color: '#2e86ab' }
  ];

  // Fixed slot → team index mapping (0-based team index)
  // Slot 1 = lowest handicap, slot 12 = highest handicap
  const SLOT_TEAM = {
    1: 0,  4: 0,  9: 0, 10: 0,   // Team A
    2: 1,  6: 1,  7: 1, 12: 1,   // Team B
    3: 2,  5: 2,  8: 2, 11: 2    // Team C
  };
  const TEAM_SLOTS = [
    [1, 4, 9, 10],   // Team A
    [2, 6, 7, 12],   // Team B
    [3, 5, 8, 11]    // Team C
  ];

  let _teams   = {};
  let _players = {};
  let _unsub   = null;
  let _unsubP  = null;
  let _isAdmin = false;

  // ── Slot helpers ─────────────────────────────────────────
  // Returns array of {pid, slot} sorted by handicap asc (slot 1 = best)
  function computeSlots() {
    return Object.entries(_players)
      .sort((a, b) => (a[1].handicap ?? 99) - (b[1].handicap ?? 99))
      .map(([pid], i) => ({ pid, slot: i + 1 }));
  }

  function slotOf(pid) {
    const entry = computeSlots().find(s => s.pid === pid);
    return entry ? entry.slot : null;
  }

  // ── Render ───────────────────────────────────────────────
  async function render(container, isAdmin) {
    _isAdmin = isAdmin;
    container.innerHTML = `<div class="page">
      <div class="flex-between mt-8">
        <span class="section-title">🏌️ Teams</span>
        ${isAdmin ? `<button class="btn-primary btn-sm" id="auto-assign-btn">⚡ Auto-Assign by Handicap</button>` : ''}
      </div>

      ${isAdmin ? `
      <div class="card" style="margin-top:12px;padding:12px 16px;background:#f7f8fa;border:1px solid #e5e7eb">
        <div style="font-size:0.82rem;font-weight:700;color:#1a2332;margin-bottom:8px">📋 Slot System</div>
        <div style="font-size:0.78rem;color:#57606a;margin-bottom:8px">
          Players are ranked 1–12 by handicap (lowest = Slot 1). Slots are fixed to teams. When handicaps change, hit <strong>Auto-Assign</strong> to rebuild.
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:0.78rem">
          <span style="padding:3px 10px;border-radius:12px;background:#c8a80022;border:1px solid #c8a800;color:#8a7000;font-weight:600">Team A — Slots 1, 4, 9, 10</span>
          <span style="padding:3px 10px;border-radius:12px;background:#1a5c2a22;border:1px solid #1a5c2a;color:#1a5c2a;font-weight:600">Team B — Slots 2, 6, 7, 12</span>
          <span style="padding:3px 10px;border-radius:12px;background:#2e86ab22;border:1px solid #2e86ab;color:#1a5980;font-weight:600">Team C — Slots 3, 5, 8, 11</span>
        </div>
      </div>` : ''}

      <div id="slot-rank-table" class="card mt-12" style="overflow-x:auto"></div>
      <div id="teams-container" class="mt-12"></div>
    </div>`;

    if (isAdmin) {
      document.getElementById('auto-assign-btn').onclick = autoAssign;
    }

    if (_unsub)  _unsub();
    if (_unsubP) _unsubP();
    _unsubP = DB.on('players', d => { _players = d || {}; renderAll(); scheduleSync(); });
    _unsub  = DB.on('teams',   d => { _teams   = d || {}; renderAll(); });

    // Seed default teams if none exist
    const existing = await DB.get('teams');
    if (!existing) {
      const batch = {};
      for (const t of DEFAULT_TEAMS) {
        batch[DB_pushKey()] = { ...t, playerIds: [] };
      }
      await DB.set('teams', batch);
    }
  }

  // ── Debounced sync trigger ────────────────────────────────
  // Defers sync so both _players and _teams are populated before running.
  let _syncTimer = null;
  function scheduleSync() {
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(syncTeamSlots, 200);
  }

  // ── Auto-sync teams whenever players change ───────────────
  // Uses _teams directly (populated by the teams listener).
  // If teams have already been assigned (at least one has playerIds),
  // silently recompute all playerIds from current handicap ranking.
  async function syncTeamSlots() {
    const teamIds = Object.keys(_teams);
    if (teamIds.length < 3) return;
    const alreadyAssigned = teamIds.some(tid => (_teams[tid]?.playerIds || []).length > 0);
    if (!alreadyAssigned) return; // never been assigned yet — don't auto-write

    const slots = computeSlots();
    const assignment = { [teamIds[0]]: [], [teamIds[1]]: [], [teamIds[2]]: [] };
    slots.forEach(({ pid, slot }) => {
      const teamIdx = SLOT_TEAM[slot];
      if (teamIdx !== undefined) assignment[teamIds[teamIdx]].push(pid);
    });

    for (const [tid, ids] of Object.entries(assignment)) {
      // Only write if the membership actually changed
      const current = JSON.stringify([...((_teams[tid]?.playerIds) || [])].sort());
      const next    = JSON.stringify([...ids].sort());
      if (current !== next) {
        await DB.update(`teams/${tid}`, { playerIds: ids });
      }
    }
  }

  function renderAll() {
    renderSlotTable();
    renderTeams();
    injectTeamNames();
  }

  function injectTeamNames() {
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

  // ── Slot ranking table ───────────────────────────────────
  function renderSlotTable() {
    const el = document.getElementById('slot-rank-table');
    if (!el) return;

    const slots = computeSlots();
    const teamEntries = Object.entries(_teams);

    if (slots.length === 0) {
      el.innerHTML = '<p class="center-msg">No players yet.</p>';
      return;
    }

    const rows = slots.map(({ pid, slot }) => {
      const p    = _players[pid];
      const teamIdx = (SLOT_TEAM[slot] ?? -1);
      const team    = teamEntries[teamIdx]?.[1];
      const color   = team?.color || '#ccc';
      const tname   = team?.name  || '—';
      return `<tr>
        <td style="padding:7px 10px;font-weight:700;color:#1a2332;font-size:0.95rem">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;
            border-radius:50%;background:#1c1c1e;color:#fff;font-size:0.75rem;font-weight:700;margin-right:6px">${slot}</span>
        </td>
        <td style="padding:7px 10px;font-weight:600">${p.name}</td>
        <td style="padding:7px 10px;text-align:center;color:#57606a">${p.handicap ?? '—'}</td>
        <td style="padding:7px 10px">
          <span style="display:inline-flex;align-items:center;gap:5px">
            <span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0"></span>
            <span style="font-size:0.82rem;font-weight:600;color:#1a2332">${tname}</span>
          </span>
        </td>
      </tr>`;
    }).join('');

    el.innerHTML = `
      <div style="font-weight:700;font-size:0.9rem;color:#1a2332;margin-bottom:10px">🏅 Handicap Rankings &amp; Slots</div>
      <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
        <thead>
          <tr style="background:#f7f8fa;font-size:0.75rem;color:#57606a">
            <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #e5e7eb">Slot</th>
            <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #e5e7eb">Player</th>
            <th style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">HCP</th>
            <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #e5e7eb">Team</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // ── Teams display ────────────────────────────────────────
  function renderTeams() {
    const container = document.getElementById('teams-container');
    if (!container) return;
    const teamEntries = Object.entries(_teams);
    if (teamEntries.length === 0) {
      container.innerHTML = '<p class="center-msg">No teams set up yet.</p>';
      return;
    }

    container.innerHTML = teamEntries.map(([tid, team], tIdx) => {
      const members = (team.playerIds || [])
        .filter(pid => _players[pid])
        .sort((a, b) => (_players[a]?.handicap ?? 99) - (_players[b]?.handicap ?? 99))
        .map(pid => ({ pid, player: _players[pid], slot: slotOf(pid) }));

      return `
        <div class="card team-card" style="border-left:4px solid ${team.color}">
          <div class="team-header">
            <div class="team-badge" style="background:${team.color}">${members.length}/4</div>
            ${_isAdmin
              ? `<input class="team-name-input" data-tid="${tid}" value="${team.name}"
                   style="border:none;font-weight:700;font-size:0.95rem;background:transparent;flex:1"
                   onchange="TeamsPage.renameTeam('${tid}', this.value)" />`
              : `<span class="team-name">${team.name}</span>`}
            <span class="tag" style="background:${team.color}20;color:${team.color}">
              Slots ${TEAM_SLOTS[tIdx]?.join(', ') || '—'}
            </span>
          </div>
          <div class="team-members">
            ${members.length === 0
              ? '<span class="text-muted">No players assigned — hit Auto-Assign</span>'
              : members.map(({ pid, player: p, slot }) => `
                <span class="team-member-chip" style="display:inline-flex;align-items:center;gap:4px">
                  <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;
                    border-radius:50%;background:#1c1c1e;color:#fff;font-size:0.65rem;font-weight:700;flex-shrink:0">${slot ?? '?'}</span>
                  ${p.name}${p.handicap != null ? ` <span class="text-muted">(${p.handicap})</span>` : ''}
                </span>`).join('')}
          </div>
        </div>`;
    }).join('');
  }

  // ── Auto-assign by handicap slots ────────────────────────
  async function autoAssign() {
    const playerCount = Object.keys(_players).length;
    if (playerCount < 1) { App.toast('No players to assign'); return; }
    if (playerCount > 12) { App.toast('More than 12 players — please remove extras first'); return; }

    const teamIds = Object.keys(_teams);
    if (teamIds.length < 3) { App.toast('Need 3 teams to auto-assign'); return; }

    const slots = computeSlots(); // [{pid, slot}] sorted by handicap

    // Build new playerIds per team using fixed slot→team mapping
    const assignment = { [teamIds[0]]: [], [teamIds[1]]: [], [teamIds[2]]: [] };
    slots.forEach(({ pid, slot }) => {
      const teamIdx = SLOT_TEAM[slot];
      if (teamIdx !== undefined) {
        assignment[teamIds[teamIdx]].push(pid);
      }
    });

    for (const [tid, ids] of Object.entries(assignment)) {
      await DB.update(`teams/${tid}`, { playerIds: ids });
    }
    App.toast('Teams auto-assigned by handicap slots ✓');
  }

  // ── Other actions ────────────────────────────────────────
  async function renameTeam(tid, name) {
    await DB.update(`teams/${tid}`, { name });
  }

  function destroy() {
    if (_unsub)  { _unsub();  _unsub  = null; }
    if (_unsubP) { _unsubP(); _unsubP = null; }
  }

  function getTeams()   { return _teams; }
  function getPlayers() { return _players; }
  function getSlots()   { return computeSlots(); }

  function DB_pushKey() {
    return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
  }

  return { render, destroy, renameTeam, autoAssign, getTeams, getPlayers, getSlots, syncSlots: scheduleSync };
})();
