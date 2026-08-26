# ⛳ Annual Golf Tournament App

A mobile-friendly web app for running a 5-day, 12-player, 3-team golf tournament with live score entry and real-time scoreboard powered by Firebase.

---

## Features

- **Tour Members** — Add/edit 12 players with names and handicaps
- **Teams** — Assign players to 3 teams of 4 (manual or auto by handicap)
- **Schedule** — Configure each day's format, tee time, groupings, and notes
- **Scorecard** — Players enter their hole-by-hole scores from their phone
- **Scoreboard** — Live standings (individual + team + daily breakdown)
- **Formats** — Singles Stableford, Pairs Stableford, Team Stableford (best 2 of 4)
- **Admin PIN** — Protected admin panel for setup (default PIN: `1234`)

---

## Setup Steps

### 1. Create a Firebase Project

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → name it (e.g. `golf-tournament-2025`) → Continue
3. Disable Google Analytics (optional) → **Create project**

### 2. Enable Realtime Database

1. In the left sidebar → **Build → Realtime Database**
2. Click **Create Database**
3. Choose a location (e.g. `us-central1`) → **Next**
4. Start in **Test mode** (for easy access during the tournament week)
5. Click **Enable**

> ⚠️ Test mode allows open read/write for 30 days — perfect for a week-long tournament.

### 3. Get Your Firebase Config

1. Go to **Project Settings** (gear icon) → **Your apps**
2. Click **Add app → Web** (</> icon)
3. Register the app (any nickname)
4. Copy the `firebaseConfig` object shown

### 4. Paste Config into the App

Open `js/firebase.js` and replace the placeholder values:

```js
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",           // ← paste here
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};
```

### 5. (Optional) Change Admin PIN

In the Firebase Console → Realtime Database → `tournament/config/adminPin`
Change `"1234"` to your preferred PIN.

Or: open the app, log in as admin with PIN `1234`, and the config is editable.

---

## Hosting (Free — GitHub Pages)

1. Create a free GitHub account at [https://github.com](https://github.com)
2. Create a new **public** repository (e.g. `golf-tournament-2025`)
3. Upload all files from this folder (maintaining the `css/` and `js/` structure)
4. Go to **Settings → Pages → Source: main branch / root** → Save
5. Your app is live at: `https://YOUR_USERNAME.github.io/golf-tournament-2025/`

Share that URL with all 12 players before the tournament!

---

## Alternative Free Hosts

| Host | Deploy method | URL example |
|------|---------------|-------------|
| [Netlify](https://netlify.com) | Drag & drop folder | `yoursite.netlify.app` |
| [Vercel](https://vercel.com) | Drag & drop or Git | `yoursite.vercel.app` |
| [GitHub Pages](https://pages.github.com) | Git push | `user.github.io/repo` |

---

## Tournament Setup Checklist

- [ ] Create Firebase project + Realtime Database
- [ ] Paste Firebase config into `js/firebase.js`
- [ ] Host files (GitHub Pages or Netlify)
- [ ] Open app → tap ⚙️ → enter PIN `1234` → unlock admin
- [ ] Go to **Players** → add all 12 players with handicaps
- [ ] Go to **Teams** → assign players to 3 teams (or use Auto-Assign)
- [ ] Go to **Schedule** → set format, tee times, and groupings for each day
- [ ] Share the URL with all players
- [ ] During play: players open the URL, tap **Scores**, select their name + day, enter scores hole by hole
- [ ] Everyone can watch the live **Scoreboard** update in real time

---

## Stableford Scoring Reference

| Net score vs par | Points |
|-----------------|--------|
| Eagle or better  | 4 |
| Birdie           | 3 |
| Par              | 2 |
| Bogey            | 1 |
| Double bogey+    | 0 |

---

## File Structure

```
index.html          ← App shell
css/style.css       ← All styles
js/firebase.js      ← Firebase config + DB helpers
js/app.js           ← Router + admin auth + toast
js/scoring.js       ← Stableford engine
js/players.js       ← Tour Members page
js/teams.js         ← Team allocation page
js/schedule.js      ← Schedule + groupings page
js/scorecard.js     ← Score entry page
js/scoreboard.js    ← Live scoreboard page
README.md           ← This file
```
