// ============================================================
//  scorecard.js  —  4-ball group scorecard entry
//  Layout: select day → select group → grid per group
//  Rows per player: [gross input] [stableford pts]
//  Fixed header:    [hole] [par] [SI]
//  Footer:          totals per player + group contribution row
//  Below grid:      Shot Allocation panel (per-day handicap overrides)
// ============================================================

const ScorecardPage = (() => {

  let _players   = {};
  let _dayScores = {};
  let _unsub     = null;
  let _unsubP    = null;
  let _unsubS    = null;
  let _unsubH    = null;   // listener for dayHandicaps
  let _currentDay   = 1;
  let _currentGroup = null;
  let _dayFormat    = 'singles';
  let _pars = Scoring.defaultPars();
  let _sis  = Scoring.defaultSIs();
  let _courseName = '';
  // Per-day handicap overrides: { pid: shots }
  // Stored in Firebase at dayHandicaps/dayN/pid
  let _dayHcp = {};

  let _activeView  = 'table'; // 'table' or 'single'
  let _currentHole = 1;       // 1 to 18

  // ── Effective handicap for a player on the current day ───
  // Returns the explicitly allocated shots for today, or 0 if none set.
  // Shot allocation is always entered manually — no index fallback.
  function effectiveHcp(pid) {
    const v = _dayHcp[pid];
    if (v !== undefined && v !== null && v !== '') return Number(v);
    return 0;
  }

  // ── Render shell ─────────────────────────────────────────
  function render(container) {
    container.innerHTML = `<div class="page">
      <div class="flex-between mt-8">
        <span class="section-title">📝 Score Entry</span>
      </div>

      <div class="card">
        <div class="form-row">
          <div class="form-group">
            <label>Select Day</label>
            <select id="sc-day-select">
              ${[1,2,3,4,5].map(d => `<option value="${d}">Day ${d}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Your Group</label>
            <select id="sc-group-select">
              <option value="">— Select group —</option>
            </select>
          </div>
        </div>
        <div id="sc-day-info" class="text-muted" style="font-size:0.82rem;margin-top:4px"></div>
      </div>

      <div id="scorecard-area" class="hidden">
        <div class="card" style="overflow-x:auto;padding:12px 8px">
          <div class="flex-between" style="margin-bottom:10px;padding:0 4px">
            <span class="card-title" id="sc-group-title">Group</span>
            <span class="tag format-badge" id="sc-format-tag"></span>
          </div>

          <!-- View Toggle Tab/Buttons -->
          <div id="sc-view-toggle" style="display:flex;gap:8px;margin-bottom:12px;padding:0 4px">
            <button id="sc-view-btn-18" class="btn-primary" style="flex:1;margin:0;padding:8px 12px;font-size:0.85rem;border-radius:6px" onclick="ScorecardPage.toggleView('table')">
              📋 18-Hole View
            </button>
            <button id="sc-view-btn-single" class="btn-secondary" style="flex:1;margin:0;padding:8px 12px;font-size:0.85rem;border-radius:6px" onclick="ScorecardPage.toggleView('single')">
              📱 Single Hole View
            </button>
          </div>

          <!-- 18-Hole Grid Table View -->
          <div id="sc-table-view">
            <div id="sc-table-wrap"></div>
            <button class="btn-primary" style="width:100%;margin-top:14px" id="sc-save-btn" onclick="ScorecardPage.saveAllScores()">
              💾 Save All Scores
            </button>
            <button class="btn" style="width:100%;margin-top:8px;color:#c0392b;border-color:#c0392b" id="sc-reset-btn" onclick="ScorecardPage.resetAllScores()">
              🗑️ Reset All Scores
            </button>
          </div>

          <!-- Single Hole View -->
          <div id="sc-single-view" class="hidden" style="padding:4px"></div>
        </div>

        <!-- Shot Allocation panel -->
        <div class="card" id="shot-alloc-card" style="margin-top:14px">
          <div class="card-header" style="margin-bottom:12px">
            <span class="card-title">🏌️ Shot Allocation — Day <span id="sa-day-label">1</span></span>
            <span class="text-muted" style="font-size:0.75rem">Overrides handicap index for scoring</span>
          </div>
          <p class="text-muted" style="font-size:0.82rem;margin-bottom:12px;line-height:1.5">
            Enter the <strong>number of shots</strong> each player receives today.
            Leave blank to use their handicap index as-is.
          </p>
          <div id="shot-alloc-rows"></div>
          <button class="btn-primary" style="margin-top:12px;width:100%" id="sa-save-btn">
            💾 Save Shot Allocations
          </button>
        </div>
      </div>
    </div>`;

    document.getElementById('sc-day-select').onchange   = onDayChange;
    document.getElementById('sc-group-select').onchange = onGroupChange;
    document.getElementById('sa-save-btn').onclick      = saveShotAllocations;

    if (_unsubP) _unsubP();
    _unsubP = DB.on('players', d => {
      _players = d || {};
      if (_currentGroup) buildGrid();
    });

    onDayChange();
  }

  // ── Day change ───────────────────────────────────────────
  function onDayChange() {
    const dayNum = parseInt(document.getElementById('sc-day-select')?.value || '1');
    _currentDay   = dayNum;
    _currentGroup = null;
    document.getElementById('scorecard-area')?.classList.add('hidden');

    if (_unsubS) { _unsubS(); _unsubS = null; }
    _unsubS = DB.on(`scores/day${dayNum}`, d => {
      _dayScores = d || {};
      if (_currentGroup) buildGrid();
    });

    // Subscribe to per-day handicap overrides
    if (_unsubH) { _unsubH(); _unsubH = null; }
    _unsubH = DB.on(`dayHandicaps/day${dayNum}`, d => {
      _dayHcp = d || {};
      if (_currentGroup) buildGrid();
    });

    DB.get(`schedule/day${dayNum}`).then(async day => {
      _dayFormat = day?.format || 'singles';
      const courseId = day?.courseId;
      if (courseId) {
        const course = await DB.get(`courses/${courseId}`);
        if (course?.pars?.length === 18) _pars = course.pars;
        if (course?.sis?.length  === 18) _sis  = course.sis;
        _courseName = course?.name || '';
      } else {
        _pars = Scoring.defaultPars();
        _sis  = Scoring.defaultSIs();
        _courseName = '';
      }
      const fmtLabel = { singles:'Singles Stableford', pairs:'Pairs Stableford', team:'Team Day [ Best 2 (3/4s), Best 3 (5s) ]' };
      const info = document.getElementById('sc-day-info');
      if (info) info.textContent = day
        ? `${day.label || `Day ${dayNum}`} · ${fmtLabel[day.format] || day.format} · Tee: ${day.teeTime || '—'}${_courseName ? ` · ${_courseName}` : ''}`
        : '';
      populateGroupSelect(day);
    });
  }

  // Resolve a stored group (may have .slots or legacy .playerIds) to live playerIds
  function resolveGroup(g) {
    if (!g) return { playerIds: [] };
    if (g.slots && g.slots.length > 0) {
      const sorted = Object.entries(_players)
        .sort((a, b) => (a[1].handicap ?? 99) - (b[1].handicap ?? 99));
      const playerIds = g.slots
        .map(slot => sorted[slot - 1]?.[0])
        .filter(Boolean);
      return { ...g, playerIds };
    }
    return g; // legacy: already has playerIds
  }

  function populateGroupSelect(day) {
    const sel = document.getElementById('sc-group-select');
    if (!sel) return;
    const groups = day?.groupings || [];
    if (groups.length === 0) {
      sel.innerHTML = `<option value="0">All Players</option>`;
      _currentGroup = { playerIds: Object.keys(_players) };
      buildGrid();
      return;
    }
    sel.innerHTML = `<option value="">— Select group —</option>` +
      groups.map((g, i) => {
        const resolved = resolveGroup(g);
        const label = g.slots
          ? `Group ${i + 1}: Players ${g.slots.join(', ')}`
          : `Group ${i + 1}: ${resolved.playerIds.map(pid => _players[pid]?.name || '?').join(', ')}`;
        return `<option value="${i}">${label}</option>`;
      }).join('');
    if (groups.length === 1) {
      sel.value = '0';
      _currentGroup = resolveGroup(groups[0]);
      buildGrid();
    }
  }

  function onGroupChange() {
    const idx = document.getElementById('sc-group-select').value;
    if (idx === '') {
      _currentGroup = null;
      document.getElementById('scorecard-area').classList.add('hidden');
      return;
    }
    DB.get(`schedule/day${_currentDay}`).then(day => {
      const groups = day?.groupings || [];
      const g = groups[parseInt(idx)] || { playerIds: Object.keys(_players) };
      _currentGroup = resolveGroup(g);
      buildGrid();
    });
  }

  // ── Build grid ───────────────────────────────────────────
  function buildGrid() {
    const area = document.getElementById('scorecard-area');
    if (!area) return;
    area.classList.remove('hidden');

    const playerIds = _currentGroup?.playerIds || [];
    if (playerIds.length === 0) {
      document.getElementById('sc-table-wrap').innerHTML = '<p class="text-muted">No players in this group.</p>';
      return;
    }

    const groupTitle = document.getElementById('sc-group-title');
    if (groupTitle) groupTitle.textContent = playerIds.map(pid => _players[pid]?.name || pid).join(' · ');

    const fmtLabel = { singles:'Singles', pairs:'Pairs', team:'Team Day [ Best 2 (3/4s), Best 3 (5s) ]' };
    const tag = document.getElementById('sc-format-tag');
    if (tag) {
      tag.textContent = fmtLabel[_dayFormat] || _dayFormat;
      tag.className = `tag format-badge format-${_dayFormat}`;
    }

    // Update shot allocation day label
    const saLabel = document.getElementById('sa-day-label');
    if (saLabel) saLabel.textContent = _currentDay;

    // ── Column helpers ──────────────────────────────────────
    const holeNums = Array.from({length: 18}, (_, i) => i + 1);
    const holeTh = (h) => `<th class="sc-hole-th" style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted" title="Click to score Hole ${h} one by one" onclick="ScorecardPage.toggleView('single'); ScorecardPage.changeSingleHole(0, ${h})">${h}</th>`;
    const subTh  = (t) => `<th class="sc-sub-th">${t}</th>`;

    // ── Fixed header rows ───────────────────────────────────
    let html = `<table class="sc-grid-table"><thead>`;

    // Row 1: hole numbers
    html += `<tr>
      <th class="sc-name-th sc-hdr-top">Player</th>
      ${holeNums.slice(0,9).map(h => holeTh(h)).join('')}
      ${subTh('OUT')}
      ${holeNums.slice(9,18).map(h => holeTh(h)).join('')}
      ${subTh('IN')} ${subTh('TOT')} ${subTh('SBF')} ${subTh('🔴 LST')}
    </tr>`;

    // Row 2: par
    html += `<tr class="sc-par-row">
      <td class="sc-name-th sc-hdr-label">Par</td>
      ${_pars.slice(0,9).map(p => `<td class="sc-hole-th">${p}</td>`).join('')}
      <td class="sc-sub-th">${_pars.slice(0,9).reduce((a,b)=>a+b,0)}</td>
      ${_pars.slice(9,18).map(p => `<td class="sc-hole-th">${p}</td>`).join('')}
      <td class="sc-sub-th">${_pars.slice(9,18).reduce((a,b)=>a+b,0)}</td>
      <td class="sc-sub-th">${_pars.reduce((a,b)=>a+b,0)}</td>
      <td class="sc-sub-th"></td>
      <td class="sc-sub-th"></td>
    </tr>`;

    // Row 3: stroke index
    html += `<tr class="sc-si-hdr-row">
      <td class="sc-name-th sc-hdr-label">SI</td>
      ${_sis.slice(0,9).map(s => `<td class="sc-hole-th sc-si-val">${s}</td>`).join('')}
      <td class="sc-sub-th"></td>
      ${_sis.slice(9,18).map(s => `<td class="sc-hole-th sc-si-val">${s}</td>`).join('')}
      <td class="sc-sub-th"></td>
      <td class="sc-sub-th"></td>
      <td class="sc-sub-th"></td>
      <td class="sc-sub-th"></td>
    </tr>`;

    html += `</thead><tbody>`;

    // ── Per-player rows ─────────────────────────────────────
    playerIds.forEach((pid, rowIdx) => {
      const p        = _players[pid];
      const hcp      = effectiveHcp(pid);   // use day override if set
      const existing = _dayScores[pid] || {};
      const shade    = rowIdx % 2 === 1 ? 'sc-row-alt' : '';

      // Pre-calculate stableford per hole for existing scores
      const holeStbf = holeNums.map(h => {
        const gross = existing[`h${h}`] || 0;
        if (!gross) return '';
        const shots = Scoring.shotsOnHole(hcp, _sis[h - 1]);
        return Scoring.stablefordPoints(gross, _pars[h - 1], shots);
      });

      // Show allocated shots for today (or "—" if not yet set)
      const hasAlloc   = _dayHcp[pid] !== undefined && _dayHcp[pid] !== null && _dayHcp[pid] !== '';
      const hcpDisplay = hasAlloc
        ? `<strong style="color:#1a5c2a">${hcp} shot${hcp !== 1 ? 's' : ''}</strong>`
        : `<span style="color:#c0392b;font-size:0.7rem">shots not set</span>`;

      // Output 18 hidden inputs for lost ball counts
      let hiddenLostInputs = '';
      for (let h = 1; h <= 18; h++) {
        hiddenLostInputs += `<input type="hidden" id="lost-${pid}-${h}" value="${existing[`lost_h${h}`] || 0}" />`;
      }

      // Row A: gross score inputs
      html += `<tr class="sc-gross-row ${shade}">
        <td class="sc-name-th sc-player-name-cell" rowspan="2">
          <div class="sc-player-label">${p?.name || pid}</div>
          <div class="sc-hcp-label">${hcpDisplay}</div>
          ${hiddenLostInputs}
        </td>`;

      for (let i = 0; i < 9; i++) {
        const h     = i + 1;
        const gross = existing[`h${h}`] || '';
        const cls   = gross ? Scoring.classify(gross, _pars[i]) : '';
        html += `<td class="sc-hole-td${i === 8 ? ' sc-nine-end' : ''}">
          <input class="sc-input ${cls}" type="number" min="1" max="15"
            id="si-${pid}-${h}" value="${gross}"
            data-pid="${pid}" data-hole="${h}"
            data-par="${_pars[i]}" data-si="${_sis[i]}" data-hcp="${hcp}"
            oninput="ScorecardPage.onInput(this)" />
        </td>`;
      }
      html += `<td class="sc-sub-th sc-tot-cell" id="out-${pid}">—</td>`;

      for (let i = 0; i < 9; i++) {
        const h     = i + 10;
        const gross = existing[`h${h}`] || '';
        const cls   = gross ? Scoring.classify(gross, _pars[i + 9]) : '';
        html += `<td class="sc-hole-td">
          <input class="sc-input ${cls}" type="number" min="1" max="15"
            id="si-${pid}-${h}" value="${gross}"
            data-pid="${pid}" data-hole="${h}"
            data-par="${_pars[i + 9]}" data-si="${_sis[i + 9]}" data-hcp="${hcp}"
            oninput="ScorecardPage.onInput(this)" />
        </td>`;
      }
      html += `<td class="sc-sub-th sc-tot-cell" id="in-${pid}">—</td>
               <td class="sc-sub-th sc-tot-cell" id="tot-${pid}">—</td>
               <td class="sc-sbf-th sc-tot-cell" id="sbf-${pid}">—</td>
               <td class="sc-sub-th sc-tot-cell" id="losttot-${pid}" style="background:#fdf2f2;color:#b91c1c;font-weight:700">0</td>
      </tr>`;

      // Row B: stableford points per hole (read-only)
      html += `<tr class="sc-pts-row ${shade}">`;
      for (let i = 0; i < 9; i++) {
        const pts = holeStbf[i];
        html += `<td class="sc-hole-th sc-pts-cell${i === 8 ? ' sc-nine-end' : ''}" id="pt-${pid}-${i+1}">${pts !== '' ? pts : ''}</td>`;
      }
      const outPts = holeStbf.slice(0,9).reduce((a,v) => a + (v !== '' ? v : 0), 0);
      html += `<td class="sc-sub-th sc-pts-sub" id="outpts-${pid}">${outPts || ''}</td>`;
      for (let i = 9; i < 18; i++) {
        const pts = holeStbf[i];
        html += `<td class="sc-hole-th sc-pts-cell" id="pt-${pid}-${i+1}">${pts !== '' ? pts : ''}</td>`;
      }
      const inPts  = holeStbf.slice(9,18).reduce((a,v) => a + (v !== '' ? v : 0), 0);
      const totPts = outPts + inPts;
      html += `<td class="sc-sub-th sc-pts-sub" id="inpts-${pid}">${inPts || ''}</td>
               <td class="sc-sub-th sc-pts-sub"></td>
               <td class="sc-sbf-th sc-pts-sub" id="sbftot-${pid}">${totPts || ''}</td>
               <td class="sc-sub-th sc-pts-sub" style="background:#fdf2f2 !important"></td>
      </tr>`;

      // ── Pair total row — inserted after every 2nd player on pairs days ──
      if (_dayFormat === 'pairs' && rowIdx % 2 === 1) {
        const pairIdx  = Math.floor(rowIdx / 2);
        const pidA     = playerIds[rowIdx - 1];
        const pidB     = pid;
        const pairName = `Pair ${pairIdx + 1}: ${_players[pidA]?.name || pidA} & ${_players[pidB]?.name || pidB}`;
        html += `<tr class="sc-pair-row" id="pair-row-${pairIdx}">
          <td class="sc-name-th sc-pair-label">${pairName}</td>`;
        for (let i = 0; i < 9; i++) {
          html += `<td class="sc-hole-th sc-pair-cell${i === 8 ? ' sc-nine-end' : ''}" id="pr-${pairIdx}-${i+1}"></td>`;
        }
        html += `<td class="sc-sub-th sc-pair-sub" id="pr-${pairIdx}-out"></td>`;
        for (let i = 9; i < 18; i++) {
          html += `<td class="sc-hole-th sc-pair-cell" id="pr-${pairIdx}-${i+1}"></td>`;
        }
        html += `<td class="sc-sub-th sc-pair-sub" id="pr-${pairIdx}-in"></td>
                 <td class="sc-sub-th sc-pair-sub"></td>
                 <td class="sc-sbf-th sc-pair-total" id="pr-${pairIdx}-tot"></td>
                 <td class="sc-sub-th sc-pair-sub" style="background:#1a4f80 !important"></td>
        </tr>`;
      }
    });

    // ── Group contribution row ─────────────────────────────
    const contribLabel = {
      singles: `Best 1 (Singles)`,
      pairs:   `Best 1/hole (Pairs)`,
      team:    `Best 2 (P3/4) · Best 3 (P5)`
    }[_dayFormat] || 'Group';

    html += `<tr class="sc-contrib-row">
      <td class="sc-name-th sc-contrib-label">${contribLabel}</td>`;

    for (let i = 0; i < 9; i++) {
      html += `<td class="sc-hole-th sc-contrib-cell${i === 8 ? ' sc-nine-end' : ''}" id="cb-${i+1}"></td>`;
    }
    html += `<td class="sc-sub-th sc-contrib-sub" id="cb-out"></td>`;
    for (let i = 9; i < 18; i++) {
      html += `<td class="sc-hole-th sc-contrib-cell" id="cb-${i+1}"></td>`;
    }
    html += `<td class="sc-sub-th sc-contrib-sub" id="cb-in"></td>
             <td class="sc-sub-th sc-contrib-sub"></td>
             <td class="sc-sbf-th sc-contrib-total" id="cb-tot"></td>
             <td class="sc-sub-th sc-contrib-sub" style="background:#155724 !important"></td>
    </tr>`;

    html += `</tbody></table>`;
    document.getElementById('sc-table-wrap').innerHTML = html;

    // Fill in totals for all players, pair rows, and contribution row
    playerIds.forEach(pid => recalcPlayer(pid));
    if (_dayFormat === 'pairs') recalcPairs(playerIds);
    recalcContrib(playerIds);

    // Render the shot allocation panel for players in this group
    renderShotAlloc(playerIds);

    // Ensure the correct view (18-hole or single-hole) is maintained and rendered
    toggleView(_activeView);
  }

  // ── Shot Allocation panel ────────────────────────────────
  function renderShotAlloc(playerIds) {
    const el = document.getElementById('shot-alloc-rows');
    if (!el) return;

    el.innerHTML = playerIds.map(pid => {
      const p      = _players[pid];
      const stored = _dayHcp[pid];
      const hasVal = stored !== undefined && stored !== null && stored !== '';
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f0f0f0">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:0.9rem">${esc(p?.name || pid)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          <label style="font-size:0.78rem;color:#57606a;white-space:nowrap">Shots today</label>
          <input type="text" inputmode="numeric" pattern="[0-9]*" id="sa-${pid}"
            value="${hasVal ? stored : ''}"
            placeholder="—"
            style="width:64px;padding:7px 8px;border:1.5px solid ${hasVal ? '#1a5c2a' : '#d0d7de'};border-radius:7px;font-size:1rem;text-align:center;font-weight:700;color:${hasVal ? '#1a5c2a' : '#1a2332'};-webkit-appearance:none;appearance:none"
            oninput="this.value=this.value.replace(/[^0-9]/g,'');this.style.borderColor=this.value!==''?'#1a5c2a':'#d0d7de';this.style.color=this.value!==''?'#1a5c2a':'#1a2332'"
          />
        </div>
      </div>`;
    }).join('') + (playerIds.length === 0 ? '<p class="text-muted">No players in this group.</p>' : '');
  }

  // ── Save shot allocations ────────────────────────────────
  async function saveShotAllocations() {
    const playerIds = _currentGroup?.playerIds || [];
    if (playerIds.length === 0) { App.toast('No players in this group'); return; }

    // Snapshot ALL input values BEFORE any async write.
    // Each DB.set triggers the _unsubH listener which calls buildGrid(),
    // destroying the DOM inputs — so we must read everything first.
    const values = {};
    playerIds.forEach(pid => {
      const input = document.getElementById(`sa-${pid}`);
      values[pid] = input?.value?.trim() ?? '';
    });

    const btn = document.getElementById('sa-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
      const dayKey = `dayHandicaps/day${_currentDay}`;
      await Promise.all(playerIds.map(pid => {
        const val = values[pid];
        return (val !== '')
          ? DB.set(`${dayKey}/${pid}`, Number(val))
          : DB.remove(`${dayKey}/${pid}`);
      }));
      App.toast('Shot allocations saved ✓');
    } catch (e) {
      console.error('saveShotAllocations error:', e);
      App.toast('Error saving allocations');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Save Shot Allocations'; }
    }
  }

  // ── Live input ───────────────────────────────────────────
  function onInput(input) {
    const pid   = input.dataset.pid;
    const h     = parseInt(input.dataset.hole);
    const par   = parseInt(input.dataset.par);
    const si    = parseInt(input.dataset.si);
    // Always use the current effective handicap (data-hcp is set at build time)
    const hcp   = parseInt(input.dataset.hcp) || 0;
    const gross = parseInt(input.value) || 0;
    const shots = Scoring.shotsOnHole(hcp, si);

    // Update input colour
    input.className = `sc-input ${gross ? Scoring.classify(gross, par) : ''}`;

    // Update that player's stableford point cell for this hole
    const pts    = gross ? Scoring.stablefordPoints(gross, par, shots) : '';
    const ptCell = document.getElementById(`pt-${pid}-${h}`);
    if (ptCell) ptCell.textContent = pts;

    recalcPlayer(pid);
    if (_dayFormat === 'pairs') recalcPairs(_currentGroup?.playerIds || []);
    recalcContrib(_currentGroup?.playerIds || []);
  }

  // ── Recalc player totals ─────────────────────────────────
  function recalcPlayer(pid) {
    const hcp = effectiveHcp(pid);
    let outGross = 0, inGross  = 0;
    let outPts   = 0, inPts   = 0;

    for (let h = 1; h <= 18; h++) {
      const inp   = document.getElementById(`si-${pid}-${h}`);
      const gross = parseInt(inp?.value) || 0;
      const shots = Scoring.shotsOnHole(hcp, _sis[h - 1]);
      const pts   = gross ? Scoring.stablefordPoints(gross, _pars[h - 1], shots) : 0;
      if (h <= 9) { outGross += gross; outPts += pts; }
      else        { inGross  += gross; inPts  += pts; }
    }

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };
    const setP = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || ''; };

    set(`out-${pid}`,   outGross || '—');
    set(`in-${pid}`,    inGross  || '—');
    set(`tot-${pid}`,   (outGross + inGross) || '—');

    const sbfEl = document.getElementById(`sbf-${pid}`);
    if (sbfEl) {
      sbfEl.textContent  = (outPts + inPts) || '—';
      sbfEl.style.color  = '#1a5c2a';
      sbfEl.style.fontWeight = '700';
    }

    setP(`outpts-${pid}`, outPts || '');
    setP(`inpts-${pid}`,  inPts  || '');
    const sbfTot = document.getElementById(`sbftot-${pid}`);
    if (sbfTot) {
      sbfTot.textContent = (outPts + inPts) || '';
      sbfTot.style.fontWeight = '700';
      sbfTot.style.color = '#1a5c2a';
    }

    // Recalculate total lost balls from hidden inputs
    let totalLost = 0;
    for (let h = 1; h <= 18; h++) {
      const lostInp = document.getElementById(`lost-${pid}-${h}`);
      totalLost += parseInt(lostInp?.value) || 0;
    }
    const lostTotEl = document.getElementById(`losttot-${pid}`);
    if (lostTotEl) {
      lostTotEl.textContent = totalLost;
    }
  }

  // ── Recalc pair total rows (pairs format only) ───────────
  function recalcPairs(playerIds) {
    for (let pairIdx = 0; pairIdx * 2 + 1 < playerIds.length; pairIdx++) {
      const pidA = playerIds[pairIdx * 2];
      const pidB = playerIds[pairIdx * 2 + 1];
      let outTotal = 0, inTotal = 0;

      for (let h = 1; h <= 18; h++) {
        const i    = h - 1;
        const ptsA = (() => {
          const inp   = document.getElementById(`si-${pidA}-${h}`);
          const gross = parseInt(inp?.value) || 0;
          if (!gross) return 0;
          const shots = Scoring.shotsOnHole(effectiveHcp(pidA), _sis[i]);
          return Scoring.stablefordPoints(gross, _pars[i], shots);
        })();
        const ptsB = (() => {
          const inp   = document.getElementById(`si-${pidB}-${h}`);
          const gross = parseInt(inp?.value) || 0;
          if (!gross) return 0;
          const shots = Scoring.shotsOnHole(effectiveHcp(pidB), _sis[i]);
          return Scoring.stablefordPoints(gross, _pars[i], shots);
        })();
        const best1 = Math.max(ptsA, ptsB);
        const cell  = document.getElementById(`pr-${pairIdx}-${h}`);
        if (cell) cell.textContent = best1 || '';
        if (h <= 9) outTotal += best1;
        else        inTotal  += best1;
      }

      const setP = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || ''; };
      setP(`pr-${pairIdx}-out`, outTotal);
      setP(`pr-${pairIdx}-in`,  inTotal);
      const totEl = document.getElementById(`pr-${pairIdx}-tot`);
      if (totEl) {
        totEl.textContent  = (outTotal + inTotal) || '';
        totEl.style.fontWeight = '700';
      }
    }
  }

  // ── Recalc group contribution row ───────────────────────
  function recalcContrib(playerIds) {
    if (!playerIds || playerIds.length === 0) return;

    let outTotal = 0, inTotal = 0;

    for (let h = 1; h <= 18; h++) {
      const i = h - 1;
      const pts = playerIds.map(pid => {
        const inp   = document.getElementById(`si-${pid}-${h}`);
        const gross = parseInt(inp?.value) || 0;
        if (!gross) return 0;
        const shots = Scoring.shotsOnHole(effectiveHcp(pid), _sis[i]);
        return Scoring.stablefordPoints(gross, _pars[i], shots);
      });

      let contrib = 0;
      if (_dayFormat === 'team') {
        const sorted = [...pts].sort((a, b) => b - a);
        const count  = _pars[i] === 5 ? 3 : 2;
        for (let k = 0; k < count; k++) contrib += sorted[k] || 0;
      } else {
        contrib = Math.max(...pts, 0);
      }

      const cell = document.getElementById(`cb-${h}`);
      if (cell) cell.textContent = contrib || '';
      if (h <= 9) outTotal += contrib;
      else        inTotal  += contrib;
    }

    const setC = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || ''; };
    setC('cb-out', outTotal);
    setC('cb-in',  inTotal);
    const totEl = document.getElementById('cb-tot');
    if (totEl) {
      totEl.textContent  = (outTotal + inTotal) || '';
      totEl.style.fontWeight = '700';
      totEl.style.color = '#155724';
    }
  }

  // ── Save scores ──────────────────────────────────────────
  async function saveAllScores(silent = false) {
    const playerIds = _currentGroup?.playerIds || [];
    if (playerIds.length === 0) { if (!silent) App.toast('No players in this group'); return; }

    const btn = document.getElementById('sc-save-btn');
    if (btn && !silent) { btn.disabled = true; btn.textContent = 'Saving…'; }

    // Snapshot ALL values before any async write
    const snapshots = {};
    const lostSnapshots = {};
    for (const pid of playerIds) {
      snapshots[pid] = Array.from({length: 18}, (_, i) =>
        parseInt(document.getElementById(`si-${pid}-${i + 1}`)?.value) || 0
      );
      lostSnapshots[pid] = Array.from({length: 18}, (_, i) =>
        parseInt(document.getElementById(`lost-${pid}-${i + 1}`)?.value) || 0
      );
    }

    try {
      const dayKey = `scores/day${_currentDay}`;
      let saved = 0;
      for (const pid of playerIds) {
        const scores = snapshots[pid];
        const losts  = lostSnapshots[pid];
        const hcp    = effectiveHcp(pid);   // use day override if set
        const name   = _players[pid]?.name || pid;
        const data   = { playerName: name, savedAt: Date.now() };
        scores.forEach((val, i) => { data[`h${i + 1}`] = val; });
        losts.forEach((val, i) => { data[`lost_h${i + 1}`] = val; });
        data.stableford = Scoring.totalStableford(scores, _pars, _sis, hcp);
        data.lostBalls = losts.reduce((a, b) => a + b, 0);
        await DB.set(`${dayKey}/${pid}`, data);
        saved++;
      }
      if (!silent) {
        App.toast(`Saved scores for ${saved} player${saved !== 1 ? 's' : ''} ✓`);
      }
    } catch (err) {
      console.error('saveAllScores error:', err);
      if (!silent) {
        App.toast('Error saving — check Firebase config');
      }
    } finally {
      if (btn && !silent) { btn.disabled = false; btn.textContent = '💾 Save All Scores'; }
      // Grid rebuilds automatically via the _unsubS Firebase listener
    }
  }

  async function resetAllScores() {
    const playerIds = _currentGroup?.playerIds || [];
    if (playerIds.length === 0) { App.toast('No players in this group'); return; }

    const confirmed = window.confirm(
      `Reset all scores for this group on Day ${_currentDay}?\nThis cannot be undone.`
    );
    if (!confirmed) return;

    const btn = document.getElementById('sc-reset-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Resetting…'; }

    try {
      const dayKey = `scores/day${_currentDay}`;
      await Promise.all(playerIds.map(pid => DB.remove(`${dayKey}/${pid}`)));
      App.toast('Scores reset ✓');
    } catch (err) {
      console.error('resetAllScores error:', err);
      App.toast('Error resetting — check Firebase config');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🗑️ Reset All Scores'; }
      // Grid rebuilds automatically via the _unsubS Firebase listener
    }
  }

  function esc(s) { return String(s || '').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // Stub kept for safe external calling
  function computeContrib() {}

  function destroy() {
    if (_unsub)  { _unsub();  _unsub  = null; }
    if (_unsubP) { _unsubP(); _unsubP = null; }
    if (_unsubS) { _unsubS(); _unsubS = null; }
    if (_unsubH) { _unsubH(); _unsubH = null; }
    _activeView  = 'table';
    _currentHole = 1;
  }

  // ── Single Hole View Controller & Scoring Controls ───────
  function toggleView(view) {
    _activeView = view;
    const btn18         = document.getElementById('sc-view-btn-18');
    const btnSingle     = document.getElementById('sc-view-btn-single');
    const tableView     = document.getElementById('sc-table-view');
    const singleView    = document.getElementById('sc-single-view');
    const shotAllocCard = document.getElementById('shot-alloc-card');

    if (view === 'single') {
      if (btn18) { btn18.className = 'btn-secondary'; }
      if (btnSingle) { btnSingle.className = 'btn-primary'; }
      tableView?.classList.add('hidden');
      singleView?.classList.remove('hidden');
      shotAllocCard?.classList.add('hidden');
      renderSingleHole();
    } else {
      if (btn18) { btn18.className = 'btn-primary'; }
      if (btnSingle) { btnSingle.className = 'btn-secondary'; }
      tableView?.classList.remove('hidden');
      singleView?.classList.add('hidden');
      shotAllocCard?.classList.remove('hidden');
    }
  }

  function renderSingleHole() {
    const singleArea = document.getElementById('sc-single-view');
    if (!singleArea) return;

    const playerIds = _currentGroup?.playerIds || [];
    if (playerIds.length === 0) {
      singleArea.innerHTML = '<p class="text-muted" style="text-align:center;padding:16px 0">No players in this group.</p>';
      return;
    }

    // Prepare options for the hole select dropdown
    let optionsHtml = '';
    for (let h = 1; h <= 18; h++) {
      const par = _pars[h - 1];
      const si = _sis[h - 1];
      optionsHtml += `<option value="${h}" ${h === _currentHole ? 'selected' : ''}>Hole ${h} (Par ${par}, SI ${si})</option>`;
    }

    const currentPar = _pars[_currentHole - 1];
    const currentSi = _sis[_currentHole - 1];

    let playersHtml = playerIds.map(pid => {
      const p = _players[pid];
      const hcp = effectiveHcp(pid);
      const shots = Scoring.shotsOnHole(hcp, currentSi);

      // Read current score from the main grid input
      const inputEl = document.getElementById(`si-${pid}-${_currentHole}`);
      const grossVal = inputEl ? parseInt(inputEl.value) || 0 : 0;
      const pts = grossVal ? Scoring.stablefordPoints(grossVal, currentPar, shots) : 0;

      // Color coding for score
      const scoreClass = grossVal ? Scoring.classify(grossVal, currentPar) : '';

      // Read current lost ball count from the hidden input
      const lostEl = document.getElementById(`lost-${pid}-${_currentHole}`);
      const lostVal = lostEl ? parseInt(lostEl.value) || 0 : 0;

      return `
        <div class="sc-single-player-row" style="flex-direction:column;align-items:stretch;gap:8px">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div style="flex:1;min-width:0;padding-right:8px">
              <div style="font-weight:700;font-size:1rem;color:#1c1c1e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p?.name || pid)}</div>
              <div style="font-size:0.78rem;color:#57606a;margin-top:2px">
                Hcp: ${hcp} · SI ${currentSi} · Receives: <strong style="color:${shots > 0 ? '#1a5c2a' : '#57606a'}">${shots} shot${shots !== 1 ? 's' : ''}</strong>
              </div>
            </div>
            
            <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
              <!-- Minus Button -->
              <button class="sc-single-adjust-btn" onclick="ScorecardPage.adjustSingleHoleScore('${pid}', -1)">
                −
              </button>
              
              <!-- Value Display -->
              <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:44px;height:44px;border:1.5px solid #e5e7eb;border-radius:8px;background:#fff;overflow:hidden">
                <span id="sc-single-val-${pid}" class="sc-single-score-display ${scoreClass}">
                  ${grossVal || '—'}
                </span>
              </div>
              
              <!-- Plus Button -->
              <button class="sc-single-adjust-btn" onclick="ScorecardPage.adjustSingleHoleScore('${pid}', 1)">
                +
              </button>
              
              <!-- Stableford Points Badge -->
              <div id="sc-single-pts-${pid}" style="font-size:0.8rem;font-weight:700;color:#1a5c2a;width:48px;height:44px;text-align:center;background:#edf5f0;border:1px solid #d4edda;padding:0;border-radius:8px;display:flex;align-items:center;justify-content:center;box-sizing:border-box">
                ${grossVal ? `${pts} pts` : '—'}
              </div>
            </div>
          </div>

          <!-- Lost Balls count subsection -->
          <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px dashed #e5e7eb;padding-top:8px;margin-top:2px">
            <span style="font-size:0.8rem;color:#1c1c1e;font-weight:600;display:flex;align-items:center;gap:4px">Lost Balls on Hole:</span>
            <div style="display:flex;align-items:center;gap:8px">
              <button class="sc-single-lost-btn" onclick="ScorecardPage.adjustSingleHoleLost('${pid}', -1)" style="width:30px;height:30px;border-radius:50%;border:1px solid #d0d7de;background:#f6f8fa;color:#1c1c1e;font-size:1.1rem;font-weight:700;display:flex;align-items:center;justify-content:center;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent">−</button>
              <span id="sc-single-lost-val-${pid}" style="font-size:0.95rem;font-weight:800;color:#1c1c1e;width:20px;text-align:center">${lostVal}</span>
              <button class="sc-single-lost-btn" onclick="ScorecardPage.adjustSingleHoleLost('${pid}', 1)" style="width:30px;height:30px;border-radius:50%;border:1px solid #d0d7de;background:#f6f8fa;color:#1c1c1e;font-size:1.1rem;font-weight:700;display:flex;align-items:center;justify-content:center;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent">+</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    singleArea.innerHTML = `
      <div class="sc-single-header" style="margin-top:4px;margin-bottom:12px;display:flex;flex-direction:column;gap:8px">
        <!-- Hole select controls -->
        <div style="display:flex;align-items:center;gap:6px">
          <button class="btn-secondary" style="padding:10px 14px;font-size:1.1rem;border-radius:8px;margin:0;cursor:pointer" onclick="ScorecardPage.changeSingleHole(-1)" ${_currentHole === 1 ? 'disabled style="opacity:0.4;cursor:not-allowed"' : ''}>
            ◀
          </button>
          
          <select id="sc-single-hole-select" onchange="ScorecardPage.changeSingleHole(0, this.value)" style="flex:1;padding:10px;font-size:1rem;font-weight:700;border:1.5px solid #d0d7de;border-radius:8px;background:#fff;text-align:center;font-family:inherit;color:#1c1c1e">
            ${optionsHtml}
          </select>
          
          <button class="btn-secondary" style="padding:10px 14px;font-size:1.1rem;border-radius:8px;margin:0;cursor:pointer" onclick="ScorecardPage.changeSingleHole(1)" ${_currentHole === 18 ? 'disabled style="opacity:0.4;cursor:not-allowed"' : ''}>
            ▶
          </button>
        </div>
        
        <!-- Info badges -->
        <div style="display:flex;justify-content:center;gap:12px;font-size:0.85rem;font-weight:600;color:#57606a;background:#f7f8fa;padding:8px;border-radius:6px;border:1px solid #e5e7eb">
          <span>⛳ Par: <strong>${currentPar}</strong></span>
          <span>🎯 Stroke Index: <strong>${currentSi}</strong></span>
        </div>
      </div>

      <div class="sc-single-players-list" style="border:1px solid #e5e7eb;border-radius:8px;background:#fff;padding:0 8px">
        ${playersHtml}
      </div>

      <div style="margin-top:16px;display:flex;flex-direction:column;gap:8px">
        <button class="btn-primary" style="width:100%;padding:12px;font-size:0.95rem;display:flex;align-items:center;justify-content:center;gap:6px" id="sc-single-save-btn" onclick="ScorecardPage.saveFromSingleHole()">
          💾 Save Scores
        </button>
        <button class="btn-secondary" style="width:100%;padding:10px;font-size:0.9rem" onclick="ScorecardPage.toggleView('table')">
          📋 Back to 18-Hole View
        </button>
      </div>
    `;
  }

  function changeSingleHole(delta, specVal) {
    // Treat hole change as a silent auto-save itself! No lag because it runs in the background.
    saveAllScores(true).catch(err => console.error("Auto-save failed:", err));

    if (specVal !== undefined) {
      _currentHole = parseInt(specVal);
    } else {
      _currentHole = Math.max(1, Math.min(18, _currentHole + delta));
    }
    renderSingleHole();
  }

  function adjustSingleHoleScore(pid, delta) {
    const inputEl = document.getElementById(`si-${pid}-${_currentHole}`);
    if (!inputEl) return;

    let currentVal = parseInt(inputEl.value) || 0;
    const currentPar = _pars[_currentHole - 1];

    let newVal;
    if (currentVal === 0) {
      // If no score was set, default to par when incrementing or decrementing!
      newVal = currentPar;
    } else {
      newVal = currentVal + delta;
    }

    // Clamp score between 1 and 15, or if less than 1, set to empty
    if (newVal < 1) {
      newVal = '';
    } else if (newVal > 15) {
      newVal = 15;
    }

    inputEl.value = newVal;

    // Trigger the existing onInput recalculation logic so all stats update
    onInput(inputEl);

    // Update the displays on the single hole UI in real-time
    const valDisplay = document.getElementById(`sc-single-val-${pid}`);
    if (valDisplay) {
      valDisplay.textContent = newVal || '—';
      // Apply the color classification
      const scoreClass = newVal ? Scoring.classify(newVal, currentPar) : '';
      valDisplay.className = `sc-single-score-display ${scoreClass}`;
    }

    // Update stableford points on single hole UI
    const ptsDisplay = document.getElementById(`sc-single-pts-${pid}`);
    if (ptsDisplay) {
      const hcp = effectiveHcp(pid);
      const shots = Scoring.shotsOnHole(hcp, _sis[_currentHole - 1]);
      const pts = newVal ? Scoring.stablefordPoints(newVal, currentPar, shots) : 0;
      ptsDisplay.textContent = newVal ? `${pts} pts` : '—';
    }
  }

  function adjustSingleHoleLost(pid, delta) {
    const inputEl = document.getElementById(`lost-${pid}-${_currentHole}`);
    if (!inputEl) return;

    let currentVal = parseInt(inputEl.value) || 0;
    let newVal = Math.max(0, currentVal + delta); // Cannot lose negative balls

    inputEl.value = newVal;

    // Update single-hole view lost balls display
    const lostDisplay = document.getElementById(`sc-single-lost-val-${pid}`);
    if (lostDisplay) {
      lostDisplay.textContent = newVal;
    }

    // Recalculate player total lost balls on the main grid
    recalcPlayer(pid);
  }

  async function saveFromSingleHole() {
    const btn = document.getElementById('sc-single-save-btn');
    const originalText = btn ? btn.innerHTML : '💾 Save Scores';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = 'Saving…';
    }
    try {
      await saveAllScores();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }
  }

  return {
    render,
    destroy,
    onInput,
    resetAllScores,
    toggleView,
    renderSingleHole,
    changeSingleHole,
    adjustSingleHoleScore,
    adjustSingleHoleLost,
    saveFromSingleHole
  };
})();
