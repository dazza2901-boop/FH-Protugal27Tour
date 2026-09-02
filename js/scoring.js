// ============================================================
//  scoring.js  —  Stableford calculation engine
// ============================================================

const HOLE_PARS = [4,4,3,4,5,3,4,4,5, 4,3,4,5,4,3,4,5,4]; // default 18-hole pars (editable in schedule)

const Scoring = {

  // ── Stableford points for one hole ──────────────────────
  // strokes = gross score on hole
  // par     = hole par
  // shots   = handicap shots received on this hole (0 or 1 typically)
  stablefordPoints(strokes, par, shots = 0) {
    if (!strokes || strokes <= 0) return 0;           // NR / no score
    const net = strokes - shots;
    const diff = net - par;
    if (diff <= -2) return 4;   // eagle or better
    if (diff === -1) return 3;  // birdie
    if (diff === 0)  return 2;  // par
    if (diff === 1)  return 1;  // bogey
    return 0;                   // double bogey or worse
  },

  // ── Handicap shots per hole (based on stroke index) ─────
  // handicap = player course handicap (already adjusted)
  // si       = stroke index of the hole (1-18)
  shotsOnHole(handicap, si) {
    const h = Math.max(0, handicap);
    let shots = Math.floor(h / 18);
    if (si <= (h % 18)) shots += 1;
    return shots;
  },

  // ── Total stableford for a player's round ───────────────
  // scores  = array[18] of gross scores (0 = NR)
  // pars    = array[18] of hole pars
  // sis     = array[18] of stroke indexes
  // handicap = course handicap
  totalStableford(scores, pars, sis, handicap) {
    let total = 0;
    for (let i = 0; i < 18; i++) {
      const shots = this.shotsOnHole(handicap, sis[i]);
      total += this.stablefordPoints(scores[i], pars[i], shots);
    }
    return total;
  },

  // ── Pairs Stableford: sum of both players' points per hole ─
  pairsTotal(scoresA, scoresB, pars, sis, hcpA, hcpB) {
    let total = 0;
    for (let i = 0; i < 18; i++) {
      const shotsA = this.shotsOnHole(hcpA, sis[i]);
      const shotsB = this.shotsOnHole(hcpB, sis[i]);
      total += this.stablefordPoints(scoresA[i], pars[i], shotsA);
      total += this.stablefordPoints(scoresB[i], pars[i], shotsB);
    }
    return total;
  },

  // ── Team Stableford: best 2 on par 3s/4s, best 3 on par 5s ─
  teamScore(allScores, pars, sis, handicaps) {
    // allScores: array of player score arrays; handicaps: array of player handicaps
    let total = 0;
    for (let i = 0; i < 18; i++) {
      const pts = allScores.map((sc, pi) => {
        const shots = this.shotsOnHole(handicaps[pi], sis[i]);
        return this.stablefordPoints(sc[i], pars[i], shots);
      }).sort((a, b) => b - a);
      const count = pars[i] === 5 ? 3 : 2;   // best 3 on par 5, best 2 elsewhere
      for (let k = 0; k < count; k++) total += pts[k] || 0;
    }
    return total;
  },

  // ── Classify a gross score vs par for colour coding ─────
  // Colour is based on gross vs par only — handicap shots are not considered
  classify(strokes, par) {
    if (!strokes || strokes <= 0) return '';
    const diff = strokes - par;
    if (diff <= -2) return 'eagle';
    if (diff === -1) return 'birdie';
    if (diff === 0)  return 'par';
    if (diff === 1)  return 'bogey';
    if (diff === 2)  return 'double';
    return 'triple';
  },

  // ── Default stroke indexes (standard layout) ────────────
  defaultSIs() {
    return [1,10,16,8,2,14,6,12,4, 3,15,7,11,5,17,9,13,18];
  },

  defaultPars() {
    return [...HOLE_PARS];
  },

  // ── Countback tiebreak (standard golf) ──────────────────
  // Returns an array[18] of Stableford points for each hole.
  // scores  = array[18] of gross scores (0 = NR)
  // pars    = array[18] of hole pars
  // sis     = array[18] of stroke indexes
  // handicap = course handicap
  holePoints(scores, pars, sis, handicap) {
    return Array.from({ length: 18 }, (_, i) => {
      if (!scores[i]) return 0;
      const shots = Scoring.shotsOnHole(handicap, sis[i]);
      return Scoring.stablefordPoints(scores[i], pars[i], shots);
    });
  },

  // Sum Stableford points over a slice of holes (0-based indices).
  _sumSlice(pts, from, to) {
    let s = 0;
    for (let i = from; i < to; i++) s += (pts[i] || 0);
    return s;
  },

  // Compare two players using standard golf countback (Stableford):
  //   1. Back 9  (holes 10–18, indices 9–17)
  //   2. Back 6  (holes 13–18, indices 12–17)
  //   3. Back 3  (holes 16–18, indices 15–17)
  //   4. Last hole (hole 18,   index 17)
  //
  // ptsA / ptsB = holePoints() arrays for each player.
  // Returns negative if A wins tiebreak, positive if B wins, 0 if still tied.
  countbackCompare(ptsA, ptsB) {
    const slices = [
      [9, 18],   // back 9
      [12, 18],  // back 6
      [15, 18],  // back 3
      [17, 18],  // last hole
    ];
    for (const [from, to] of slices) {
      const diff = Scoring._sumSlice(ptsB, from, to) - Scoring._sumSlice(ptsA, from, to);
      if (diff !== 0) return diff;   // higher Stableford wins (lower diff = A wins)
    }
    return 0; // cannot separate — dead heat
  },

  // Build a human-readable countback label for display:
  // e.g. "B9 18 · B6 12 · B3 6 · H18 2"
  countbackLabel(pts) {
    const b9  = Scoring._sumSlice(pts, 9, 18);
    const b6  = Scoring._sumSlice(pts, 12, 18);
    const b3  = Scoring._sumSlice(pts, 15, 18);
    const h18 = pts[17] || 0;
    return `B9 ${b9} · B6 ${b6} · B3 ${b3} · H18 ${h18}`;
  },

  // Convenience: sort comparator — safe to use directly in .sort() callbacks.
  // Sorts by total descending, then countback on .holePts.
  countbackSort(a, b) {
    if (a.total !== b.total) return b.total - a.total;
    return Scoring.countbackCompare(a.holePts || [], b.holePts || []);
  }
};
