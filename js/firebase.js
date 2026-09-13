// ============================================================
//  firebase.js  —  Firebase init + DB helper wrappers
//
//  HOW TO CONFIGURE:
//  1. Go to https://console.firebase.google.com
//  2. Create a project → Realtime Database → Test mode
//  3. Project Settings → Your apps → Web → copy firebaseConfig
//  4. Replace the placeholder values below with your real config
//
//  Until configured, the app runs in localStorage mode so you
//  can test everything locally on one device.
// ============================================================

const firebaseConfig = {

  apiKey: "AIzaSyAVHdbxgkFJEjIoMN0Rpe7Hh87Muar6fLk",

  authDomain: "fh-portugal2027tour.firebaseapp.com",

  databaseURL: "https://fh-portugal2027tour-default-rtdb.firebaseio.com",

  projectId: "fh-portugal2027tour",

  storageBucket: "fh-portugal2027tour.firebasestorage.app",

  messagingSenderId: "484165166128",

  appId: "1:484165166128:web:e9c663b4f67ac6b2cc79f5"

};

// ── Detect whether real config has been pasted in ───────────
const _firebaseReady = firebaseConfig.apiKey !== 'YOUR_API_KEY'
                    && firebaseConfig.databaseURL.indexOf('YOUR_PROJECT') === -1;

// ============================================================
//  localStorage fallback DB (single-device mode)
// ============================================================
const LS_KEY = 'golf_tournament_data';

function lsRead() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}
function lsWrite(data) {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}
function lsGet(path) {
  const parts = path.split('/').filter(Boolean);
  let node = lsRead();
  for (const p of parts) node = (node && node[p] !== undefined) ? node[p] : null;
  return node;
}
function lsSet(path, value) {
  const parts = path.split('/').filter(Boolean);
  const root  = lsRead();
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
  lsWrite(root);
}
function lsUpdate(path, updates) {
  const parts = path.split('/').filter(Boolean);
  const root  = lsRead();
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {};
    node = node[parts[i]];
  }
  const key = parts[parts.length - 1];
  node[key] = Object.assign({}, node[key] || {}, updates);
  lsWrite(root);
}
function lsPush(path, value) {
  const key = '-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  lsSet(`${path}/${key}`, value);
  return key;
}
function lsRemove(path) {
  lsSet(path, null);
  // Clean up null entries in parent
  const parts = path.split('/').filter(Boolean);
  if (parts.length > 1) {
    const parentPath = parts.slice(0, -1).join('/');
    const parent = lsGet(parentPath);
    if (parent && typeof parent === 'object') {
      delete parent[parts[parts.length - 1]];
      lsSet(parentPath, parent);
    }
  }
}

// Listeners registry for localStorage mode
const _lsListeners = {};
function lsNotify(path) {
  const value = lsGet(path);
  (_lsListeners[path] || []).forEach(cb => cb(value));
  // Notify parent paths too
  const parts = path.split('/').filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const parentPath = parts.slice(0, i).join('/');
    if (parentPath && _lsListeners[parentPath]) {
      const parentVal = lsGet(parentPath);
      _lsListeners[parentPath].forEach(cb => cb(parentVal));
    }
  }
}

// ============================================================
//  Firebase mode
// ============================================================
let db = null;
if (_firebaseReady) {
  try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    console.info('[Golf App] Firebase connected ✓');
  } catch (e) {
    console.error('[Golf App] Firebase init failed:', e.message);
  }
} else {
  console.info('[Golf App] Running in localStorage mode (single-device). Configure Firebase for live multi-device sync.');
}

const ROOT = 'tournament';
const LEGACY_TOUR_ID = 'cascais';
let _activeTourId = sessionStorage.getItem('golf_active_tour') || LEGACY_TOUR_ID;

function tourPath(path) {
  // Cascais remains on the original database paths so existing data is untouched.
  return _activeTourId === LEGACY_TOUR_ID ? `${ROOT}/${path}` : `${ROOT}/tours/${_activeTourId}/${path}`;
}

