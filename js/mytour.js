// ============================================================
//  mytour.js  —  My Tour: personal schedule view per player
// ============================================================

const MyTourPage = (() => {

  let _players  = {};
  let _schedule = {};
  let _courses  = {};
  let _selectedPid = null;

  let _unsubP = null;
  let _unsubS = null;
  let _unsubC = null;

  const FORMAT_LABELS = {
    singles: 'Singles Stableford',
    pairs:   'Pairs Stableford',
    team:    'Team Day'
  };
  const FORMAT_CLASS = { singles: 'format-singles', pairs: 'format-pairs', team: 'format-team' };

  // ── Render ──────────────────────────────────────────────
  function render(container) {
    // Restore last selected player from session
    _selectedPid = sessionStorage.getItem('mytour_pid') || null;

    container.innerHTML = `
      <div class="page">
        <div class="flex-between mt-8">
          <span class="section-title">🗺️ My Tour</span>
        </div>

        <!-- Player selector -->
        <div class="card mt-12" id="mytour-selector-card">
          <label class="form-group" style="margin:0">
            <span style="display:block;font-size:0.82rem;font-weight:600;color:#57606a;margin-bottom:6px">Select your name to see your personal schedule</span>
            <select id="mytour-player-select" style="width:100%;padding:11px 12px;border:1.5px solid #d0d7de;border-radius:8px;font-size:1rem;font-family:inherit;background:#fff">
              <option value="">— Choose a player —</option>
            </select>
          </label>
        </div>

        <!-- Schedule output -->
        <div id="mytour-schedule"></div>
      </div>`;

    document.getElementById('mytour-player-select').onchange = e => {
      _selectedPid = e.target.value || null;
      sessionStorage.setItem('mytour_pid', _selectedPid || '');
      renderSchedule();
    };

    // Subscribe to live data
    if (_unsubP) _unsubP();
    if (_unsubS) _unsubS();
    if (_unsubC) _unsubC();
    _unsubP = DB.on('players',  d => { _players  = d || {}; populateSelect(); renderSchedule(); });
    _unsubS = DB.on('schedule', d => { _schedule = d || {}; renderSchedule(); });
    _unsubC = DB.on('courses',  d => { _courses  = d || {}; renderSchedule(); });
  }

  // ── Player selector ──────────────────────────────────────
  function populateSelect() {
    const sel = document.getElementById('mytour-player-select');
    if (!sel) return;
    const sorted = Object.entries(_players)
      .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));
    sel.innerHTML = `<option value="">— Choose a player —</option>` +
      sorted.map(([pid, p]) =>
        `<option value="${pid}"${pid === _selectedPid ? ' selected' : ''}>${p.name}${p.nickname ? ` (${p.nickname})` : ''}</option>`
      ).join('');
  }

  // ── Schedule render ──────────────────────────────────────
  function renderSchedule() {
    const el = document.getElementById('mytour-schedule');
    if (!el) return;

    if (!_selectedPid) {
      el.innerHTML = '';
      return;
    }

    const player = _players[_selectedPid];
    if (!player) { el.innerHTML = ''; return; }

    const days = Object.entries(_schedule).sort((a, b) => a[0].localeCompare(b[0]));
    if (days.length === 0) {
      el.innerHTML = '<p class="center-msg">No schedule has been set up yet.</p>';
      return;
    }

    // Build slot map (rank by handicap asc, slot 1 = lowest)
    const slots = Object.entries(_players)
      .sort((a, b) => (a[1].handicap ?? 99) - (b[1].handicap ?? 99))
      .map(([pid], i) => ({ pid, slot: i + 1 }));
    const mySlot = slots.find(s => s.pid === _selectedPid)?.slot ?? null;

    el.innerHTML = days.map(([key, day]) => buildDayCard(key, day, slots, mySlot)).join('');
  }

  function buildDayCard(key, day, slots, mySlot) {
    const dayNum   = key.replace('day', '');
    const course   = day.courseId ? _courses[day.courseId] : null;
    const fmt      = FORMAT_LABELS[day.format] || day.format || '—';
    const fmtClass = FORMAT_CLASS[day.format] || '';
    const groups   = day.groupings || [];
    const firstTee = day.teeTime || '08:00';

    // Find which group I'm in and compute my tee time
    let myGroupIndex = -1;
    let myGroupmates = [];

    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      const pids = resolvePids(g, slots);
      if (pids.includes(_selectedPid)) {
        myGroupIndex = gi;
        myGroupmates = pids.filter(pid => pid !== _selectedPid);
        break;
      }
    }

    const teeMin  = timeToMin(firstTee) + myGroupIndex * 10;
    const teeTime = myGroupIndex >= 0 ? minToTime(teeMin) : null;

    // Build content rows
    const rows = [];

    // Course
    rows.push(infoRow('⛳', 'Golf Course', course ? course.name : '<span class="text-muted">TBC</span>'));

    // Format
    rows.push(infoRow('🏌️', 'Format', `<span class="format-badge ${fmtClass}" style="font-size:0.78rem">${fmt}</span>`));

    // Pickup from hotel
    rows.push(infoRow('🚌', 'Pickup from Hotel', day.busPickup ? `<strong>${fmt12(day.busPickup)}</strong>` : '<span class="text-muted">—</span>'));

    // Tee time
    if (myGroupIndex >= 0) {
      rows.push(infoRow('⏰', 'My Tee Time', `<strong style="color:#1a5c2a;font-size:1rem">${fmt12(minToTime(teeMin))}</strong>`));
    } else {
      rows.push(infoRow('⏰', 'My Tee Time', '<span class="text-muted">Not assigned to a group</span>'));
    }

    // Playing partners — behaviour depends on format
    if (myGroupIndex >= 0) {
      const allPids = resolvePids(groups[myGroupIndex], slots);

      if (day.format === 'singles') {
        // Singles: just the full group, no partner callout
        const groupHtml = allPids.map(pid => {
          const isSelf = pid === _selectedPid;
          const name   = _players[pid]?.name || '?';
          return `<span class="mytour-partner-pill${isSelf ? ' mytour-partner-self' : ''}">${name}${isSelf ? ' (me)' : ''}</span>`;
        }).join('');
        rows.push(infoRow('👥', 'Playing Group',
          `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:2px">${groupHtml}</div>`));

      } else if (day.format === 'pairs') {
        // Pairs partner (first other player in group = the pair)
        const partnerPid  = myGroupmates[0];
        const partnerName = partnerPid ? (_players[partnerPid]?.name || '?') : null;
        rows.push(infoRow('🤝', 'Pairs Partner',
          partnerName
            ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:2px"><span class="mytour-partner-pill mytour-partner-accent">${partnerName}</span></div>`
            : '<span class="text-muted">Not yet paired</span>'));

        // Other members of the group (everyone except me and my partner)
        const otherPids = allPids.filter(pid => pid !== _selectedPid && pid !== partnerPid);
        if (otherPids.length > 0) {
          const otherHtml = otherPids.map(pid =>
            `<span class="mytour-partner-pill">${_players[pid]?.name || '?'}</span>`
          ).join('');
          rows.push(infoRow('👥', 'Also in Group',
            `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:2px">${otherHtml}</div>`));
        }

      } else {
        // Team day: show all group members including self
        const groupHtml = allPids.map(pid => {
          const isSelf = pid === _selectedPid;
          const name   = _players[pid]?.name || '?';
          return `<span class="mytour-partner-pill${isSelf ? ' mytour-partner-self' : ''}">${name}${isSelf ? ' (me)' : ''}</span>`;
        }).join('');
        rows.push(infoRow('👥', 'Playing Group',
          `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:2px">${groupHtml}</div>`));
      }

    } else {
      // Not assigned to any group yet
      if (day.format !== 'singles') {
        rows.push(infoRow('👥', 'Playing Group', '<span class="text-muted">Not assigned to a group</span>'));
      }
    }

    // Pickup from course
    rows.push(infoRow('🚌', 'Pickup from Course', day.busReturn ? `<strong>${fmt12(day.busReturn)}</strong>` : '<span class="text-muted">—</span>'));

    // Scoring notes
    if (day.scoringNote) {
      rows.push(infoRow('📝', 'Notes', `<span style="color:#57606a">${day.scoringNote}</span>`));
    }

    const notInGroup = myGroupIndex < 0
      ? `<div class="mytour-unassigned">You are not yet assigned to a group for this day</div>`
      : '';

    return `
      <div class="card mytour-day-card">
        <div class="mytour-day-header">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="day-badge">Day ${dayNum}</span>
            <span class="mytour-day-label">${day.label || `Day ${dayNum}`}</span>
          </div>
          ${teeTime ? `<span class="mytour-teetime-hero">${fmt12(minToTime(teeMin))}</span>` : ''}
        </div>
        ${notInGroup}
        <div class="mytour-info-grid">
          ${rows.join('')}
        </div>
      </div>`;
  }

  // ── Helpers ──────────────────────────────────────────────
  function resolvePids(group, slots) {
    if (group.slots) {
      return group.slots
        .map(s => slots.find(sl => sl.slot === s)?.pid)
        .filter(Boolean);
    }
    return (group.playerIds || []);
  }

  function infoRow(icon, label, valueHtml) {
    return `
      <div class="mytour-info-row">
        <span class="mytour-info-icon">${icon}</span>
        <span class="mytour-info-label">${label}</span>
        <span class="mytour-info-value">${valueHtml}</span>
      </div>`;
  }

  function timeToMin(t = '08:00') {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  function minToTime(min) {
    const h = Math.floor(min / 60) % 24;
    const m = min % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }

  // Format 24h time to 12h display e.g. "08:30" → "8:30 AM"
  function fmt12(t = '00:00') {
    const [h, m] = t.split(':').map(Number);
    const ampm = h < 12 ? 'AM' : 'PM';
    const h12  = h % 12 || 12;
    return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
  }

  function destroy() {
    if (_unsubP) { _unsubP(); _unsubP = null; }
    if (_unsubS) { _unsubS(); _unsubS = null; }
    if (_unsubC) { _unsubC(); _unsubC = null; }
  }

  return { render, destroy };
})();
