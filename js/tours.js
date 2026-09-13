// ============================================================
// tours.js — Tour selector and admin tour settings
// ============================================================
const ToursPage = (() => {
  let _tours = {};
  let _unsub = null;

  function render(container) {
    container.innerHTML = `<div class="page">
      <div class="section-title mt-8">⛳ Select a Tour</div>
      <div id="tour-list" class="tour-grid mt-12"></div>
    </div>`;
    if (_unsub) _unsub();
    DB.getTours().then(data => { _tours = data || {}; renderList(); });
  }

  function renderList() {
    const el = document.getElementById('tour-list');
    if (!el) return;
    el.innerHTML = Object.entries(_tours).map(([id, tour]) =>
      `<button class="tour-card ${id === DB.activeTour() ? 'selected' : ''}" onclick="ToursPage.select('${id}')">
        <strong>${tour.name}</strong><span>${tour.playerCount || 12} players</span>
        <span>${tour.teamBased ? `${tour.teamCount || 3} teams` : 'Individual tour'}</span>
      </button>`
    ).join('') || '<p class="center-msg">No tours configured.</p>';
  }

  async function renderAdmin(container) {
    container.innerHTML = `<div class="page">
      <div class="section-title mt-8">⚙️ Tour Administration</div>
      <div class="card mt-12">
        <div class="card-title">Tour Settings</div>
        <div class="form-row mt-8"><div class="form-group"><label>Tour name</label><input id="tour-name" /></div><div class="form-group"><label>Players</label><input id="tour-players" type="number" min="1" /></div><div class="form-group"><label>Rounds</label><input id="tour-rounds" type="number" min="1" max="30" /></div></div>
        <div class="form-group"><label><input type="checkbox" id="tour-team-based" /> Team based tour</label></div>
        <div class="form-group"><label><input type="checkbox" id="tour-ryder-cup" /> Ryder Cup style tour</label><div class="text-muted" style="font-size:0.78rem;margin-top:4px">Only matchplay points and nearest-the-pin points count toward the team leaderboard.</div></div>
        <div class="form-group" id="tour-team-count-wrap"><label>Number of teams</label><input id="tour-team-count" type="number" min="2" max="12" value="3" /></div>
        <div class="form-group"><label>Tabs shown to users</label><div class="check-grid">
          <label><input type="checkbox" data-tab-option="tour" /> Tour Results</label><label><input type="checkbox" data-tab-option="dailyfocus" /> Daily Results</label><label><input type="checkbox" data-tab-option="individual" /> Individual</label><label><input type="checkbox" data-tab-option="bingo" /> Birdie Bingo</label><label><input type="checkbox" data-tab-option="ntp" /> Nearest Pin</label><label><input type="checkbox" data-tab-option="matchplay" /> Matchplay</label><label><input type="checkbox" data-tab-option="lostballs" /> Lost Balls</label>
        </div></div><button type="button" class="btn-primary" id="tour-save" onclick="ToursPage.saveSettings()">Save Settings</button>
      </div>
      <div class="card"><div class="card-title">Create New Tour</div><p class="text-muted mt-8">Create a separate tour and configure it independently.</p><button class="btn-secondary mt-8" id="new-tour-btn">+ New Tour</button></div>
    </div>`;
    document.getElementById('new-tour-btn').onclick = showCreateForm;
    try {
      _tours = await DB.getTours();
    } catch (error) {
      console.error('load tour settings error:', error);
      _tours = {};
    }
    const tour = _tours[DB.activeTour()] || {};
    document.getElementById('tour-name').value = tour.name || '';
    document.getElementById('tour-players').value = tour.playerCount || 12;
    document.getElementById('tour-rounds').value = tour.rounds || tour.days || 5;
    document.getElementById('tour-team-based').checked = !!tour.teamBased;
    document.getElementById('tour-ryder-cup').checked = !!tour.ryderCup;
    document.getElementById('tour-team-count').value = tour.teamCount || 3;
    const tabs = tour.tabs || { tour:true, dailyfocus:true, individual:true, bingo:true, ntp:true, matchplay:true, lostballs:true };
    document.querySelectorAll('[data-tab-option]').forEach(el => { el.checked = tabs[el.dataset.tabOption] !== false; });
    const teamBasedInput = document.getElementById('tour-team-based');
    teamBasedInput.onchange = () => document.getElementById('tour-team-count-wrap').classList.toggle('hidden', !teamBasedInput.checked);
    teamBasedInput.onchange();
  }

  function showCreateForm() {
    const name = prompt('New tour name');
    if (!name) return;
    const players = parseInt(prompt('Number of players', '12'), 10) || 12;
    DB.initTour(name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), { name, playerCount: players, teamBased: false, teamCount: 0, ryderCup: false, tabs: { tour:true, dailyfocus:true, individual:true, bingo:false, ntp:false, matchplay:false, lostballs:false }, scoringOptions: { bingo:false, ntp:false, matchplay:false } }).then(() => { App.toast('Tour created ✓'); renderAdmin(document.getElementById('app-main')); });
  }

  async function saveSettings() {
    const saveButton = document.getElementById('tour-save');
    const name = document.getElementById('tour-name').value.trim();
    if (!name) { App.toast('Enter a tour name'); return; }

    const tabs = {};
    document.querySelectorAll('[data-tab-option]').forEach(el => { tabs[el.dataset.tabOption] = el.checked; });
    const teamBased = document.getElementById('tour-team-based').checked;
    const ryderCup = document.getElementById('tour-ryder-cup').checked;
    const tourId = DB.activeTour();
    if (!tourId) { App.toast('Select a tour first'); return; }
    const rounds = Math.max(1, Math.min(30, parseInt(document.getElementById('tour-rounds').value, 10) || 1));
    const data = {
      name,
      playerCount: parseInt(document.getElementById('tour-players').value, 10) || 12,
      rounds,
      teamBased,
      teamCount: teamBased ? parseInt(document.getElementById('tour-team-count').value, 10) || 2 : 0,
      ryderCup,
      tabs,
      scoringOptions: { bingo: tabs.bingo, ntp: tabs.ntp, matchplay: tabs.matchplay }
    };

    if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Saving…'; }
    try {
      await DB.setTourMeta(tourId, data);
      const savedTours = await DB.getTours();
      const saved = savedTours[tourId];
      if (!saved || saved.name !== data.name || Number(saved.playerCount) !== data.playerCount || Number(saved.rounds) !== data.rounds || !!saved.teamBased !== data.teamBased || Number(saved.teamCount) !== data.teamCount || !!saved.ryderCup !== data.ryderCup) {
        throw new Error('Tour settings could not be verified after saving');
      }
      // Tour registry is the source of truth for tour settings. Do not make
      // saving depend on the separate per-tour config write.
      _tours = savedTours;
      await DB.update('config', { days: rounds });
      const schedule = await DB.get('schedule') || {};
      for (const key of Object.keys(schedule)) {
        if (Number(key.replace('day', '')) > rounds) await DB.remove(`schedule/${key}`);
      }
      const formats = ['singles', 'pairs', 'singles', 'team', 'pairs'];
      for (let d = 1; d <= rounds; d++) {
        if (!schedule[`day${d}`]) await DB.set(`schedule/day${d}`, { label: `Day ${d}`, format: formats[d - 1] || 'singles', scoringNote: '', teeTime: '08:00', groupings: [] });
      }
      App.toast('Tour settings saved ✓');
      App.applyTourSettings();
      await renderAdmin(document.getElementById('app-main'));
    } catch (error) {
      console.error('saveSettings error:', error);
      App.toast(`Unable to save tour settings: ${error.message}`);
    } finally {
      if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Save Settings'; }
    }
  }

  function select(id) { DB.selectTour(id); window.location.reload(); }
  function destroy() { if (_unsub) { _unsub(); _unsub = null; } }
  return { render, renderAdmin, destroy, select, saveSettings };
})();
