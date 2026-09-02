// ============================================================
//  scoreboard.js  —  Live leaderboard
//  Tabs: Tour Results | Teams | Individual | Birdie Bingo | NTP | Daily Results Focus
// ============================================================

const ScoreboardPage = (() => {

  let _players   = {};
  let _teams     = {};
  let _schedule  = {};
  let _courses   = {};
  let _allScores = {};
  let _dayHcps   = {};   // { day1: { pid: shots }, … }  — per-day shot allocations
  let _config    = {};
  let _unsubs    = [];
  let _activeTab = 'tour';
  let _dailyFocusDay = 'day1';
  let _ntp       = {};   // { day1: { 3: { winnerId, winnerName }, … }, … }
  let _ntpUnsub  = null;
  let _isAdmin   = false;

  const DAYS = 5;
  const FORMAT_SHORT = { singles:'Singles', pairs:'Pairs', team:'Team' };

  // ── Render shell ─────────────────────────────────────────
  function render(container, isAdmin) {
    _isAdmin = isAdmin || false;
    container.innerHTML = `<div class="page">
      <div class="flex-between mt-8">
        <span class="section-title">🏆 Leaderboard</span>
        <span class="tag" style="background:#d4edda;color:#155724">● Live</span>
      </div>

      <div class="tabs">
        <button class="tab-btn active" data-tab="tour"        onclick="ScoreboardPage.switchTab('tour')">🏌️ Tour Results</button>
        <button class="tab-btn" data-tab="dailyfocus"         onclick="ScoreboardPage.switchTab('dailyfocus')">📅 Daily Results</button>
        <button class="tab-btn" data-tab="individual"         onclick="ScoreboardPage.switchTab('individual')">👤 Individual</button>
        <button class="tab-btn" data-tab="bingo"              onclick="ScoreboardPage.switchTab('bingo')">🎯 Birdie Bingo</button>
        <button class="tab-btn" data-tab="ntp"                onclick="ScoreboardPage.switchTab('ntp')">📍 Nearest Pin</button>
        <button class="tab-btn" data-tab="matchplay"          onclick="ScoreboardPage.switchTab('matchplay')">⚔️ Matchplay</button>
        <button class="tab-btn" data-tab="lostballs"          onclick="ScoreboardPage.switchTab('lostballs')">🔴 Lost Balls</button>
      </div>

      <div id="sb-tour"        class="tab-content"></div>
      <div id="sb-dailyfocus"  class="tab-content hidden"></div>
      <div id="sb-individual"  class="tab-content hidden"></div>
      <div id="sb-bingo"       class="tab-content hidden"></div>
      <div id="sb-ntp"         class="tab-content hidden"></div>
      <div id="sb-matchplay"   class="tab-content hidden"></div>
      <div id="sb-lostballs"   class="tab-content hidden"></div>
    </div>`;

    _unsubs.forEach(u => u());
    _unsubs = [];

    _unsubs.push(DB.on('players',  d => { _players  = d || {}; TeamsPage.syncSlots(); refreshAll(); }));
    _unsubs.push(DB.on('teams',    d => { _teams    = d || {}; refreshAll(); }));
    _unsubs.push(DB.on('schedule', d => { _schedule = d || {}; refreshAll(); }));
    _unsubs.push(DB.on('courses',  d => { _courses  = d || {}; refreshAll(); }));
    _unsubs.push(DB.on('config',   d => { _config   = d || {}; refreshAll(); }));
    _unsubs.push(DB.on('ntp',      d => { _ntp      = d || {}; refreshAll();  }));

    for (let d = 1; d <= DAYS; d++) {
      const day = d;
      _unsubs.push(DB.on(`scores/day${day}`, data => {
        _allScores[`day${day}`] = data || {};
        refreshAll();
      }));
      _unsubs.push(DB.on(`dayHandicaps/day${day}`, data => {
        _dayHcps[`day${day}`] = data || {};
        refreshAll();
      }));
    }
  }

  function refreshAll() {
    renderTour();
    renderTeams();
    renderIndividual();
    renderBingo();
    renderNTP();
    renderMatchplay();
    renderDailyFocus();
    renderLostBalls();
  }

  // ── Helpers ──────────────────────────────────────────────
  function firstName(fullName) {
    return (fullName || '').split(' ')[0] || fullName || '';
  }

  // Effective handicap for a player on a specific day:
  // uses the day's shot allocation if set, otherwise falls back to player's index handicap.
  function effectiveHcp(pid, dayKey) {
    const alloc = _dayHcps[dayKey]?.[pid];
    if (alloc !== undefined && alloc !== null && alloc !== '') return Number(alloc);
    return _players[pid]?.handicap || 0;
  }

  function playerTeam(pid) {
    for (const [tid, team] of Object.entries(_teams)) {
      if ((team.playerIds || []).includes(pid)) return { tid, name: team.name, color: team.color };
    }
    return null;
  }

  function dayParsAndSIs(dayKey) {
    const courseId = _schedule[dayKey]?.courseId;
    const course   = courseId ? _courses[courseId] : null;
    return {
      pars: (course?.pars?.length === 18) ? course.pars : Scoring.defaultPars(),
      sis:  (course?.sis?.length  === 18) ? course.sis  : Scoring.defaultSIs()
    };
  }

  // Extract all pairs for a day from schedule groupings (consecutive pairs within each group)
  function dayPairs(dayKey) {
    const groupings = _schedule[dayKey]?.groupings || [];
    const pairs = [];
    groupings.forEach(g => {
      const ids = g.playerIds || [];
      for (let i = 0; i + 1 < ids.length; i += 2) {
        pairs.push([ids[i], ids[i + 1]]);
      }
    });
    return pairs;
  }

  function teamDayScore(team, dayKey) {
    const format     = _schedule[dayKey]?.format || 'singles';
    const dayScores  = _allScores[dayKey] || {};
    const memberIds  = team.playerIds || [];
    const { pars, sis } = dayParsAndSIs(dayKey);
    let pts = 0;

    if (format === 'singles') {
      // Individual stableford values were saved with the correct day handicap — use them directly
      memberIds.forEach(pid => { pts += dayScores[pid]?.stableford || 0; });

    } else if (format === 'pairs') {
      // Pairs come from schedule groupings (consecutive within each group), not team player order.
      // Best score of the two partners per hole — matches recalcPairs() in scorecard exactly.
      const memberSet = new Set(memberIds);
      const pairs = dayPairs(dayKey).filter(([a, b]) => memberSet.has(a) && memberSet.has(b));
      for (const [pidA, pidB] of pairs) {
        for (let hole = 1; hole <= 18; hole++) {
          const i = hole - 1;
          const grossA = dayScores[pidA]?.[`h${hole}`] || 0;
          const grossB = dayScores[pidB]?.[`h${hole}`] || 0;
          const ptsA = grossA ? Scoring.stablefordPoints(grossA, pars[i], Scoring.shotsOnHole(effectiveHcp(pidA, dayKey), sis[i])) : 0;
          const ptsB = grossB ? Scoring.stablefordPoints(grossB, pars[i], Scoring.shotsOnHole(effectiveHcp(pidB, dayKey), sis[i])) : 0;
          pts += Math.max(ptsA, ptsB);
        }
      }

    } else if (format === 'team') {
      // Best 2 per hole on par 3/4s, best 3 on par 5s
      for (let hole = 1; hole <= 18; hole++) {
        const holePts = memberIds.map(pid => {
          const gross = dayScores[pid]?.[`h${hole}`] || 0;
          if (!gross) return 0;
          return Scoring.stablefordPoints(gross, pars[hole - 1], Scoring.shotsOnHole(effectiveHcp(pid, dayKey), sis[hole - 1]));
        }).sort((a, b) => b - a);
        const count = pars[hole - 1] === 5 ? 3 : 2;
        for (let k = 0; k < count; k++) pts += holePts[k] || 0;
      }
    }
    return pts;
  }

  // ── Tour Scoring ─────────────────────────────────────────
  //
  //  Points per day by format:
  //    team:    rank teams by team stableford  → 5 / 3 / 1.5
  //    singles: rank players by stableford, sum by team → 4/3.5/3/2.5/2/1.5/1/0.5
  //    pairs:   rank pairs (consecutive player pairs) by combined stableford, sum by team → 4/2.5/1.5/1
  //  Bonus per team:
  //    NTP:   each NTP win by a team member → +0.5 per win
  //    Bingo: front 9 complete → +1, back 9 complete → +1, both → extra +0.5

  const TOUR_PTS_TEAM    = [5, 3, 1.5];
  const TOUR_PTS_SINGLES = [4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5];
  const TOUR_PTS_PAIRS   = [4, 2.5, 1.5, 1];

  // Return { tid → tourPts } for one day
  function tourPointsForDay(dayKey) {
    const format    = _schedule[dayKey]?.format || 'singles';
    const dayScores = _allScores[dayKey] || {};
    const result    = {};
    Object.keys(_teams).forEach(tid => { result[tid] = 0; });

    if (format === 'team') {
      // Rank teams by their stableford aggregate — only award if at least one team has scored
      const ranked = Object.entries(_teams)
        .map(([tid, team]) => ({ tid, pts: teamDayScore(team, dayKey) }))
        .sort((a, b) => b.pts - a.pts);
      if (ranked.some(e => e.pts > 0)) {
        ranked.forEach((entry, idx) => {
          result[entry.tid] = (result[entry.tid] || 0) + (TOUR_PTS_TEAM[idx] || 0);
        });
      }

    } else if (format === 'singles') {
      // Rank all players individually with countback; award tour pts then credit their team
      const { pars, sis } = dayParsAndSIs(dayKey);
      const ranked = Object.entries(_players)
        .map(([pid, p]) => {
          const sc = dayScores[pid] || {};
          const total = sc.stableford || 0;
          const scores = Array.from({length: 18}, (_, i) => sc[`h${i+1}`] || 0);
          const holePts = Scoring.holePoints(scores, pars, sis, _players[pid]?.handicap || 0);
          return { pid, total, holePts };
        })
        .filter(e => e.total > 0)
        .sort((a, b) => Scoring.countbackSort(a, b));
      ranked.forEach((entry, idx) => {
        const team = playerTeam(entry.pid);
        if (team) result[team.tid] = (result[team.tid] || 0) + (TOUR_PTS_SINGLES[idx] || 0);
      });

    } else if (format === 'pairs') {
      // Build pairs from schedule groupings (consecutive within each group).
      // Then rank all pairs globally and credit their shared team.
      const playerTidMap = {};
      Object.entries(_teams).forEach(([tid, team]) => {
        (team.playerIds || []).forEach(pid => { playerTidMap[pid] = tid; });
      });
      const pairs = [];
      dayPairs(dayKey).forEach(([p1, p2]) => {
        const tid = playerTidMap[p1];
        if (!tid || playerTidMap[p2] !== tid) return; // cross-team pair (shouldn't happen)
        const { pars, sis } = dayParsAndSIs(dayKey);
        let pts = 0;
        for (let hole = 1; hole <= 18; hole++) {
          const i = hole - 1;
          const g1 = dayScores[p1]?.[`h${hole}`] || 0;
          const g2 = dayScores[p2]?.[`h${hole}`] || 0;
          const s1 = g1 ? Scoring.stablefordPoints(g1, pars[i], Scoring.shotsOnHole(effectiveHcp(p1, dayKey), sis[i])) : 0;
          const s2 = g2 ? Scoring.stablefordPoints(g2, pars[i], Scoring.shotsOnHole(effectiveHcp(p2, dayKey), sis[i])) : 0;
          pts += Math.max(s1, s2);
        }
        if (pts > 0) pairs.push({ tid, pts });
      });
      pairs.sort((a, b) => b.pts - a.pts);
      pairs.forEach((pair, idx) => {
        result[pair.tid] = (result[pair.tid] || 0) + (TOUR_PTS_PAIRS[idx] || 0);
      });
    }

    return result;
  }

  // NTP bonus: +0.5 per win per team, across all days
  function tourNTPBonus() {
    const bonus = {};
    Object.keys(_teams).forEach(tid => { bonus[tid] = 0; });
    Object.values(_ntp).forEach(dayNTP => {
      Object.values(dayNTP).forEach(win => {
        if (!win?.winnerId) return;
        const team = playerTeam(win.winnerId);
        if (team) bonus[team.tid] = (bonus[team.tid] || 0) + 0.5;
      });
    });
    return bonus;
  }

  // Matchplay bonus: +1 per match win, +0.5 per draw, across all days
  function tourMatchplayBonus() {
    const bonus = {};
    Object.keys(_teams).forEach(tid => { bonus[tid] = 0; });

    const teamEntries = Object.entries(_teams);
    for (let d = 1; d <= DAYS; d++) {
      const dayKey = `day${d}`;
      const { pars, sis } = dayParsAndSIs(dayKey);
      for (let i = 0; i < teamEntries.length; i++) {
        for (let j = i + 1; j < teamEntries.length; j++) {
          const [tidA, teamA] = teamEntries[i];
          const [tidB, teamB] = teamEntries[j];
          const res = matchResult(teamA.playerIds || [], teamB.playerIds || [], dayKey, pars, sis);
          if (res.won + res.halved + res.lost === 0) continue; // no scores
          if (res.holesUp > 0) {
            bonus[tidA] += 1;
          } else if (res.holesUp < 0) {
            bonus[tidB] += 1;
          } else {
            bonus[tidA] += 0.5;
            bonus[tidB] += 0.5;
          }
        }
      }
    }
    return bonus;
  }

  // Bingo bonus: +1 front9, +1 back9, +0.5 if both
  function tourBingoBonus() {
    const bonus = {};
    Object.keys(_teams).forEach(tid => { bonus[tid] = 0; });

    // Recompute net birdies per team (same logic as renderBingo)
    const netBirdies = {};
    Object.keys(_players).forEach(pid => { netBirdies[pid] = {}; });
    for (let d = 1; d <= DAYS; d++) {
      const dayKey = `day${d}`;
      const dayScores = _allScores[dayKey] || {};
      const { pars, sis } = dayParsAndSIs(dayKey);
      Object.entries(dayScores).forEach(([pid, sc]) => {
        if (!netBirdies[pid]) netBirdies[pid] = {};
        for (let h = 1; h <= 18; h++) {
          const gross = sc[`h${h}`] || 0;
          if (!gross) continue;
          const shots = Scoring.shotsOnHole(_players[pid]?.handicap || 0, sis[h - 1]);
          if ((gross - shots) <= pars[h - 1] - 1) netBirdies[pid][h] = true;
        }
      });
    }

    Object.entries(_teams).forEach(([tid, team]) => {
      const ids = team.playerIds || [];
      const holeHit = Array.from({length: 18}, (_, i) => ids.some(pid => netBirdies[pid]?.[i + 1]));
      const front9  = holeHit.slice(0, 9).every(Boolean);
      const back9   = holeHit.slice(9).every(Boolean);
      bonus[tid] = (front9 ? 1 : 0) + (back9 ? 1 : 0) + (front9 && back9 ? 0.5 : 0);
    });
    return bonus;
  }

  function renderTour() {
    const el = document.getElementById('sb-tour');
    if (!el) return;

    const teamEntries = Object.entries(_teams);
    if (teamEntries.length === 0) {
      el.innerHTML = '<p class="center-msg">No teams configured yet.</p>';
      return;
    }

    // Build per-day points for each team
    const dayPts = {}; // { tid: { day1: n, day2: n, … } }
    teamEntries.forEach(([tid]) => { dayPts[tid] = {}; });
    for (let d = 1; d <= DAYS; d++) {
      const dayKey = `day${d}`;
      const dayResult = tourPointsForDay(dayKey);
      teamEntries.forEach(([tid]) => {
        dayPts[tid][dayKey] = dayResult[tid] || 0;
      });
    }

    const ntpBonus       = tourNTPBonus();
    const bingoBonus     = tourBingoBonus();
    const matchplayBonus = tourMatchplayBonus();

    // Final standings
    const standings = teamEntries.map(([tid, team]) => {
      const dayTotal  = Object.values(dayPts[tid]).reduce((s, v) => s + v, 0);
      const ntp       = ntpBonus[tid]       || 0;
      const bingo     = bingoBonus[tid]     || 0;
      const matchplay = matchplayBonus[tid] || 0;
      return {
        tid,
        name:    team.name,
        color:   team.color,
        members: (team.playerIds || []).slice()
          .sort((a, b) => (_players[a]?.handicap ?? 99) - (_players[b]?.handicap ?? 99))
          .map(pid => firstName(_players[pid]?.name)).filter(Boolean),
        dayPts:  dayPts[tid],
        ntp,
        bingo,
        matchplay,
        total:   +(dayTotal + ntp + bingo + matchplay).toFixed(1)
      };
    }).sort((a, b) => b.total - a.total);

    // Day header columns — clean D1…D5 only
    const dayHeaders = Array.from({length: DAYS}, (_, i) =>
      `<th class="sb-tour-day-th">D${i + 1}</th>`
    ).join('');

    const rows = standings.map((t, idx) => {
      const dayTds = Array.from({length: DAYS}, (_, i) => {
        const dk  = `day${i + 1}`;
        const pts = t.dayPts[dk];
        const hasScores = Object.keys(_teams).some(tid2 =>
          (_teams[tid2].playerIds || []).some(pid => (_allScores[dk] || {})[pid]?.stableford != null)
        );
        const display = (hasScores && pts > 0) ? pts : '<span class="text-muted">—</span>';
        return `<td class="sb-tour-day-td">${display}</td>`;
      }).join('');

      const bonusTotal = +(t.ntp + t.bingo + t.matchplay).toFixed(1);

      return `<tr class="team-score-row">
        <td><span class="pos-badge pos-${idx < 3 ? idx + 1 : 'n'}">${idx + 1}</span></td>
        <td>
          <span class="team-color-dot" style="background:${t.color}"></span>
          <strong>${t.name}</strong>
        </td>
        ${dayTds}
        <td class="sb-tour-day-td" style="color:#57606a">${bonusTotal > 0 ? '+' + bonusTotal : '<span class="text-muted">—</span>'}</td>
        <td class="sb-tour-day-td" style="font-weight:700;color:#1a5c2a;font-size:1.05rem">${t.total > 0 ? t.total : '<span class="text-muted">—</span>'}</td>
      </tr>`;
    }).join('');

    // Team legend — colour dot · name · players
    const legendRows = standings.map(t => `
      <div style="display:flex;align-items:baseline;gap:8px;padding:4px 0;font-size:0.8rem">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${t.color};flex-shrink:0;margin-top:2px"></span>
        <span style="font-weight:700;min-width:48px">${t.name}</span>
        <span style="color:#57606a">${t.members.join(', ')}</span>
      </div>`).join('');

    // Scoring key
    const keyHtml = `
      <div style="margin-top:14px;padding:10px 12px;background:#f7f8fa;border:1px solid #e5e7eb;border-radius:8px;font-size:0.78rem;line-height:1.9">
        <div style="font-weight:700;color:#1a2332;margin-bottom:6px">👥 Teams</div>
        ${legendRows}
        <div style="font-weight:700;color:#1a2332;margin:10px 0 4px">📊 Scoring Key</div>
        <div><span style="display:inline-block;min-width:110px;font-weight:600">Team day:</span> 1st 5pts · 2nd 3pts · 3rd 1.5pts</div>
        <div><span style="display:inline-block;min-width:110px;font-weight:600">Singles:</span> 4 · 3.5 · 3 · 2.5 · 2 · 1.5 · 1 · 0.5</div>
        <div><span style="display:inline-block;min-width:110px;font-weight:600">Pairs:</span> 4 · 2.5 · 1.5 · 1</div>
        <div><span style="display:inline-block;min-width:110px;font-weight:600">Bonus:</span> NTP +0.5/win · Bingo F9/B9 +1 · Matchplay W+1 D+0.5</div>
      </div>`;

    el.innerHTML = `
      <div class="card sb-tour-card">
        <table class="scoreboard-table sb-tour-table">
          <thead><tr>
            <th class="sb-tour-pos-th">#</th>
            <th>Team</th>
            ${dayHeaders}
            <th class="sb-tour-day-th">Bonus</th>
            <th class="sb-tour-day-th">Total</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${keyHtml}`;
  }

  // ── Teams tab ─────────────────────────────────────────────
  function renderTeams() {
    const el = document.getElementById('sb-teams');
    if (!el) return;

    const teamEntries = Object.entries(_teams);
    if (teamEntries.length === 0) {
      el.innerHTML = '<p class="center-msg">No teams yet.</p>';
      return;
    }

    const teamStandings = teamEntries.map(([tid, team]) => {
      let total = 0;
      const dayPts = {};
      for (let d = 1; d <= DAYS; d++) {
        const dayKey = `day${d}`;
        const pts    = teamDayScore(team, dayKey);
        const hasAny = (team.playerIds || []).some(pid => (_allScores[dayKey] || {})[pid]?.stableford != null);
        dayPts[dayKey] = hasAny ? pts : null;
        total += pts;
      }
      return { tid, name: team.name, color: team.color, total, dayPts,
               members: (team.playerIds || []).slice()
                 .sort((a, b) => (_players[a]?.handicap ?? 99) - (_players[b]?.handicap ?? 99))
                 .map(pid => firstName(_players[pid]?.name)).filter(Boolean) };
    }).sort((a, b) => b.total - a.total);

    const dayHeaders = Array.from({length: DAYS}, (_, i) => {
      const day = _schedule[`day${i+1}`];
      return `<th style="text-align:right;font-size:0.75rem">D${i+1}<br><span style="font-weight:400;opacity:0.8">${FORMAT_SHORT[day?.format]||''}</span></th>`;
    }).join('');

    const rows = teamStandings.map((t, idx) => {
      const dayTds = Array.from({length: DAYS}, (_, i) => {
        const pts = t.dayPts[`day${i+1}`];
        return `<td style="text-align:right">${pts !== null ? pts : '<span class="text-muted">—</span>'}</td>`;
      }).join('');
      return `<tr class="team-score-row">
        <td><span class="pos-badge pos-${idx < 3 ? idx+1 : 'n'}">${idx+1}</span></td>
        <td>
          <span class="team-color-dot" style="background:${t.color}"></span>
          <strong>${t.name}</strong><br>
          <span class="text-muted" style="font-size:0.72rem;font-weight:400">${t.members.join(', ')}</span>
        </td>
        ${dayTds}
        <td style="text-align:right;font-weight:700;color:#1a5c2a;font-size:1rem">${t.total}</td>
      </tr>`;
    }).join('');

    el.innerHTML = `<div class="card" style="overflow-x:auto">
      <table class="scoreboard-table">
        <thead><tr>
          <th style="width:36px">#</th><th>Team</th>${dayHeaders}
          <th style="text-align:right">Total</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  // ── Individual tab ────────────────────────────────────────
  function renderIndividual() {
    const el = document.getElementById('sb-individual');
    if (!el) return;

    // For overall standings we sort by total; ties are broken by the most recent day's countback
    const standings = Object.entries(_players).map(([pid, p]) => {
      let total = 0;
      const dayPts = {};
      // Track per-day holePts arrays for countback on last scored day
      const dayHolePts = {};
      for (let d = 1; d <= DAYS; d++) {
        const dayKey       = `day${d}`;
        const sc           = (_allScores[dayKey] || {})[pid];
        const pts          = sc?.stableford ?? null;
        dayPts[dayKey]     = pts;
        total             += pts || 0;
        if (pts) {
          const { pars, sis } = dayParsAndSIs(dayKey);
          const scores = Array.from({length: 18}, (_, i) => sc[`h${i+1}`] || 0);
          dayHolePts[dayKey] = Scoring.holePoints(scores, pars, sis, p.handicap || 0);
        }
      }
      // Use the last day with scores as the countback reference
      let holePts = null;
      for (let d = DAYS; d >= 1; d--) {
        if (dayHolePts[`day${d}`]) { holePts = dayHolePts[`day${d}`]; break; }
      }
      const team = playerTeam(pid);
      return { pid, name: firstName(p.name), handicap: p.handicap, total, dayPts, holePts,
               teamName: team?.name, teamColor: team?.color };
    }).sort((a, b) => Scoring.countbackSort(a, b));

    if (standings.length === 0) {
      el.innerHTML = '<p class="center-msg">No scores yet.</p>';
      return;
    }

    const dayHeaders = Array.from({length: DAYS}, (_, i) =>
      `<th class="ind-day-th">D${i + 1}</th>`
    ).join('');

    const rows = standings.map((s, idx) => {
      // Determine tied position
      const prevSame = idx > 0 && standings[idx - 1].total === s.total &&
                       Scoring.countbackCompare(standings[idx - 1].holePts || [], s.holePts || []) === 0;
      const nextSame = idx < standings.length - 1 && standings[idx + 1].total === s.total &&
                       Scoring.countbackCompare(s.holePts || [], standings[idx + 1].holePts || []) === 0;
      const isTied   = prevSame || nextSame;
      let pos = idx + 1;
      if (isTied) {
        let g = idx;
        while (g > 0 && standings[g - 1].total === s.total &&
               Scoring.countbackCompare(standings[g - 1].holePts || [], s.holePts || []) === 0) g--;
        pos = g + 1;
      }
      const posLabel = isTied ? `T${pos}` : `${pos}`;
      const posCls   = !isTied && pos <= 3 ? pos : 'n';
      const dayTds = Array.from({length: DAYS}, (_, i) => {
        const pts = s.dayPts[`day${i+1}`];
        return `<td class="ind-day-td">${(pts !== null && pts > 0) ? pts : '<span class="text-muted">—</span>'}</td>`;
      }).join('');
      const dot = s.teamColor ? `<span class="team-color-dot" style="background:${s.teamColor}"></span>` : '';
      return `<tr>
        <td><span class="pos-badge pos-${posCls}" style="${isTied ? 'font-size:0.65rem;' : ''}">${posLabel}</span></td>
        <td>${dot}${s.name}<br><span class="text-muted" style="font-size:0.72rem">HCP ${s.handicap??'?'}</span></td>
        ${dayTds}
        <td class="ind-total-td">${s.total}</td>
      </tr>`;
    }).join('');

    el.innerHTML = `<div class="card" style="overflow-x:auto">
      <table class="scoreboard-table">
        <thead><tr>
          <th style="width:36px">#</th>
          <th>Player</th>
          ${dayHeaders}
          <th class="ind-total-th">Total</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  // ── Birdie Bingo tab ──────────────────────────────────────
  // Per team, 18-hole heatmap. Net birdie or better = ✓
  // Bonus: +1 for full front 9, +1 for full back 9, +1 for all 18
  function renderBingo() {
    const el = document.getElementById('sb-bingo');
    if (!el) return;

    const teamEntries = Object.entries(_teams);
    if (teamEntries.length === 0) {
      el.innerHTML = '<p class="center-msg">No teams yet.</p>';
      return;
    }

    // Accumulate net birdies across ALL days for each player
    // netBirdies[pid][hole] = true if ANY day has a net birdie or better on that hole
    const netBirdies = {};
    Object.keys(_players).forEach(pid => { netBirdies[pid] = {}; });

    for (let d = 1; d <= DAYS; d++) {
      const dayKey       = `day${d}`;
      const dayScores    = _allScores[dayKey] || {};
      const { pars, sis } = dayParsAndSIs(dayKey);

      Object.entries(dayScores).forEach(([pid, sc]) => {
        if (!netBirdies[pid]) netBirdies[pid] = {};
        for (let h = 1; h <= 18; h++) {
          const gross = sc[`h${h}`] || 0;
          if (!gross) continue;
          const hcp   = _players[pid]?.handicap || 0;
          const shots = Scoring.shotsOnHole(hcp, sis[h - 1]);
          const net   = gross - shots;
          if (net <= pars[h - 1] - 1) {          // net birdie or better
            netBirdies[pid][h] = true;
          }
        }
      });
    }

    // Compute per-team data
    const teamData = teamEntries.map(([tid, team]) => {
      const memberIds = team.playerIds || [];
      const holeHit   = Array.from({length: 18}, (_, i) =>
        memberIds.some(pid => netBirdies[pid]?.[i + 1])
      );
      const front9Hit  = holeHit.slice(0, 9).filter(Boolean).length;
      const back9Hit   = holeHit.slice(9).filter(Boolean).length;
      const totalHit   = holeHit.filter(Boolean).length;
      const bonusFront = front9Hit === 9 ? 1 : 0;
      const bonusBack  = back9Hit  === 9 ? 1 : 0;
      const bonusFull  = totalHit  === 18 ? 1 : 0;
      const bonusTotal = bonusFront + bonusBack + bonusFull;
      return { team, holeHit, front9Hit, back9Hit, totalHit, bonusFront, bonusBack, bonusFull, bonusTotal,
               grandTotal: totalHit + bonusTotal };
    });

    // ── Vertical card per team ───────────────────────────────
    const teamCards = teamData.map(({ team, holeHit, front9Hit, back9Hit, totalHit, bonusFront, bonusBack, bonusFull, bonusTotal, grandTotal }) => {
      const makeChips = (startIdx) => Array.from({length: 9}, (_, i) => {
        const hi       = startIdx + i;
        const hit      = holeHit[hi];
        const isFront  = hi < 9;
        const lineComplete = isFront ? bonusFront : bonusBack;
        let cls = 'bb-chip-empty';
        if (hit) {
          if (bonusFull)       cls = 'bb-chip-green';
          else if (lineComplete) cls = 'bb-chip-amber';
          else                 cls = 'bb-chip-blue';
        }
        return `<div class="bb-chip ${cls}">${hi + 1}${hit ? '<span class="bb-tick">✓</span>' : ''}</div>`;
      }).join('');

      const bonusPills = [
        { label: 'Front 9', done: bonusFront },
        { label: 'Back 9',  done: bonusBack  },
        { label: 'Full 18', done: bonusFull  },
      ].map(b => `<span class="bb-bonus-pill ${b.done ? 'bb-bonus-hit' : 'bb-bonus-miss'}">${b.label} +1</span>`).join('');

      return `<div class="card bb-team-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${team.color};flex-shrink:0"></span>
            <span style="font-weight:700;font-size:1rem">${team.name}</span>
          </div>
          <span style="font-size:1.5rem;font-weight:900;color:#1a5c2a">${grandTotal}</span>
        </div>
        <div class="bb-half-label">FRONT 9 — ${front9Hit}/9</div>
        <div class="bb-chip-row">${makeChips(0)}</div>
        <div class="bb-half-label" style="margin-top:8px">BACK 9 — ${back9Hit}/9</div>
        <div class="bb-chip-row">${makeChips(9)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">${bonusPills}</div>
        <div style="margin-top:8px;font-size:0.78rem;color:#57606a">
          Holes: <strong>${totalHit}</strong> &nbsp;·&nbsp; Bonus: <strong>+${bonusTotal}</strong> &nbsp;·&nbsp; Total: <strong style="color:#1a5c2a">${grandTotal}</strong>
        </div>
      </div>`;
    }).join('');

    // ── Per-player birdie (3pt) and eagle (4pt) counts ────────
    const hiBirdies = {}; // { pid: { birdies: n, eagles: n } }
    Object.keys(_players).forEach(pid => { hiBirdies[pid] = { birdies: 0, eagles: 0 }; });

    for (let d = 1; d <= DAYS; d++) {
      const dayKey        = `day${d}`;
      const dayScores     = _allScores[dayKey] || {};
      const { pars, sis } = dayParsAndSIs(dayKey);
      Object.entries(dayScores).forEach(([pid, sc]) => {
        if (!hiBirdies[pid]) hiBirdies[pid] = { birdies: 0, eagles: 0 };
        for (let h = 1; h <= 18; h++) {
          const gross = sc[`h${h}`] || 0;
          if (!gross) continue;
          const shots = Scoring.shotsOnHole(_players[pid]?.handicap || 0, sis[h - 1]);
          const pts   = Scoring.stablefordPoints(gross, pars[h - 1], shots);
          if (pts === 4) hiBirdies[pid].eagles++;
          else if (pts === 3) hiBirdies[pid].birdies++;
        }
      });
    }

    const hiList = Object.entries(_players)
      .map(([pid, p]) => {
        const { birdies, eagles } = hiBirdies[pid] || { birdies: 0, eagles: 0 };
        const team = playerTeam(pid);
        return { name: firstName(p.name), birdies, eagles, total: birdies + eagles, teamColor: team?.color };
      })
      .filter(p => p.total > 0)
      .sort((a, b) => b.total - a.total || b.eagles - a.eagles);

    const hiRows = hiList.map((p, idx) => {
      const dot = p.teamColor
        ? `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${p.teamColor};margin-right:6px;vertical-align:middle;flex-shrink:0"></span>`
        : '';
      const eaglePips = p.eagles > 0
        ? Array(p.eagles).fill(`<span style="display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;border-radius:50%;background:#e65100;color:#fff;font-size:0.7rem;font-weight:700;margin:1px">E</span>`).join('')
        : `<span class="text-muted">—</span>`;
      const birdiePips = p.birdies > 0
        ? Array(p.birdies).fill(`<span style="display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;border-radius:50%;background:#1565c0;color:#fff;font-size:0.7rem;font-weight:700;margin:1px">B</span>`).join('')
        : `<span class="text-muted">—</span>`;
      return `<tr>
        <td style="padding:8px 10px;width:32px"><span class="pos-badge pos-${idx<3?idx+1:'n'}">${idx+1}</span></td>
        <td style="padding:8px 10px">${dot}<strong>${p.name}</strong></td>
        <td style="padding:8px 10px;text-align:center">${eaglePips}</td>
        <td style="padding:8px 10px;text-align:center">${birdiePips}</td>
        <td style="padding:8px 10px;text-align:right;font-weight:700;font-size:0.95rem">${p.total}</td>
      </tr>`;
    }).join('');

    el.innerHTML = `
      ${teamCards}
      ${hiList.length > 0 ? `
      <div class="card">
        <div class="card-header" style="margin-bottom:12px">
          <span class="card-title">🏅 Birdies &amp; Eagles</span>
          <span class="text-muted" style="font-size:0.75rem">All rounds · net score</span>
        </div>
        <table class="scoreboard-table">
          <thead><tr>
            <th style="width:36px">#</th>
            <th>Player</th>
            <th style="text-align:center;width:30%">
              <span style="display:inline-block;width:16px;height:16px;line-height:16px;border-radius:50%;background:#e65100;color:#fff;font-size:0.65rem;font-weight:700;vertical-align:middle;margin-right:4px">E</span>
              Eagles (4 pts)
            </th>
            <th style="text-align:center;width:30%">
              <span style="display:inline-block;width:16px;height:16px;line-height:16px;border-radius:50%;background:#1565c0;color:#fff;font-size:0.65rem;font-weight:700;vertical-align:middle;margin-right:4px">B</span>
              Birdies (3 pts)
            </th>
            <th style="text-align:right">Total</th>
          </tr></thead>
          <tbody>${hiRows}</tbody>
        </table>
      </div>` : ''}`;
  }

  // ── Nearest the Pin tab ──────────────────────────────────
  function renderNTP() {
    const el = document.getElementById('sb-ntp');
    if (!el) return;

    // Build one card per day. For each day, find the par 3 holes from the
    // assigned course (or defaults), then show winner picker (admin) or result.
    const dayCards = Array.from({length: DAYS}, (_, di) => {
      const dayNum  = di + 1;
      const dayKey  = `day${dayNum}`;
      const day     = _schedule[dayKey] || {};
      const { pars } = dayParsAndSIs(dayKey);

      // Find which hole numbers are par 3s
      const par3Holes = pars.map((p, i) => p === 3 ? i + 1 : null).filter(Boolean);

      if (par3Holes.length === 0) {
        return `<div class="card">
          <div class="card-header" style="margin-bottom:6px">
            <div style="display:flex;gap:8px;align-items:center">
              <span class="day-badge">Day ${dayNum}</span>
              <span style="font-weight:600">${day.label || `Day ${dayNum}`}</span>
            </div>
          </div>
          <p class="text-muted">No par 3s on this course.</p>
        </div>`;
      }

      const courseId = day.courseId;
      const course   = courseId ? _courses[courseId] : null;
      const dayNTP   = _ntp[dayKey] || {};

      const rows = par3Holes.map(h => {
        const winner = dayNTP[h];
        const playerOptions = Object.entries(_players)
          .map(([pid, p]) => `<option value="${pid}"${winner?.winnerId === pid ? ' selected' : ''}>${firstName(p.name)}</option>`)
          .join('');

        return `<tr>
          <td style="padding:8px 10px;font-weight:600">Hole ${h}</td>
          <td style="padding:8px 10px;color:#57606a;font-size:0.82rem">Par 3 · SI ${pars ? (Scoring.defaultSIs()[h-1]) : '—'}</td>
          <td style="padding:8px 10px;text-align:right">
            <select class="ntp-select" data-hole="${h}"
                style="padding:6px 10px;border-radius:6px;border:1.5px solid #d0d7de;font-size:0.85rem">
              <option value="">— No winner yet —</option>
              ${playerOptions}
            </select>
          </td>
        </tr>`;
      }).join('');

      return `<div class="card" id="ntp-card-${dayKey}">
        <div class="card-header" style="margin-bottom:10px">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span class="day-badge">Day ${dayNum}</span>
            <span style="font-weight:600">${day.label || `Day ${dayNum}`}</span>
            ${course ? `<span class="tag" style="background:#e8f5e9;color:#2e7d32">⛳ ${course.name}</span>` : ''}
          </div>
          <span class="tag">${par3Holes.length} par 3${par3Holes.length !== 1 ? 's' : ''}</span>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#f7f8fa;font-size:0.78rem;color:#57606a">
              <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #eee">Hole</th>
              <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #eee">Info</th>
              <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #eee">Nearest the Pin</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="text-align:right;margin-top:12px">
          <button class="btn btn-primary" onclick="ScoreboardPage.saveNTPDay('${dayKey}')">💾 Save</button>
        </div>
      </div>`;
    }).join('');

    el.innerHTML = dayCards;
  }

  // ── Save NTP winners for a whole day card ────────────────
  async function saveNTPDay(dayKey) {
    const card = document.getElementById(`ntp-card-${dayKey}`);
    if (!card) return;
    const selects = card.querySelectorAll('.ntp-select');
    const saves = [];
    selects.forEach(sel => {
      const hole = parseInt(sel.dataset.hole, 10);
      const pid  = sel.value;
      if (pid) {
        const name = firstName(_players[pid]?.name) || pid;
        saves.push(DB.set(`ntp/${dayKey}/${hole}`, { winnerId: pid, winnerName: name }));
      } else {
        saves.push(DB.remove(`ntp/${dayKey}/${hole}`));
      }
    });
    await Promise.all(saves);
    App.toast(`NTP Day ${dayKey.replace('day', '')} saved ✓`);
  }

  // ── Save single NTP winner (kept for backwards compat) ───
  async function saveNTP(dayKey, hole, pid) {
    if (!pid) {
      await DB.remove(`ntp/${dayKey}/${hole}`);
      return;
    }
    const name = firstName(_players[pid]?.name) || pid;
    await DB.set(`ntp/${dayKey}/${hole}`, { winnerId: pid, winnerName: name });
    App.toast(`NTP Day ${dayKey.replace('day','')} Hole ${hole}: ${name} ✓`);
  }

  // ── Team Matchplay tab ────────────────────────────────────
  //
  //  Each team plays every other team across all 18 holes, per day.
  //  A team wins a hole if their best individual stableford on that hole
  //  is strictly greater than the opponent's best. Equal = halved.
  //  Results accumulate across all 5 days.
  //  Display: head-to-head match cards per day + overall standings table.

  // Returns best stableford on a hole for a team from that day's scores
  function teamBestOnHole(memberIds, dayKey, hole, pars, sis) {
    const dayScores = _allScores[dayKey] || {};
    let best = 0;
    memberIds.forEach(pid => {
      const gross = dayScores[pid]?.[`h${hole}`] || 0;
      if (!gross) return;
      const shots = Scoring.shotsOnHole(_players[pid]?.handicap || 0, sis[hole - 1]);
      const pts   = Scoring.stablefordPoints(gross, pars[hole - 1], shots);
      if (pts > best) best = pts;
    });
    return best;
  }

  // Returns { won, halved, lost, holesUp } for teamA vs teamB on a given day
  function matchResult(teamAIds, teamBIds, dayKey, pars, sis) {
    let won = 0, halved = 0, lost = 0;
    for (let h = 1; h <= 18; h++) {
      const a = teamBestOnHole(teamAIds, dayKey, h, pars, sis);
      const b = teamBestOnHole(teamBIds, dayKey, h, pars, sis);
      if (a === 0 && b === 0) continue; // no scores for either — skip hole
      if (a > b)      won++;
      else if (a < b) lost++;
      else            halved++;
    }
    return { won, halved, lost, holesUp: won - lost };
  }

  function renderMatchplay() {
    const el = document.getElementById('sb-matchplay');
    if (!el) return;

    const teamEntries = Object.entries(_teams);
    if (teamEntries.length < 2) {
      el.innerHTML = '<p class="center-msg">Need at least 2 teams for matchplay.</p>';
      return;
    }

    // Build all unique pairs
    const pairs = [];
    for (let i = 0; i < teamEntries.length; i++) {
      for (let j = i + 1; j < teamEntries.length; j++) {
        pairs.push([teamEntries[i], teamEntries[j]]);
      }
    }

    // Per-day match cards
    const dayBlocks = Array.from({length: DAYS}, (_, di) => {
      const dayNum = di + 1;
      const dayKey = `day${dayNum}`;
      const day    = _schedule[dayKey] || {};
      const { pars, sis } = dayParsAndSIs(dayKey);

      // Check any scores exist this day
      const hasScores = teamEntries.some(([, team]) =>
        (team.playerIds || []).some(pid => (_allScores[dayKey] || {})[pid]?.stableford != null)
      );

      const matchCards = pairs.map(([[tidA, teamA], [tidB, teamB]]) => {
        // Build per-hole data
        const holes = Array.from({length: 18}, (_, i) => {
          const h = i + 1;
          const a = teamBestOnHole(teamA.playerIds || [], dayKey, h, pars, sis);
          const b = teamBestOnHole(teamB.playerIds || [], dayKey, h, pars, sis);
          const hasAny = !(a === 0 && b === 0);
          let holeResult = 'none'; // 'a' | 'b' | 'half' | 'none'
          if (hasAny) {
            if (a > b)      holeResult = 'a';
            else if (b > a) holeResult = 'b';
            else            holeResult = 'half';
          }
          return { h, a, b, holeResult, par: pars[i] };
        });

        const holesPlayed = holes.filter(x => x.holeResult !== 'none').length;

        // Determine overall result
        const won  = holes.filter(x => x.holeResult === 'a').length;
        const lost = holes.filter(x => x.holeResult === 'b').length;
        const half = holes.filter(x => x.holeResult === 'half').length;
        const holesUp = won - lost;

        let resultLabel, aWins, bWins;
        if (!hasScores || holesPlayed === 0) {
          resultLabel = 'Not played';
          aWins = false; bWins = false;
        } else if (holesUp > 0) {
          resultLabel = `${teamA.name} wins ${holesUp} up`;
          aWins = true; bWins = false;
        } else if (holesUp < 0) {
          resultLabel = `${teamB.name} wins ${Math.abs(holesUp)} up`;
          aWins = false; bWins = true;
        } else {
          resultLabel = 'Match tied';
          aWins = false; bWins = false;
        }

        // Cell style helpers
        const CELL  = 'padding:0;text-align:center;font-size:0.75rem;border:1px solid #e5e7eb;height:28px;vertical-align:middle';
        const LABEL = 'padding:4px 8px;font-size:0.78rem;white-space:nowrap;border:1px solid #e5e7eb;font-weight:600;width:1%';
        const HDRCELL = `${CELL};background:#f7f8fa;color:#57606a;font-weight:600;font-size:0.7rem`;

        // Hole header row
        const hdrCells = holes.map(({h}) =>
          `<td style="${HDRCELL}">${h}</td>`
        ).join('');

        // Team A score row — highlighted green if they won that hole, grey if halved
        const aScoreCells = holes.map(({a, holeResult}) => {
          let bg = '';
          if (holeResult === 'a')    bg = 'background:#d4edda;font-weight:700;color:#155724';
          else if (holeResult === 'half') bg = 'background:#e8eaf6;color:#3949ab';
          else if (holeResult === 'b')    bg = 'background:#fff;color:#999';
          const val = (hasScores && a > 0) ? a : '-';
          return `<td style="${CELL};${bg}">${val}</td>`;
        }).join('');

        // Team B score row
        const bScoreCells = holes.map(({b, holeResult}) => {
          let bg = '';
          if (holeResult === 'b')    bg = 'background:#d4edda;font-weight:700;color:#155724';
          else if (holeResult === 'half') bg = 'background:#e8eaf6;color:#3949ab';
          else if (holeResult === 'a')    bg = 'background:#fff;color:#999';
          const val = (hasScores && b > 0) ? b : '-';
          return `<td style="${CELL};${bg}">${val}</td>`;
        }).join('');

        // Running "holes up" indicator row — uses each team's own colour so it's
        // immediately clear which team is leading at every point in the match.
        let running = 0;
        const runCells = holes.map(({holeResult}) => {
          if (holeResult === 'a')      running++;
          else if (holeResult === 'b') running--;
          if (holeResult === 'none') return `<td style="${CELL};color:#bbb">·</td>`;
          let txt, bg;
          if (running > 0) {
            // Team A is up — use Team A's colour as background
            txt = `+${running}`;
            bg  = `background:${teamA.color};color:#fff;font-weight:700`;
          } else if (running < 0) {
            // Team B is up — use Team B's colour as background
            txt = `${running}`;
            bg  = `background:${teamB.color};color:#fff;font-weight:700`;
          } else {
            txt = 'AS';
            bg  = `background:#e8eaf6;color:#3949ab`;
          }
          return `<td style="${CELL};font-size:0.68rem;${bg}">${txt}</td>`;
        }).join('');

        const aNameStyle = aWins ? 'font-weight:700;color:#1a5c2a' : 'color:#444';
        const bNameStyle = bWins ? 'font-weight:700;color:#1a5c2a' : 'color:#444';

        return `<div style="margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="width:10px;height:10px;border-radius:50%;background:${teamA.color};display:inline-block;flex-shrink:0"></span>
            <span style="${aNameStyle};font-size:0.88rem">${teamA.name}</span>
            <span style="color:#bbb;font-size:0.78rem;margin:0 4px">vs</span>
            <span style="width:10px;height:10px;border-radius:50%;background:${teamB.color};display:inline-block;flex-shrink:0"></span>
            <span style="${bNameStyle};font-size:0.88rem">${teamB.name}</span>
            <span style="margin-left:auto;font-size:0.78rem;color:#57606a;white-space:nowrap">${resultLabel}</span>
          </div>
          <table style="border-collapse:collapse;table-layout:fixed;width:100%">
            <colgroup>
              <col style="width:72px">
              ${Array(18).fill('<col>').join('')}
            </colgroup>
            <thead>
              <tr>
                <td style="${LABEL};background:#f7f8fa;color:#57606a;font-weight:400;font-size:0.72rem">Hole</td>
                ${hdrCells}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="${LABEL}">
                  <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${teamA.color};margin-right:4px;vertical-align:middle"></span>
                  ${teamA.name}
                </td>
                ${aScoreCells}
              </tr>
              <tr>
                <td style="${LABEL}">
                  <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${teamB.color};margin-right:4px;vertical-align:middle"></span>
                  ${teamB.name}
                </td>
                ${bScoreCells}
              </tr>
              <tr>
                <td style="${LABEL};background:#f7f8fa;color:#57606a;font-weight:400;font-size:0.72rem">Holes Up</td>
                ${runCells}
              </tr>
            </tbody>
          </table>
        </div>`;
      }).join('');

      return `<div class="card">
        <div class="card-header" style="margin-bottom:10px">
          <div style="display:flex;gap:8px;align-items:center">
            <span class="day-badge">Day ${dayNum}</span>
            <span style="font-weight:600">${day.label || `Day ${dayNum}`}</span>
          </div>
          <span class="format-badge format-${day.format}">${FORMAT_SHORT[day.format] || '—'}</span>
        </div>
        ${matchCards}
      </div>`;
    }).join('');

    // ── Overall standings ──────────────────────────────────
    // Sum W/H/L and holesUp across all days for every match pair per team
    const overall = {}; // { tid: { w, h, l, holesUp, matchPts } }
    teamEntries.forEach(([tid]) => { overall[tid] = { w: 0, h: 0, l: 0, holesUp: 0, matchPts: 0 }; });

    for (let d = 1; d <= DAYS; d++) {
      const dayKey = `day${d}`;
      const { pars, sis } = dayParsAndSIs(dayKey);
      pairs.forEach(([[tidA, teamA], [tidB, teamB]]) => {
        const res = matchResult(teamA.playerIds || [], teamB.playerIds || [], dayKey, pars, sis);
        if (res.won + res.halved + res.lost === 0) return; // no scores

        overall[tidA].holesUp += res.holesUp;
        overall[tidB].holesUp -= res.holesUp;

        if (res.holesUp > 0) {
          overall[tidA].w++;  overall[tidA].matchPts += 1;
          overall[tidB].l++;
        } else if (res.holesUp < 0) {
          overall[tidB].w++;  overall[tidB].matchPts += 1;
          overall[tidA].l++;
        } else {
          overall[tidA].h++;  overall[tidA].matchPts += 0.5;
          overall[tidB].h++;  overall[tidB].matchPts += 0.5;
        }
      });
    }

    const standingsRows = teamEntries
      .map(([tid, team]) => ({ tid, team, ...overall[tid] }))
      .sort((a, b) => b.matchPts - a.matchPts || b.holesUp - a.holesUp)
      .map((s, idx) => `<tr class="team-score-row">
        <td><span class="pos-badge pos-${idx < 3 ? idx + 1 : 'n'}">${idx + 1}</span></td>
        <td>
          <span class="team-color-dot" style="background:${s.team.color}"></span>
          <strong>${s.team.name}</strong>
        </td>
        <td style="text-align:center;color:#1a5c2a;font-weight:600">${s.w}</td>
        <td style="text-align:center;color:#57606a">${s.h}</td>
        <td style="text-align:center;color:#c0392b">${s.l}</td>
        <td style="text-align:center;color:#57606a">${s.holesUp > 0 ? '+' + s.holesUp : s.holesUp}</td>
        <td style="text-align:right;font-weight:700;color:#1a5c2a;font-size:1rem">${s.matchPts}</td>
      </tr>`).join('');

    el.innerHTML = `
      <div style="font-size:0.82rem;color:#57606a;margin-bottom:12px;padding:6px 10px;
            background:#f0f4ff;border-radius:6px;border:1px solid #c9d6f5">
        ⚔️ <strong>Team Matchplay</strong> — each team plays every other team across all 18 holes per day.
        A hole is won by the team with the best individual stableford score on that hole.
      </div>

      <div class="card" style="overflow-x:auto;margin-bottom:16px">
        <div class="card-title" style="margin-bottom:10px">Overall Standings</div>
        <table class="scoreboard-table">
          <thead><tr>
            <th style="width:36px">#</th>
            <th>Team</th>
            <th style="text-align:center">W</th>
            <th style="text-align:center">H</th>
            <th style="text-align:center">L</th>
            <th style="text-align:center">Holes Up</th>
            <th style="text-align:right">Pts</th>
          </tr></thead>
          <tbody>${standingsRows}</tbody>
        </table>
        <div style="font-size:0.75rem;color:#57606a;margin-top:8px">
          W=1pt · H=0.5pt · L=0pt · Holes Up used as tiebreaker
        </div>
      </div>

      <div class="card-title" style="margin-bottom:8px">Results by Day</div>
      ${dayBlocks}`;
  }

  // ── Daily tab ─────────────────────────────────────────────
  // ── Daily Results Focus tab ──────────────────────────────
  // Dropdown to select which day, then shows:
  //   • Teams in scoring zones (with their members' stableford points)
  //   • Nearest-the-pin winners for that day
  function renderDailyFocus() {
    const el = document.getElementById('sb-dailyfocus');
    if (!el) return;

    // Build day options
    const dayOptions = Array.from({length: DAYS}, (_, i) => {
      const dk  = `day${i + 1}`;
      const day = _schedule[dk];
      const lbl = day?.label || `Day ${i + 1}`;
      return `<option value="${dk}"${_dailyFocusDay === dk ? ' selected' : ''}>${lbl}</option>`;
    }).join('');

    const dayKey    = _dailyFocusDay;
    const day       = _schedule[dayKey] || {};
    const dayScores = _allScores[dayKey] || {};
    const fmt       = FORMAT_SHORT[day.format] || '—';
    const { pars, sis } = dayParsAndSIs(dayKey);
    const teamEntries   = Object.entries(_teams);

    // ── Scoring zone breakdown per team ─────────────────────
    // For each team, list their members' stableford pts ranked (with countback), then assign
    // a visual zone: 🥇 Top scorer, 🥈 2nd, 🥉 3rd, rest = normal
    const teamBlocks = teamEntries.map(([tid, team]) => {
      const members = (team.playerIds || []).map(pid => {
        const p      = _players[pid];
        const sc     = dayScores[pid] || {};
        const total  = sc.stableford ?? null;
        const scores = Array.from({length: 18}, (_, i) => sc[`h${i+1}`] || 0);
        const holePts = total ? Scoring.holePoints(scores, pars, sis, p?.handicap || 0) : null;
        return { name: firstName(p?.name) || pid, total, pts: total, holePts };
      }).filter(m => m.total !== null && m.total > 0).sort((a, b) => Scoring.countbackSort(a, b));

      if (members.length === 0) return '';

      // Team total uses the format-aware teamDayScore (sum for singles/pairs, best-ball for team)
      const teamTotal = teamDayScore(team, dayKey);

      // Label for what the total represents per format
      const fmt = day.format || 'singles';
      const totalLabel = fmt === 'team'
        ? 'Team score'
        : fmt === 'pairs'
          ? 'Pairs total'
          : 'Team total';

      const rows = members.map((m, idx) => {
        const zoneBadge = idx === 0
          ? `<span style="font-size:1rem">🥇</span>`
          : idx === 1
            ? `<span style="font-size:1rem">🥈</span>`
            : idx === 2
              ? `<span style="font-size:1rem">🥉</span>`
              : `<span class="pos-badge pos-n" style="width:20px;height:20px;font-size:0.7rem">${idx+1}</span>`;
        const ptColor = idx === 0 ? '#c8a800' : idx === 1 ? '#7c7c7c' : idx === 2 ? '#8b5e3c' : '#1a2332';
        return `<tr>
          <td style="padding:7px 10px;width:32px">${zoneBadge}</td>
          <td style="padding:7px 10px;font-weight:600">${m.name}</td>
          <td style="padding:7px 10px;text-align:right;font-weight:700;font-size:1rem;color:${ptColor}">${m.pts}</td>
        </tr>`;
      }).join('');

      const totalRow = `<tr style="border-top:2px solid #e5e7eb;background:#f7f8fa">
        <td style="padding:7px 10px"></td>
        <td style="padding:7px 10px;font-size:0.78rem;color:#57606a;font-weight:600">${totalLabel}</td>
        <td style="padding:7px 10px;text-align:right;font-weight:800;font-size:1.1rem;color:#1a5c2a">${teamTotal}</td>
      </tr>`;

      return `<div style="margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${team.color};flex-shrink:0"></span>
          <span style="font-weight:700;font-size:0.95rem">${team.name}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
          <tbody>${rows}${totalRow}</tbody>
        </table>
      </div>`;
    }).join('') || '<p class="text-muted">No scores recorded yet for this day.</p>';

    // ── Overall day ranking (all players) — with countback ──
    const allEntries = Object.entries(_players)
      .map(([pid, p]) => {
        const sc    = dayScores[pid] || {};
        const total = sc.stableford ?? null;
        const t     = playerTeam(pid);
        const scores = Array.from({length: 18}, (_, i) => sc[`h${i+1}`] || 0);
        const holePts = total ? Scoring.holePoints(scores, pars, sis, p.handicap || 0) : null;
        return { pid, name: firstName(p.name), total, holePts, teamColor: t?.color, teamName: t?.name };
      })
      .filter(e => e.total !== null && e.total > 0)
      .sort((a, b) => Scoring.countbackSort(a, b));

    const rankingRows = allEntries.map((e, idx) => {
      // Tied position logic
      const prevSame = idx > 0 && allEntries[idx - 1].total === e.total &&
                       Scoring.countbackCompare(allEntries[idx - 1].holePts || [], e.holePts || []) === 0;
      const nextSame = idx < allEntries.length - 1 && allEntries[idx + 1].total === e.total &&
                       Scoring.countbackCompare(e.holePts || [], allEntries[idx + 1].holePts || []) === 0;
      const isTied   = prevSame || nextSame;
      let pos = idx + 1;
      if (isTied) {
        let g = idx;
        while (g > 0 && allEntries[g - 1].total === e.total &&
               Scoring.countbackCompare(allEntries[g - 1].holePts || [], e.holePts || []) === 0) g--;
        pos = g + 1;
      }
      const posLabel = isTied ? `T${pos}` : `${pos}`;
      const posCls   = !isTied && pos <= 3 ? pos : 'n';
      const cbInfo   = isTied && e.holePts
        ? `<span class="text-muted" style="font-size:0.68rem;display:block;margin-top:1px">${Scoring.countbackLabel(e.holePts)}</span>` : '';
      const dot = e.teamColor ? `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${e.teamColor};margin-right:5px;vertical-align:middle"></span>` : '';
      return `<tr>
        <td style="padding:7px 10px"><span class="pos-badge pos-${posCls}" style="${isTied ? 'font-size:0.65rem;' : ''}">${posLabel}</span></td>
        <td style="padding:7px 10px">${dot}${e.name}<br><span class="text-muted" style="font-size:0.72rem">${e.teamName||''}</span>${cbInfo}</td>
        <td style="padding:7px 10px;text-align:right;font-weight:700;color:#1a2332;font-size:1rem">${e.total}</td>
      </tr>`;
    }).join('');

    // ── Nearest the Pin results ──────────────────────────────
    const par3Holes = pars.map((p, i) => p === 3 ? i + 1 : null).filter(Boolean);
    const dayNTP    = _ntp[dayKey] || {};
    let ntpHtml     = '<p class="text-muted" style="font-size:0.85rem">No par 3s on this course.</p>';
    if (par3Holes.length > 0) {
      const ntpRows = par3Holes.map(h => {
        const win = dayNTP[h];
        if (!win?.winnerName) {
          return `<tr>
            <td style="padding:7px 10px;font-weight:600">Hole ${h}</td>
            <td style="padding:7px 10px;color:#57606a">Par 3</td>
            <td style="padding:7px 10px;text-align:right;color:#aaa;font-size:0.82rem">— not set</td>
          </tr>`;
        }
        const winTeam = playerTeam(win.winnerId);
        const dot = winTeam ? `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${winTeam.color};margin-right:4px;vertical-align:middle"></span>` : '';
        return `<tr>
          <td style="padding:7px 10px;font-weight:600">Hole ${h}</td>
          <td style="padding:7px 10px;color:#57606a">Par 3</td>
          <td style="padding:7px 10px;text-align:right;font-weight:700">${dot}📍 ${win.winnerName}</td>
        </tr>`;
      }).join('');
      ntpHtml = `<table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#f7f8fa;font-size:0.78rem;color:#57606a">
          <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #eee">Hole</th>
          <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #eee">Type</th>
          <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #eee">Winner</th>
        </tr></thead>
        <tbody>${ntpRows}</tbody>
      </table>`;
    }

    // ── Day leaderboard (all formats) ────────────────────────
    const medals = ['🥇','🥈','🥉'];
    let teamLeaderboardHtml = '';
    const dayFmt = day.format || 'singles';

    if (dayFmt === 'team') {
      // ── Team day: rank teams by team score ──
      const standings = teamEntries
        .map(([tid, team]) => ({ team, score: teamDayScore(team, dayKey) }))
        .filter(t => t.score > 0)
        .sort((a, b) => b.score - a.score);

      if (standings.length > 0) {
        const lbRows = standings.map((t, idx) => {
          const tourPts = TOUR_PTS_TEAM[idx] || 0;
          return `<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;${idx < standings.length - 1 ? 'border-bottom:1px solid #e5e7eb;' : ''}">
            <span style="font-size:1.4rem;width:28px;text-align:center">${medals[idx] || ''}</span>
            <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${t.team.color};flex-shrink:0"></span>
            <span style="font-weight:700;font-size:1rem;flex:1">${t.team.name}</span>
            <span style="font-weight:900;font-size:1.6rem;color:#1a5c2a;margin-right:4px">${t.score}</span>
            ${tourPts > 0 ? `<span style="background:#d4edda;color:#155724;font-size:0.75rem;font-weight:700;padding:2px 8px;border-radius:12px">+${tourPts} pts</span>` : ''}
          </div>`;
        }).join('');
        teamLeaderboardHtml = `
          <div class="card" style="margin-bottom:14px">
            <div class="card-header" style="margin-bottom:4px">
              <span class="card-title">🏆 Team Leaderboard</span>
              <span class="format-badge format-team">Team Day</span>
            </div>
            ${lbRows}
          </div>`;
      }

    } else if (dayFmt === 'pairs') {
      // ── Pairs day: rank each pair by best-of-two score ──
      const allPairs = dayPairs(dayKey);
      const playerTidMap = {};
      Object.entries(_teams).forEach(([tid, team]) => {
        (team.playerIds || []).forEach(pid => { playerTidMap[pid] = tid; });
      });

      const pairStandings = allPairs.map(([pidA, pidB]) => {
        const team = _teams[playerTidMap[pidA]];
        let score = 0;
        for (let hole = 1; hole <= 18; hole++) {
          const i = hole - 1;
          const gA = dayScores[pidA]?.[`h${hole}`] || 0;
          const gB = dayScores[pidB]?.[`h${hole}`] || 0;
          const sA = gA ? Scoring.stablefordPoints(gA, pars[i], Scoring.shotsOnHole(effectiveHcp(pidA, dayKey), sis[i])) : 0;
          const sB = gB ? Scoring.stablefordPoints(gB, pars[i], Scoring.shotsOnHole(effectiveHcp(pidB, dayKey), sis[i])) : 0;
          score += Math.max(sA, sB);
        }
        const nameA = firstName(_players[pidA]?.name) || pidA;
        const nameB = firstName(_players[pidB]?.name) || pidB;
        return { team, score, label: `${nameA} & ${nameB}` };
      }).filter(p => p.score > 0).sort((a, b) => b.score - a.score);

      if (pairStandings.length > 0) {
        const lbRows = pairStandings.map((p, idx) => {
          const tourPts = TOUR_PTS_PAIRS[idx] || 0;
          const color = p.team?.color || '#ccc';
          return `<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;${idx < pairStandings.length - 1 ? 'border-bottom:1px solid #e5e7eb;' : ''}">
            <span style="font-size:1.4rem;width:28px;text-align:center">${medals[idx] || ''}</span>
            <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${color};flex-shrink:0"></span>
            <span style="font-weight:700;font-size:1rem;flex:1">${p.label}</span>
            <span style="font-weight:900;font-size:1.6rem;color:#1a5c2a;margin-right:4px">${p.score}</span>
            ${tourPts > 0 ? `<span style="background:#d4edda;color:#155724;font-size:0.75rem;font-weight:700;padding:2px 8px;border-radius:12px">+${tourPts} pts</span>` : ''}
          </div>`;
        }).join('');
        teamLeaderboardHtml = `
          <div class="card" style="margin-bottom:14px">
            <div class="card-header" style="margin-bottom:4px">
              <span class="card-title">🏆 Pairs Leaderboard</span>
              <span class="format-badge format-pairs">Pairs Day</span>
            </div>
            ${lbRows}
          </div>`;
      }

    } else if (dayFmt === 'singles') {
      // ── Singles day: rank players by individual stableford ──
      const { pars: singPars, sis: singSis } = dayParsAndSIs(dayKey);
      const playerStandings = Object.entries(_players).map(([pid, p]) => {
        const sc = dayScores[pid] || {};
        const total = sc.stableford || 0;
        const scores = Array.from({length: 18}, (_, i) => sc[`h${i+1}`] || 0);
        const holePts = total ? Scoring.holePoints(scores, singPars, singSis, effectiveHcp(pid, dayKey)) : null;
        const team = playerTeam(pid);
        return { pid, name: firstName(p.name), total, holePts, teamColor: team?.color, teamName: team?.name };
      }).filter(p => p.total > 0).sort((a, b) => Scoring.countbackSort(a, b));

      if (playerStandings.length > 0) {
        const lbRows = playerStandings.map((p, idx) => {
          const tourPts = TOUR_PTS_SINGLES[idx] || 0;
          return `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;${idx < playerStandings.length - 1 ? 'border-bottom:1px solid #e5e7eb;' : ''}">
            <span class="pos-badge pos-${idx < 3 ? idx+1 : 'n'}" style="flex-shrink:0">${idx+1}</span>
            ${p.teamColor ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${p.teamColor};flex-shrink:0"></span>` : ''}
            <span style="font-weight:700;font-size:0.95rem;flex:1">${p.name}<br><span style="font-size:0.72rem;font-weight:400;color:#57606a">${p.teamName||''}</span></span>
            <span style="font-weight:900;font-size:1.3rem;color:#1a5c2a;margin-right:4px">${p.total}</span>
            ${tourPts > 0 ? `<span style="background:#d4edda;color:#155724;font-size:0.75rem;font-weight:700;padding:2px 8px;border-radius:12px">+${tourPts} pts</span>` : ''}
          </div>`;
        }).join('');
        teamLeaderboardHtml = `
          <div class="card" style="margin-bottom:14px">
            <div class="card-header" style="margin-bottom:4px">
              <span class="card-title">🏆 Individual Leaderboard</span>
              <span class="format-badge format-singles">Singles Day</span>
            </div>
            ${lbRows}
          </div>`;
      }
    }

    el.innerHTML = `
      <!-- Day selector -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <label style="font-weight:700;font-size:0.9rem;color:#1a2332;white-space:nowrap">📅 Select Day</label>
        <select id="daily-focus-select"
          style="flex:1;padding:9px 12px;border:1.5px solid #d0d7de;border-radius:8px;font-size:0.9rem;font-family:inherit;background:#fff;max-width:300px"
          onchange="ScoreboardPage.setDailyFocusDay(this.value)">
          ${dayOptions}
        </select>
      </div>

      <!-- Day info banner -->
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;padding:10px 14px;background:#f7f8fa;border-radius:8px;border:1px solid #e5e7eb">
        <span class="day-badge">${dayKey.replace('day','Day ')}</span>
        <span style="font-weight:700">${day.label || dayKey.replace('day','Day ')}</span>
        <span class="format-badge format-${day.format || ''}" style="margin-left:auto">${fmt}</span>
      </div>

      <!-- Team leaderboard (team day only) -->
      ${teamLeaderboardHtml}

      <!-- Team scoring zones -->
      <div class="card">
        <div class="card-header" style="margin-bottom:12px">
          <span class="card-title">🏆 Team Scoring Zones</span>
          <span class="text-muted" style="font-size:0.78rem">Ranked by Stableford</span>
        </div>
        ${teamBlocks}
      </div>

      <!-- Full day ranking -->
      ${allEntries.length > 0 ? `
      <div class="card" style="overflow-x:auto">
        <div class="card-header" style="margin-bottom:10px">
          <span class="card-title">👤 Individual Day Ranking</span>
        </div>
        <table class="scoreboard-table" style="font-size:0.85rem">
          <thead><tr>
            <th style="width:36px">#</th>
            <th>Player</th>
            <th style="text-align:right">Stableford</th>
          </tr></thead>
          <tbody>${rankingRows}</tbody>
        </table>
      </div>` : ''}

      <!-- Nearest the Pin -->
      <div class="card">
        <div class="card-header" style="margin-bottom:10px">
          <span class="card-title">📍 Nearest the Pin</span>
          <span class="text-muted" style="font-size:0.78rem">${par3Holes.length} par 3${par3Holes.length !== 1 ? 's' : ''}</span>
        </div>
        ${ntpHtml}
      </div>`;
  }

  // ── Lost Balls Tab ───────────────────────────────────────
  function renderLostBalls() {
    const el = document.getElementById('sb-lostballs');
    if (!el) return;

    let overallTotal = 0;
    const standings = Object.entries(_players).map(([pid, p]) => {
      let total = 0;
      const dayLost = {};
      for (let d = 1; d <= DAYS; d++) {
        const dayKey = `day${d}`;
        const score = (_allScores[dayKey] || {})[pid];
        let lost = 0;
        if (score) {
          if (score.lostBalls !== undefined) {
            lost = Number(score.lostBalls);
          } else {
            // fallback: sum hole scores lost_h1 to lost_h18
            for (let h = 1; h <= 18; h++) {
              lost += Number(score[`lost_h${h}`] || 0);
            }
          }
        }
        dayLost[dayKey] = lost;
        total += lost;
      }
      overallTotal += total;
      const team = playerTeam(pid);
      return {
        pid,
        name: firstName(p.name),
        handicap: p.handicap,
        total,
        dayLost,
        teamColor: team?.color
      };
    }).sort((a, b) => b.total - a.total); // Sort highest lost ball count to lowest

    const dayHeaders = Array.from({length: DAYS}, (_, i) =>
      `<th class="ind-day-th">D${i + 1}</th>`
    ).join('');

    const rows = standings.map((s, idx) => {
      const pos = idx + 1;
      const dayTds = Array.from({length: DAYS}, (_, i) => {
        const lost = s.dayLost[`day${i+1}`];
        return `<td class="ind-day-td" style="color:${lost > 0 ? '#b91c1c' : '#57606a'}">${lost > 0 ? lost : '<span class="text-muted">—</span>'}</td>`;
      }).join('');
      const dot = s.teamColor ? `<span class="team-color-dot" style="background:${s.teamColor}"></span>` : '';
      const badgeCls = pos <= 3 ? `pos-${pos}` : 'pos-n';
      return `<tr>
        <td><span class="pos-badge ${badgeCls}">${pos}</span></td>
        <td>${dot}${s.name}<br><span class="text-muted" style="font-size:0.72rem">HCP ${s.handicap ?? '?'}</span></td>
        ${dayTds}
        <td class="ind-total-td" style="color:#b91c1c">${s.total}</td>
      </tr>`;
    }).join('');

    el.innerHTML = `
      <div class="card" style="text-align:center;padding:20px 10px;background:#fdf2f2;border:1.5px solid #f5c2c2;border-radius:10px;margin-bottom:14px">
        <div style="font-size:0.85rem;text-transform:uppercase;letter-spacing:1px;font-weight:700;color:#57606a;margin-bottom:4px">🔴 Total Balls Lost</div>
        <div style="font-size:2.8rem;font-weight:900;color:#b91c1c;line-height:1">${overallTotal}</div>
      </div>

      <div class="card" style="overflow-x:auto">
        <div class="card-header" style="margin-bottom:12px">
          <span class="card-title">🔴 Lost Balls Standings</span>
          <span class="text-muted" style="font-size:0.78rem">Most balls lost first</span>
        </div>
        <table class="scoreboard-table">
          <thead><tr>
            <th style="width:36px">#</th>
            <th>Player</th>
            ${dayHeaders}
            <th class="ind-total-th">Total</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  // ── Set selected day for Daily Results Focus ─────────────
  function setDailyFocusDay(dayKey) {
    _dailyFocusDay = dayKey;
    renderDailyFocus();
  }

  // ── Tab switching ─────────────────────────────────────────
  function switchTab(tab) {
    _activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== `sb-${tab}`));
  }

  function destroy() {
    _unsubs.forEach(u => u());
    _unsubs = [];
  }

  return { render, destroy, switchTab, saveNTPDay, saveNTP, setDailyFocusDay };
})();