// ============================================================
//  Unified DB interface — same API regardless of backend
// ============================================================
const DB = {

  get(path) {
    const resolved = tourPath(path);
    if (db) {
      return db.ref(resolved).once('value').then(s => s.val());
    }
    return Promise.resolve(lsGet(resolved));
  },

  set(path, data) {
    const resolved = tourPath(path);
    if (db) return db.ref(resolved).set(data);
    lsSet(resolved, data); lsNotify(resolved); return Promise.resolve();
  },

  update(path, data) {
    const resolved = tourPath(path);
    if (db) return db.ref(resolved).update(data);
    lsUpdate(resolved, data); lsNotify(resolved); return Promise.resolve();
  },

  push(path, data) {
    const resolved = tourPath(path);
    if (db) return db.ref(resolved).push(data);
    lsPush(resolved, data); lsNotify(resolved); return Promise.resolve();
  },

  remove(path) {
    const resolved = tourPath(path);
    if (db) return db.ref(resolved).remove();
    lsRemove(resolved); lsNotify(resolved); return Promise.resolve();
  },

  // Realtime listener — returns unsubscribe fn
  on(path, callback) {
    const resolved = tourPath(path);
    if (db) {
      const r = db.ref(resolved);
      const handler = snap => callback(snap.val());
      r.on('value', handler);
      return () => r.off('value', handler);
    }
    // localStorage mode: register listener and fire immediately
    const fullPath = resolved;
    if (!_lsListeners[fullPath]) _lsListeners[fullPath] = [];
    _lsListeners[fullPath].push(callback);
    // Fire immediately with current value
    setTimeout(() => callback(lsGet(fullPath)), 0);
    return () => {
      _lsListeners[fullPath] = (_lsListeners[fullPath] || []).filter(cb => cb !== callback);
    };
  },
  selectTour(id) {
    _activeTourId = id || LEGACY_TOUR_ID;
    sessionStorage.setItem('golf_active_tour', _activeTourId);
  },
  activeTour() { return _activeTourId; },
  getTours() {
    return db ? db.ref(`${ROOT}/tourRegistry`).once('value').then(s => s.val() || {})
      : Promise.resolve(lsGet(`${ROOT}/tourRegistry`) || {});
  },
  setTourMeta(id, data) {
    const path = `${ROOT}/tourRegistry/${id}`;
    if (db) return db.ref(path).update(data);
    lsUpdate(path, data);
    lsNotify(path);
    return Promise.resolve();
  },
  async initTour(id, data) {
    const old = _activeTourId;
    this.selectTour(id);
    await this.setTourMeta(id, data);
    if (!(await this.get('config'))) {
      const rounds = Math.max(1, Number(data.rounds) || 5);
      await this.set('config', { tournamentName: data.name, year: new Date().getFullYear(), currentDay: 1, adminPin: '1234', days: rounds });
      const formats = ['singles', 'pairs', 'singles', 'team', 'pairs'];
      const schedule = {};
      for (let d = 1; d <= rounds; d++) schedule[`day${d}`] = { label: `Day ${d}`, format: formats[d - 1] || 'singles', scoringNote: '', teeTime: '08:00', groupings: [] };
      await this.set('schedule', schedule);
    }
    this.selectTour(old);
  }
};

// ── Seed default data on first run ──────────────────────────
async function seedIfEmpty() {
  const registry = await DB.getTours();
  if (!registry || !registry[LEGACY_TOUR_ID]) {
    await DB.setTourMeta(LEGACY_TOUR_ID, {
      name: 'TOETS Cascais 2027', playerCount: 12, teamBased: true, teamCount: 3,
      tabs: { tour:true, dailyfocus:true, individual:true, bingo:true, ntp:true, matchplay:true, lostballs:true },
      scoringOptions: { bingo: true, ntp: true, matchplay: true }
    });
  } else if (registry[LEGACY_TOUR_ID].teamBased === undefined) {
    await DB.setTourMeta(LEGACY_TOUR_ID, {
      teamBased: true,
      teamCount: 3,
      tabs: { tour:true, dailyfocus:true, individual:true, bingo:true, ntp:true, matchplay:true, lostballs:true }
    });
  }
  const config = await DB.get('config');
  if (!config) {
    await DB.set('config', {
      tournamentName: 'TOETS Cascais 2027',
      year: new Date().getFullYear(),
      currentDay: 1,
      adminPin: '1234',
      days: 5
    });
  }

  const schedule = await DB.get('schedule');
  if (!schedule) {
    const defaultFormats = ['singles','pairs','singles','team','pairs'];
    const days = {};
    for (let d = 1; d <= 5; d++) {
      days[`day${d}`] = {
        label: `Day ${d}`,
        format: defaultFormats[d - 1],
        scoringNote: '',
        teeTime: '08:00',
        groupings: []
      };
    }
    await DB.set('schedule', days);
  }
}

seedIfEmpty();
