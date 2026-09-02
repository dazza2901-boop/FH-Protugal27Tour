// ============================================================
//  schedule.js  —  Daily format, tee times, groupings + course editor
// ============================================================

const SchedulePage = (() => {

  let _schedule = {};
  let _players  = {};
  let _teams    = {};
  let _courses  = {};
  let _unsub    = null;
  let _unsubP   = null;
  let _unsubT   = null;
  let _unsubC   = null;
  let _isAdmin  = false;
  let _editDay  = null;
  let _editCourse = null;   // key of course being edited, or 'new'

  const FORMAT_LABELS = {
    singles: 'Singles Stableford',
    pairs:   'Pairs Stableford',
    team:    'Team Day [ Best 2 (3/4s), Best 3 (5s) ]'
  };
  const FORMAT_CLASS = { singles: 'format-singles', pairs: 'format-pairs', team: 'format-team' };

  // ── Render ──────────────────────────────────────────────
  function render(container, isAdmin) {
    _isAdmin = isAdmin;
    container.innerHTML = `<div class="page">
      <div class="flex-between mt-8">
        <span class="section-title">📅 Tournament Schedule</span>
        ${isAdmin ? `<button class="btn-primary btn-sm" onclick="SchedulePage.showCourseManager()">⛳ Courses</button>` : ''}
      </div>
      <div id="schedule-list" class="mt-12"></div>

      <!-- Day editor (admin only) -->
      ${isAdmin ? `
      <div id="day-editor" class="card hidden">
        <div class="card-header">
          <span class="card-title" id="day-editor-title">Edit Day</span>
          <button class="btn-icon" id="day-editor-close">✕</button>
        </div>
        <div class="form-group">
          <label>Day Label</label>
          <input type="text" id="de-label" placeholder="e.g. Day 1 — St Andrews" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Format</label>
            <select id="de-format">
              <option value="singles">Singles Stableford</option>
              <option value="pairs">Pairs Stableford</option>
              <option value="team">Team Day [ Best 2 (3/4s), Best 3 (5s) ]</option>
            </select>
          </div>
          <div class="form-group">
            <label>First Tee Time</label>
            <input type="time" id="de-teetime" value="08:00" />
          </div>
        </div>
        <div class="form-group">
          <label>Golf Course</label>
          <select id="de-course">
            <option value="">— No course selected (use defaults) —</option>
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>🚌 Bus Pickup (hotel)</label>
            <input type="time" id="de-buspickup" value="08:00" />
          </div>
          <div class="form-group">
            <label>🚌 Return from Course</label>
            <input type="time" id="de-busreturn" value="16:00" />
          </div>
        </div>
        <div class="form-group">
          <label>Scoring Notes (optional)</label>
          <input type="text" id="de-notes" placeholder="e.g. 10 pt for hole-in-one" />
        </div>
        <div class="card-title mt-12" style="margin-bottom:8px">Groupings</div>
        <p class="text-muted" style="margin-bottom:8px">Groups get tee times 10 min apart from first tee time.</p>
        <div id="groupings-editor"></div>
        <button class="btn-secondary btn-sm mt-8" id="add-group-btn">+ Add Group</button>
        <div class="modal-actions mt-12">
          <button class="btn-secondary" id="day-editor-cancel">Cancel</button>
          <button class="btn-primary" id="day-editor-save">Save Day</button>
        </div>
      </div>

      <!-- Course manager panel -->
      <div id="course-manager" class="card hidden">
        <div class="card-header">
          <span class="card-title">⛳ Golf Courses</span>
          <button class="btn-icon" id="course-manager-close">✕</button>
        </div>
        <div id="course-list"></div>
        <button class="btn-secondary btn-sm mt-8" id="add-course-btn">+ Add New Course</button>
      </div>

      <!-- Course editor form -->
      <div id="course-editor" class="card hidden">
        <div class="card-header">
          <span class="card-title" id="course-editor-title">Add Course</span>
          <button class="btn-icon" id="course-editor-close">✕</button>
        </div>
        <div class="form-group">
          <label>Course Name</label>
          <input type="text" id="ce-name" placeholder="e.g. St Andrews Old Course" />
        </div>
        <div class="card-title" style="margin:12px 0 8px;font-size:0.85rem">Hole Details — Par &amp; Stroke Index</div>
        <div style="overflow-x:auto">
          <table id="ce-hole-table" style="border-collapse:collapse;width:100%;min-width:480px;font-size:0.82rem">
            <thead>
              <tr>
                <th style="padding:6px 8px;background:#1a5c2a;color:#fff;text-align:left;border-radius:6px 0 0 0">Hole</th>
                ${Array.from({length:18},(_,i)=>`<th style="padding:6px 4px;background:#1a5c2a;color:#fff;text-align:center;min-width:36px">${i+1}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              <tr id="ce-par-row">
                <td style="padding:6px 8px;font-weight:700;background:#f7f8fa;font-size:0.78rem">Par</td>
                ${Array.from({length:18},(_,i)=>`
                  <td style="padding:3px 2px;text-align:center">
                    <input type="number" id="ce-par-${i+1}" min="3" max="6" value="4"
                      style="width:34px;text-align:center;padding:4px 2px;border:1.5px solid #d0d7de;border-radius:4px;font-size:0.82rem" />
                  </td>`).join('')}
              </tr>
              <tr id="ce-si-row">
                <td style="padding:6px 8px;font-weight:700;background:#f7f8fa;font-size:0.78rem">SI</td>
                ${Array.from({length:18},(_,i)=>`
                  <td style="padding:3px 2px;text-align:center">
                    <input type="number" id="ce-si-${i+1}" min="1" max="18" value="${i+1}"
                      style="width:34px;text-align:center;padding:4px 2px;border:1.5px solid #d0d7de;border-radius:4px;font-size:0.82rem" />
                  </td>`).join('')}
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-muted mt-8" style="font-size:0.75rem">SI = Stroke Index (1 = hardest, 18 = easiest). All 18 values must be unique 1–18.</p>
        <div class="modal-actions mt-12">
          <button class="btn-secondary" id="course-editor-cancel">Cancel</button>
          <button class="btn-primary" id="course-editor-save">Save Course</button>
        </div>
      </div>
      ` : ''}
    </div>`;

    if (isAdmin) {
      document.getElementById('day-editor-close').onclick    = closeEditor;
      document.getElementById('day-editor-cancel').onclick   = closeEditor;
      document.getElementById('day-editor-save').onclick     = saveDay;
      document.getElementById('add-group-btn').onclick       = addGroupRow;
      document.getElementById('course-manager-close').onclick = hideCourseManager;
      document.getElementById('add-course-btn').onclick      = () => openCourseEditor('new');
      document.getElementById('course-editor-close').onclick  = closeCourseEditor;
      document.getElementById('course-editor-cancel').onclick = closeCourseEditor;
      document.getElementById('course-editor-save').onclick   = saveCourse;
    }

    if (_unsub)  _unsub();
    if (_unsubP) _unsubP();
    if (_unsubT) _unsubT();
    if (_unsubC) _unsubC();
    _unsubP = DB.on('players',  d => { _players  = d || {}; renderList(); });
    _unsubT = DB.on('teams',    d => { _teams    = d || {}; renderList(); });
    _unsub  = DB.on('schedule', d => { _schedule = d || {}; renderList(); });
    _unsubC = DB.on('courses',  d => { _courses  = d || {}; renderList(); renderCourseList(); populateCourseSelect(); });
  }

  // ── Schedule list ────────────────────────────────────────
  function renderList() {
    const list = document.getElementById('schedule-list');
    if (!list) return;
    const days = Object.entries(_schedule).sort((a, b) => a[0].localeCompare(b[0]));
    if (days.length === 0) {
      list.innerHTML = '<p class="center-msg">No schedule yet.</p>';
      return;
    }
    list.innerHTML = days.map(([key, day]) => {
      const fmt      = FORMAT_LABELS[day.format] || day.format;
      const fmtClass = FORMAT_CLASS[day.format] || '';
      const groups   = day.groupings || [];
      const course   = day.courseId ? _courses[day.courseId] : null;
      return `
        <div class="card day-card" ${_isAdmin ? `onclick="SchedulePage.openEditor('${key}')"` : ''}>
          <div class="card-header" style="margin-bottom:8px">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span class="day-badge">${key.replace('day','Day ')}</span>
              <span style="font-weight:700">${day.label || key}</span>
            </div>
            <span class="format-badge ${fmtClass}">${fmt}</span>
          </div>
          ${course ? `<div style="font-size:0.9rem;font-weight:700;color:#1a5c2a;margin-bottom:6px">⛳ ${course.name}</div>` : ''}
          ${(day.busPickup || day.busReturn) ? `
          <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:8px;padding:8px 10px;background:#f0f4ff;border-radius:8px;border:1px solid #c9d6f5;font-size:0.82rem">
            ${day.busPickup ? `<span>🚌 <strong>Pickup:</strong> ${day.busPickup}</span>` : ''}
            ${day.busReturn ? `<span>🚌 <strong>Return:</strong> ${day.busReturn}</span>` : ''}
          </div>` : ''}
          <div class="text-muted" style="margin-bottom:${groups.length ? '10px' : '0'}">
            ${day.scoringNote ? `📝 ${day.scoringNote}` : ''}
          </div>
          ${groups.map((g, gi) => {
            const teeMin   = timeToMin(day.teeTime || '08:00') + gi * 10;
            const slotList = computeSlots();
            const slots    = g.slots || (g.playerIds || []).map(pid =>
              slotList.find(s => s.pid === pid)?.slot
            ).filter(Boolean);
            const pids  = slots.map(s => slotList.find(sl => sl.slot === s)?.pid).filter(Boolean);
            const names = pids.map(pid => _players[pid]?.name || '?').join(' · ') || 'Empty group';
            return `<div class="grouping-row">
              <span class="tee-time-badge">${minToTime(teeMin)}</span>
              <span>${names}</span>
            </div>`;
          }).join('')}
          ${_isAdmin ? `<p class="text-muted mt-8" style="font-size:0.75rem">Tap to edit</p>` : ''}
        </div>`;
    }).join('');
  }

  // ── Day editor ───────────────────────────────────────────
  function openEditor(dayKey) {
    _editDay = dayKey;
    const day = _schedule[dayKey] || {};
    document.getElementById('day-editor-title').textContent = `Edit ${dayKey.replace('day','Day ')}`;
    document.getElementById('de-label').value     = day.label       || `Day ${dayKey.replace('day','')}`;
    document.getElementById('de-format').value    = day.format      || 'singles';
    document.getElementById('de-teetime').value   = day.teeTime     || '08:00';
    document.getElementById('de-buspickup').value = day.busPickup   || '';
    document.getElementById('de-busreturn').value = day.busReturn   || '';
    document.getElementById('de-notes').value     = day.scoringNote || '';
    populateCourseSelect(day.courseId);
    renderGroupingsEditor(day.groupings || []);
    document.getElementById('day-editor').classList.remove('hidden');
    document.getElementById('day-editor').scrollIntoView({ behavior: 'smooth' });
  }

  function closeEditor() {
    document.getElementById('day-editor').classList.add('hidden');
    _editDay = null;
  }

  function populateCourseSelect(selectedId) {
    const sel = document.getElementById('de-course');
    if (!sel) return;
    sel.innerHTML = `<option value="">— No course selected (use defaults) —</option>` +
      Object.entries(_courses).map(([id, c]) =>
        `<option value="${id}"${id === selectedId ? ' selected' : ''}>${c.name}</option>`
      ).join('');
  }

  // ── Slot helpers (mirrors teams.js logic) ────────────────
  // Returns [{pid, slot}] sorted by handicap asc
  function computeSlots() {
    return Object.entries(_players)
      .sort((a, b) => (a[1].handicap ?? 99) - (b[1].handicap ?? 99))
      .map(([pid], i) => ({ pid, slot: i + 1 }));
  }
  function slotToPid(slot) {
    return computeSlots().find(s => s.slot === slot)?.pid || null;
  }
  function pidToSlot(pid) {
    return computeSlots().find(s => s.pid === pid)?.slot || null;
  }

  function renderGroupingsEditor(groups) {
    const container = document.getElementById('groupings-editor');
    if (!container) return;
    const slotOptions = buildSlotOptions();

    container.innerHTML = groups.map((g, gi) => buildGroupRowHTML(gi, slotOptions)).join('');

    // Restore existing slot selections
    // Support both new format (g.slots) and legacy (g.playerIds converted back to slots)
    groups.forEach((g, gi) => {
      const slots = g.slots || (g.playerIds || []).map(pid => pidToSlot(pid)).filter(Boolean);
      slots.forEach((slot, pi) => {
        const sel = document.getElementById(`g-${gi}-p${pi}`);
        if (sel) sel.value = slot;
      });
    });
  }

  function buildSlotOptions() {
    // Just numbered slots 1-12 — no names attached so they stay stable
    return Array.from({length: 12}, (_, i) => {
      const slot = i + 1;
      return `<option value="${slot}">Player ${slot}</option>`;
    }).join('');
  }

  function buildGroupRowHTML(gi, slotOptions) {
    const selStyle = 'flex:1;padding:6px;border-radius:6px;border:1.5px solid #d0d7de;min-width:0;font-size:0.82rem;min-width:90px';
    return `<div class="grouping-row" id="group-row-${gi}" style="flex-wrap:wrap;gap:6px">
      <span class="tee-time-badge" style="background:#888">G${gi+1}</span>
      <select id="g-${gi}-p0" style="${selStyle}"><option value="">P…</option>${slotOptions}</select>
      <select id="g-${gi}-p1" style="${selStyle}"><option value="">P…</option>${slotOptions}</select>
      <select id="g-${gi}-p2" style="${selStyle}"><option value="">P…</option>${slotOptions}</select>
      <select id="g-${gi}-p3" style="${selStyle}"><option value="">P…</option>${slotOptions}</select>
      <button onclick="SchedulePage.removeGroupRow(${gi})"
        style="background:none;border:none;font-size:1.1rem;cursor:pointer;color:#d93025;flex-shrink:0">✕</button>
    </div>`;
  }

  function addGroupRow() {
    const container = document.getElementById('groupings-editor');
    const gi = container.querySelectorAll('.grouping-row').length;
    const slotOptions = buildSlotOptions();
    const div = document.createElement('div');
    div.innerHTML = buildGroupRowHTML(gi, slotOptions);
    container.appendChild(div.firstElementChild);
  }

  function removeGroupRow(gi) {
    const row = document.getElementById(`group-row-${gi}`);
    if (row) row.remove();
  }

  async function saveDay() {
    if (!_editDay) return;
    const label       = document.getElementById('de-label').value.trim();
    const format      = document.getElementById('de-format').value;
    const teeTime     = document.getElementById('de-teetime').value;
    const busPickup   = document.getElementById('de-buspickup').value || null;
    const busReturn   = document.getElementById('de-busreturn').value || null;
    const scoringNote = document.getElementById('de-notes').value.trim();
    const courseId    = document.getElementById('de-course').value || null;

    const rows = document.querySelectorAll('#groupings-editor .grouping-row');
    const groupings = [];
    rows.forEach((_, gi) => {
      const slots = [0,1,2,3]
        .map(pi => parseInt(document.getElementById(`g-${gi}-p${pi}`)?.value, 10) || null)
        .filter(Boolean);
      if (slots.length > 0) {
        // Store slots (stable) AND resolve current playerIds for scorecard/scoring use
        groupings.push({ slots, playerIds: slots.map(s => slotToPid(s)).filter(Boolean) });
      }
    });

    await DB.update(`schedule/${_editDay}`, { label, format, teeTime, busPickup, busReturn, scoringNote, courseId, groupings });
    App.toast('Day saved ✓');
    closeEditor();
  }

  // ── Course manager ───────────────────────────────────────
  function showCourseManager() {
    document.getElementById('course-manager').classList.remove('hidden');
    document.getElementById('course-manager').scrollIntoView({ behavior: 'smooth' });
  }

  function hideCourseManager() {
    document.getElementById('course-manager').classList.add('hidden');
  }

  function renderCourseList() {
    const el = document.getElementById('course-list');
    if (!el) return;
    const entries = Object.entries(_courses);
    if (entries.length === 0) {
      el.innerHTML = '<p class="text-muted" style="padding:8px 0">No courses yet. Add your first course.</p>';
      return;
    }
    el.innerHTML = entries.map(([id, c]) => {
      const parTotal = (c.pars || []).reduce((a, b) => a + b, 0);
      return `<div class="player-item">
        <div class="player-info">
          <div class="player-name">⛳ ${c.name}</div>
          <div class="player-meta">Par ${parTotal || '—'} · 18 holes</div>
        </div>
        <div class="player-actions">
          <button class="btn-secondary btn-sm" onclick="SchedulePage.openCourseEditor('${id}')">Edit</button>
          <button class="btn-danger btn-sm" onclick="SchedulePage.deleteCourse('${id}')">✕</button>
        </div>
      </div>`;
    }).join('');
  }

  // ── Course editor ────────────────────────────────────────
  function openCourseEditor(id) {
    _editCourse = id;
    const course = id === 'new' ? null : _courses[id];
    document.getElementById('course-editor-title').textContent = course ? 'Edit Course' : 'Add Course';
    document.getElementById('ce-name').value = course?.name || '';

    const defaultPars = Scoring.defaultPars();
    const defaultSIs  = Scoring.defaultSIs();

    for (let h = 1; h <= 18; h++) {
      const parInput = document.getElementById(`ce-par-${h}`);
      const siInput  = document.getElementById(`ce-si-${h}`);
      if (parInput) parInput.value = course?.pars?.[h-1] ?? defaultPars[h-1];
      if (siInput)  siInput.value  = course?.sis?.[h-1]  ?? defaultSIs[h-1];
    }

    document.getElementById('course-editor').classList.remove('hidden');
    document.getElementById('course-editor').scrollIntoView({ behavior: 'smooth' });
  }

  function closeCourseEditor() {
    document.getElementById('course-editor').classList.add('hidden');
    _editCourse = null;
  }

  async function saveCourse() {
    const name = document.getElementById('ce-name').value.trim();
    if (!name) { App.toast('Enter a course name'); return; }

    const pars = [], sis = [];
    for (let h = 1; h <= 18; h++) {
      const par = parseInt(document.getElementById(`ce-par-${h}`)?.value) || 4;
      const si  = parseInt(document.getElementById(`ce-si-${h}`)?.value)  || h;
      pars.push(Math.max(3, Math.min(6, par)));
      sis.push(Math.max(1, Math.min(18, si)));
    }

    // Validate SIs are unique 1–18
    const siSet = new Set(sis);
    if (siSet.size !== 18) {
      App.toast('Stroke indexes must all be unique (1–18)');
      return;
    }

    const btn = document.getElementById('course-editor-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
      if (_editCourse === 'new') {
        await DB.push('courses', { name, pars, sis });
        App.toast('Course added ✓');
      } else {
        await DB.update(`courses/${_editCourse}`, { name, pars, sis });
        App.toast('Course updated ✓');
      }
      closeCourseEditor();
    } catch (err) {
      console.error('saveCourse error:', err);
      App.toast('Error saving course');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Save Course'; }
    }
  }

  async function deleteCourse(id) {
    if (!confirm(`Delete "${_courses[id]?.name}"?`)) return;
    await DB.remove(`courses/${id}`);
    App.toast('Course deleted');
  }

  // ── Time helpers ─────────────────────────────────────────
  function timeToMin(t = '08:00') {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }
  function minToTime(min) {
    const h = Math.floor(min / 60) % 24;
    const m = min % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }

  function destroy() {
    if (_unsub)  { _unsub();  _unsub  = null; }
    if (_unsubP) { _unsubP(); _unsubP = null; }
    if (_unsubT) { _unsubT(); _unsubT = null; }
    if (_unsubC) { _unsubC(); _unsubC = null; }
  }

  function getSchedule() { return _schedule; }

  return { render, destroy, openEditor, addGroupRow, removeGroupRow, getSchedule,
           showCourseManager, openCourseEditor, deleteCourse };
})();
