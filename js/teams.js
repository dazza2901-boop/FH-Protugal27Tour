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
    { name: 'Team Eagle',  color: '#cc0000' },
    { name: 'Team Birdie', color: '#0055cc' },
    { name: 'Team Par',    color: '#007a33' }
  ];

  // Map team name keywords → canonical color.
  // Any team whose name contains one of these keywords (case-insensitive)
  // will have its color corrected automatically on load.
  const NAME_COLOR_MAP = [
    { keyword: 'red',   color: '#cc0000' },
    { keyword: 'blue',  color: '#0055cc' },
    { keyword: 'green', color: '#007a33' },
  ];

  function canonicalColor(name) {
    const lower = (name || '').toLowerCase();
    for (const { keyword, color } of NAME_COLOR_MAP) {
      if (lower.includes(keyword)) return color;
    }
    return null;
  }

  // Default slot allocations — used when seeding or when a team has no stored slots
  const DEFAULT_SLOTS = [
    [1, 4, 9, 10],   // Team A
    [2, 6, 7, 12],   // Team B
    [3, 5, 8, 11]    // Team C
  ];

  function storedSlots(team) {
    return Array.isArray(team?.slots) ? team.slots : [];
  }

  // Dynamic slot → team mapping, derived from _teams data at runtime.
  // Returns { slotTeam: {slot: teamIndex}, teamSlots: [[slots]...] }
  function buildSlotMap() {
    const teamEntries = Object.entries(_teams);
    const slotTeam = {};
    teamEntries.forEach(([, team], tIdx) => {
      const slots = storedSlots(team);
      slots.forEach(s => { slotTeam[s] = tIdx; });
    });
    return { slotTeam };
  }

  let _teams   = {};
  let _players = {};
  let _unsub   = null;
  let _unsubP  = null;
  let _isAdmin = false;

  // ── Slot helpers ─────────────────────────────────────────
  // Legacy slot ordering is used only for displaying old data and explicit
  // auto-assignment. Saved player IDs remain unchanged when handicaps change.
  function computeSlots() {
    return Object.entries(_players)
      .sort((a, b) => (a[1].handicap ?? 99) - (b[1].handicap ?? 99))
      .map(([pid], index) => ({ pid, slot: index + 1 }));
  }

  function slotOf(pid) { return computeSlots().find(player => player.pid === pid)?.slot ?? null; }

  // ── Render ───────────────────────────────────────────────
  async function render(container, isAdmin) {
    _isAdmin = isAdmin;
    container.innerHTML = `<div class="page">
      <div class="flex-between mt-8">
        <span class="section-title">🏌️ Teams</span>
        ${isAdmin ? `<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><button class="btn-primary btn-sm" id="auto-assign-btn">⚡ Auto-Assign by Handicap</button><button class="btn-danger btn-sm" id="clear-team-slots-btn">Clear Team Numbers</button></div>` : ''}
      </div>

      ${isAdmin ? `
      <div class="card" id="slot-editor-card" style="margin-top:12px;padding:12px 16px;background:#f7f8fa;border:1px solid #e5e7eb">
        <div style="font-size:0.82rem;font-weight:700;color:#1a2332;margin-bottom:6px">📋 Team Allocation</div>
        <div style="font-size:0.78rem;color:#57606a;margin-bottom:10px">Assign players by name. Player assignments are stored directly and are not affected by handicap sorting.</div>
        <div id="slot-editor-rows"></div>
      </div>` : ''}

      <div id="slot-rank-table" class="card mt-12" style="overflow-x:auto"></div>
      <div id="teams-container" class="mt-12"></div>
    </div>`;

    if (isAdmin) {
      document.getElementById('auto-assign-btn').onclick = autoAssign;
      document.getElementById('clear-team-slots-btn').onclick = clearTeamSlots;
    }

    if (_unsub)  _unsub();
    if (_unsubP) _unsubP();
    _unsubP = DB.on('players', d => { _players = d || {}; renderAll(); scheduleSync(); });
    _unsub  = DB.on('teams',   d => { _teams   = d || {}; renderAll(); });

    // Seed or reconcile teams from the active tour settings.
    const tour = (await DB.getTours())[DB.activeTour()] || {};
    const teamCount = tour.teamBased ? Math.max(2, Number(tour.teamCount) || 3) : 0;
    const existing = await DB.get('teams');
    const teamEntries = Object.entries(existing || {});

    if (teamEntries.length > teamCount) {
      for (const [tid] of teamEntries.slice(teamCount)) await DB.remove(`teams/${tid}`);
    }

    if (teamEntries.length < teamCount) {
      const batch = {};
      for (let i = teamEntries.length; i < teamCount; i++) {
        batch[DB_pushKey()] = {
          name: `Team ${i + 1}`,
          color: DEFAULT_TEAMS[i % DEFAULT_TEAMS.length].color,
          playerIds: [],
          slots: []
        };
      }
      if (Object.keys(batch).length) await DB.update('teams', batch);
    }

    const currentTeams = await DB.get('teams');
    for (const [tid, team] of Object.entries(currentTeams || {})) {
      const updates = {};
      const correct = canonicalColor(team.name);
      if (correct && correct !== team.color) updates.color = correct;
      if (!team.slots) updates.slots = [];
      if (Object.keys(updates).length) await DB.update(`teams/${tid}`, updates);
    }
    _teams = teamCount > 0 ? (await DB.get('teams') || {}) : {};
    renderAll();
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
  // Player assignments are stored by ID and must not change when handicaps change.
  async function syncTeamSlots() {
    return;
    const teamIds = Object.keys(_teams);
    if (teamIds.length === 0) return;
    const alreadyAssigned = teamIds.some(tid => (_teams[tid]?.playerIds || []).length > 0);
    if (!alreadyAssigned) return; // never been assigned yet — don't auto-write

    const slots = computeSlots();
    const { slotTeam } = buildSlotMap();
    const assignment = Object.fromEntries(teamIds.map(tid => [tid, []]));
    slots.forEach(({ pid, slot }) => {
      const teamIdx = slotTeam[slot];
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
    renderSlotEditor();
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
    const { slotTeam } = buildSlotMap();

    if (slots.length === 0) {
      el.innerHTML = '<p class="center-msg">No players yet.</p>';
      return;
    }

    const rows = slots.map(({ pid, slot }) => {
      const p    = _players[pid];
      const teamIdx = (slotTeam[slot] ?? -1);
      const team    = teamEntries[teamIdx]?.[1];
      const color   = team?.color || '#ccc';
      const tname   = team?.name  || '—';
      return `<tr>
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
        .map(pid => ({ pid, player: _players[pid] }));

      return `
        <div class="card team-card" style="border-left:4px solid ${team.color}">
          <div class="team-header">
            <div class="team-badge" style="background:${team.color}">${members.length}</div>
            ${_isAdmin
              ? `<input class="team-name-input" data-tid="${tid}" value="${team.name}"
                   style="border:none;font-weight:700;font-size:0.95rem;background:transparent;flex:1"
                   onchange="TeamsPage.renameTeam('${tid}', this.value)" />`
              : `<span class="team-name">${team.name}</span>`}
          </div>
          <div class="team-members">
            ${members.length === 0
              ? '<span class="text-muted">No players assigned — use the player selector above</span>'
              : members.map(({ pid, player: p }) => `
                <span class="team-member-chip" style="display:inline-flex;align-items:center;gap:4px">
                  ${p.name}${p.handicap != null ? ` <span class="text-muted">(${p.handicap})</span>` : ''}
                  ${_isAdmin ? `<button class="btn-icon" style="font-size:.8rem;padding:0 2px;color:#d93025" onclick="TeamsPage.removePlayer('${tid}','${pid}')">×</button>` : ''}
                </span>`).join('')}
          </div>
        </div>`;
    }).join('');
  }

  async function clearTeamSlots() {
    if (!confirm('Clear all team numbers and player assignments?')) return;
    const cleared = {};
    Object.entries(_teams).forEach(([tid, team]) => {
      cleared[tid] = { ...team, slots: [], playerIds: [] };
    });
    await DB.set('teams', cleared);
    _teams = cleared;
    renderAll();
    App.toast('Team numbers cleared ✓');
  }

  // ── Auto-assign by handicap slots ────────────────────────
  async function autoAssign() {
    const playerCount = Object.keys(_players).length;
    if (playerCount < 1) { App.toast('No players to assign'); return; }
    const teamIds = Object.keys(_teams);
    if (teamIds.length === 0) { App.toast('Need teams to auto-assign'); return; }

    const players = computeSlots().map(({ pid }) => pid);
    const assignment = Object.fromEntries(teamIds.map(tid => [tid, []]));
    players.forEach((pid, index) => {
      assignment[teamIds[index % teamIds.length]].push(pid);
    });

    for (const [tid, ids] of Object.entries(assignment)) {
      await DB.update(`teams/${tid}`, { playerIds: ids });
    }
    App.toast('Teams auto-assigned by handicap slots ✓');
  }

  // ── Slot editor renderer ─────────────────────────────────
  function renderSlotEditor() {
    const el = document.getElementById('slot-editor-rows');
    if (!el) return;
    const teamEntries = Object.entries(_teams);
    if (teamEntries.length === 0) return;

    const assigned = new Set(teamEntries.flatMap(([, team]) => team.playerIds || []));
    const availablePlayers = Object.entries(_players).filter(([pid]) => !assigned.has(pid));

    el.innerHTML = teamEntries.map(([tid, team], tIdx) => {
      const color = team.color || '#666';
      const addSelect = availablePlayers.length > 0
        ? `<select onchange="TeamsPage.addPlayer('${tid}', this.value); this.value=''" style="padding:3px 6px;border:1px solid #d0d7de;border-radius:8px;font-size:.78rem;background:#fff;color:#1a2332"><option value="">＋ Add player</option>${availablePlayers.map(([pid, p]) => `<option value="${pid}">${p.name}</option>`).join('')}</select>`
        : '';

      const chips = (team.playerIds || []).map(pid =>
        `<span style="display:inline-flex;align-items:center;gap:3px;padding:3px 8px;border-radius:12px;
          background:${color}18;border:1px solid ${color};color:${color};font-size:0.78rem;font-weight:700;margin:2px">
          ${_players[pid]?.name || pid}
          <button onclick="TeamsPage.removePlayer('${tid}','${pid}')"
            style="background:none;border:none;cursor:pointer;color:${color};font-size:0.85rem;font-weight:700;
            padding:0 0 0 2px;line-height:1;opacity:0.7" title="Remove player">×</button>
        </span>`
      ).join('');


      return `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;padding:6px 0;
          ${tIdx < teamEntries.length - 1 ? 'border-bottom:1px solid #e5e7eb;' : ''}">
        <span style="font-size:0.78rem;font-weight:700;color:${color};min-width:90px;flex-shrink:0">${team.name}</span>
        <div style="display:flex;flex-wrap:wrap;gap:2px;align-items:center">
          ${chips || '<span style="font-size:0.75rem;color:#57606a;margin:2px 4px">No players</span>'}
          ${addSelect}
        </div>
      </div>`;
    }).join('');
  }


  async function addPlayer(tid, pid) {
    if (!pid || !_teams[tid] || !_players[pid]) return;
    for (const [otherTid, team] of Object.entries(_teams)) {
      if (otherTid !== tid && (team.playerIds || []).includes(pid)) {
        await DB.update(`teams/${otherTid}`, { playerIds: (team.playerIds || []).filter(id => id !== pid) });
      }
    }
    await DB.update(`teams/${tid}`, { playerIds: [...(_teams[tid].playerIds || []), pid] });
    App.toast('Player assigned ✓');
  }

  async function removePlayer(tid, pid) {
    if (!_teams[tid]) return;
    await DB.update(`teams/${tid}`, { playerIds: (_teams[tid].playerIds || []).filter(id => id !== pid) });
    App.toast('Player removed ✓');
  }

  async function addSlot(tid, slot) {
    const team = _teams[tid];
    if (!team) return;
    // Remove this slot from any other team first
    const teamEntries = Object.entries(_teams);
    for (const [otid, oteam] of teamEntries) {
      if (otid === tid) continue;
      const existing = oteam.slots || [];
      if (existing.includes(slot)) {
        await DB.update(`teams/${otid}`, { slots: existing.filter(s => s !== slot) });
      }
    }
    const current = team.slots || [];
    if (!current.includes(slot)) {
      await DB.update(`teams/${tid}`, { slots: [...current, slot] });
    }
    await rebakePlayerIds();
  }

  async function removeSlot(tid, slot) {
    const team = _teams[tid];
    if (!team) return;
    const current = team.slots || [];
    await DB.update(`teams/${tid}`, { slots: current.filter(s => s !== slot) });
    await rebakePlayerIds();
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
  function getSlots()   { return []; }

  function DB_pushKey() {
    return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
  }

  return { render, destroy, renameTeam, autoAssign, addPlayer, removePlayer, addSlot, removeSlot, getTeams, getPlayers, getSlots, syncSlots: scheduleSync };
})();
