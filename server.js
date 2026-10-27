// NFL Weekly Picks — real multi-player pool app.
// Node.js server (built-in http + node:sqlite + crypto, plus nodemailer
// for optional registration email alerts).
// One shared SQLite database, so every player sees the same pool state
// and everything flows back to the admin.
//
// Money is TRACKING ONLY. No real payments are processed here — players
// settle outside the app. Stripe, PayPal, Venmo and Cash App prohibit
// gambling pools in their terms, so this app never touches real money.
//
// Run:  node server.js            (defaults: PORT=3000, data in ./pickem.db)
// Env:  PORT, DB_PATH, ADMIN_PASSWORD (sets the admin password on first
//       run if the admin account has no password yet),
//       SMTP_USER, SMTP_PASS, NOTIFY_EMAIL (registration email alerts;
//       SMTP_PASS is a Gmail app password, never a real password, and
//       must only ever live in the host's environment variables —
//       never in the repo, never in chat).

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'pickem.db');
const PUBLIC_DIR = path.join(__dirname, 'public');

const db = new DatabaseSync(DB_PATH);

// ------------------------------------------------------- registration email
// Optional: when SMTP_USER + SMTP_PASS are set, every new player
// registration emails NOTIFY_EMAIL (defaults to SMTP_USER). Sending never
// blocks registration — failures are only logged.
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || process.env.SMTP_USER || '';
async function notifyRegistration(name, username) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || !NOTIFY_EMAIL) return;
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    const groupName = getSetting('group_name') || 'NFL Weekly Picks';
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: NOTIFY_EMAIL,
      subject: `New player registered: ${name} (${username})`,
      text: `${name} (${username}) just registered for ${groupName}.\n\nTime: ${new Date().toISOString()}\n\nAutomatic notification from your NFL Weekly Picks app.`,
    });
    console.log(`Registration email sent for ${username}`);
  } catch (e) {
    console.error('Registration email failed:', e.message);
  }
}

// Generic outbound mail (password resets). Throws on failure so the
// caller can decide what to tell the user. Requires SMTP_USER +
// SMTP_PASS, same Gmail app-password setup as registration alerts.
async function sendMail(to, subject, text) {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({ from: process.env.SMTP_USER, to, subject, text });
}

// ---------------------------------------------------------------- schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    password_salt TEXT,
    name TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS weeks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season INTEGER NOT NULL,
    week_number INTEGER NOT NULL,
    open_at TEXT NOT NULL,
    lock_at TEXT NOT NULL,
    label TEXT,
    note TEXT
  );
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_id INTEGER NOT NULL REFERENCES weeks(id),
    away_team TEXT NOT NULL,
    home_team TEXT NOT NULL,
    kickoff TEXT NOT NULL,
    kickoff_label TEXT NOT NULL,
    winner TEXT
  );
  CREATE TABLE IF NOT EXISTS participation (
    user_id INTEGER NOT NULL REFERENCES users(id),
    week_id INTEGER NOT NULL REFERENCES weeks(id),
    status TEXT NOT NULL CHECK (status IN ('playing', 'not_participating')),
    PRIMARY KEY (user_id, week_id)
  );
  CREATE TABLE IF NOT EXISTS picks (
    user_id INTEGER NOT NULL REFERENCES users(id),
    game_id INTEGER NOT NULL REFERENCES games(id),
    team TEXT NOT NULL,
    PRIMARY KEY (user_id, game_id)
  );
  CREATE TABLE IF NOT EXISTS payments (
    user_id INTEGER NOT NULL REFERENCES users(id),
    week_id INTEGER NOT NULL REFERENCES weeks(id),
    paid INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, week_id)
  );
  CREATE TABLE IF NOT EXISTS team_records (
    team TEXT PRIMARY KEY,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    ties INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Weeks created before labels existed get the columns added on startup.
for (const col of ['label', 'note']) {
  const cols = db.prepare('PRAGMA table_info(weeks)').all().map((r) => r.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE weeks ADD COLUMN ${col} TEXT`);
}

// Users created before names existed get the column added on startup.
{
  const cols = db.prepare('PRAGMA table_info(users)').all().map((r) => r.name);
  if (!cols.includes('name')) db.exec('ALTER TABLE users ADD COLUMN name TEXT');
}

// ------------------------------------------------------------------ seed
// Week 7, 2026 season. Times are kickoff labels in ET as published;
// lock is Thursday Oct 22, 2026 at 5:00 PM Central (CDT = UTC-5),
// extended one time from noon so the admin has time to get set up.
const WEEK7_GAMES = [
  ['Patriots', 'Bears', '2026-10-22T20:15:00-04:00', 'Thu Oct 22, 8:15 PM ET'],
  ['Steelers', 'Saints', '2026-10-25T09:30:00-04:00', 'Sun Oct 25, 9:30 AM ET (Paris)'],
  ['Bengals', 'Ravens', '2026-10-25T13:00:00-04:00', 'Sun Oct 25, 1:00 PM ET'],
  ['Browns', 'Titans', '2026-10-25T13:00:00-04:00', 'Sun Oct 25, 1:00 PM ET'],
  ['Colts', 'Vikings', '2026-10-25T13:00:00-04:00', 'Sun Oct 25, 1:00 PM ET'],
  ['Dolphins', 'Jets', '2026-10-25T13:00:00-04:00', 'Sun Oct 25, 1:00 PM ET'],
  ['Giants', 'Texans', '2026-10-25T13:00:00-04:00', 'Sun Oct 25, 1:00 PM ET'],
  ['49ers', 'Falcons', '2026-10-25T13:00:00-04:00', 'Sun Oct 25, 1:00 PM ET'],
  ['Buccaneers', 'Panthers', '2026-10-25T13:00:00-04:00', 'Sun Oct 25, 1:00 PM ET'],
  ['Broncos', 'Cardinals', '2026-10-25T16:05:00-04:00', 'Sun Oct 25, 4:05 PM ET'],
  ['Packers', 'Lions', '2026-10-25T16:25:00-04:00', 'Sun Oct 25, 4:25 PM ET'],
  ['Rams', 'Raiders', '2026-10-25T16:25:00-04:00', 'Sun Oct 25, 4:25 PM ET'],
  ['Chiefs', 'Seahawks', '2026-10-25T20:20:00-04:00', 'Sun Oct 25, 8:20 PM ET'],
  ['Cowboys', 'Eagles', '2026-10-26T20:15:00-04:00', 'Mon Oct 26, 8:15 PM ET'],
];

function seed() {
  // Migration: record each player's email (for password resets) and hold
  // reset tokens. Runs on every start; safe on databases created before
  // these existed. A unique index on a nullable column still allows
  // multiple NULLs (older accounts without an email).
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('email')) db.exec('ALTER TABLE users ADD COLUMN email TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)');
  db.exec(`CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL
  )`);
  // Migration: track the NFL week number per week (for automatic seeding).
  // The app's week_number diverged from the NFL's when the mini test took
  // week_number 8, so week_number 9 is NFL Week 8, and so on. The mini
  // test is not an NFL week and keeps nfl_week NULL.
  const weekCols = db.prepare('PRAGMA table_info(weeks)').all().map((c) => c.name);
  if (!weekCols.includes('nfl_week')) db.exec('ALTER TABLE weeks ADD COLUMN nfl_week INTEGER');
  db.prepare('UPDATE weeks SET nfl_week = 7 WHERE season = 2026 AND week_number = 7 AND nfl_week IS NULL').run();
  // One week_number per season: this is what makes concurrent auto-seed
  // attempts safe (two loads racing past the early check cannot both
  // insert; the loser gets a constraint error, not a duplicate week).
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_weeks_season_number ON weeks(season, week_number)'); }
  catch (e) { console.log('[seed] weeks unique index skipped: ' + (e && e.message ? e.message : e)); }
  const existing = db.prepare('SELECT id FROM weeks WHERE season = 2026 AND week_number = 7').get();
  if (!existing) {
    const w = db.prepare(
      "INSERT INTO weeks (season, week_number, nfl_week, open_at, lock_at) VALUES (2026, 7, 7, '2026-10-20T05:00:00Z', '2026-10-22T22:00:00Z')"
    ).run();
    const ins = db.prepare(
      'INSERT INTO games (week_id, away_team, home_team, kickoff, kickoff_label) VALUES (?, ?, ?, ?, ?)'
    );
    for (const [away, home, kickoff, label] of WEEK7_GAMES) {
      ins.run(w.lastInsertRowid, away, home, kickoff, label);
    }
  }
  // Mini test week: Sunday + Monday games only (Oct 25-26), so the app
  // can be tested live before full Week 8. Locks Sun Oct 25 at 10:00 AM
  // Central. Note: the first game (Steelers-Saints, Paris, 8:30 AM
  // Central kickoff) is already underway by then.
  // It is week_number 8 with a label so it never displays as "Week 8";
  // full Week 8 is added later as a higher week_number labeled "Week 8".
  const MINI_GAMES = [
    ['Steelers', 'Saints', '2026-10-25T09:30:00-04:00', 'Sun Oct 25, 9:30 AM ET (Paris)'],
    ['Bengals', 'Ravens', '2026-10-25T13:00:00-04:00', 'Sun Oct 25, 1:00 PM ET'],
    ['Browns', 'Titans', '2026-10-25T13:00:00-04:00', 'Sun Oct 25, 1:00 PM ET'],
    ['Colts', 'Vikings', '2026-10-25T13:00:00-04:00', 'Sun Oct 25, 1:00 PM ET'],
    ['Dolphins', 'Jets', '2026-10-25T13:00:00-04:00', 'Sun Oct 25, 1:00 PM ET'],
    ['Giants', 'Texans', '2026-10-25T13:00:00-04:00', 'Sun Oct 25, 1:00 PM ET'],
    ['49ers', 'Falcons', '2026-10-25T13:00:00-04:00', 'Sun Oct 25, 1:00 PM ET'],
    ['Buccaneers', 'Panthers', '2026-10-25T13:00:00-04:00', 'Sun Oct 25, 1:00 PM ET'],
    ['Broncos', 'Cardinals', '2026-10-25T16:05:00-04:00', 'Sun Oct 25, 4:05 PM ET'],
    ['Packers', 'Lions', '2026-10-25T16:25:00-04:00', 'Sun Oct 25, 4:25 PM ET'],
    ['Rams', 'Raiders', '2026-10-25T16:25:00-04:00', 'Sun Oct 25, 4:25 PM ET'],
    ['Chiefs', 'Seahawks', '2026-10-25T20:20:00-04:00', 'Sun Oct 25, 8:20 PM ET'],
    ['Cowboys', 'Eagles', '2026-10-26T20:15:00-04:00', 'Mon Oct 26, 8:15 PM ET'],
  ];
  const mini = db.prepare('SELECT id FROM weeks WHERE season = 2026 AND week_number = 8').get();
  if (!mini) {
    const w = db.prepare(
      "INSERT INTO weeks (season, week_number, open_at, lock_at, label, note) VALUES (2026, 8, '2026-10-22T23:00:00Z', '2026-10-25T15:00:00Z', 'Mini Test — Oct 25–26', 'Mini test week — Sunday and Monday games only.')"
    ).run();
    const ins = db.prepare(
      'INSERT INTO games (week_id, away_team, home_team, kickoff, kickoff_label) VALUES (?, ?, ?, ?, ?)'
    );
    for (const [away, home, kickoff, label] of MINI_GAMES) {
      ins.run(w.lastInsertRowid, away, home, kickoff, label);
    }
  }
  const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  if (!admin) {
    db.prepare('INSERT INTO users (username, is_admin) VALUES (?, 1)').run('admin');
  }
  for (const [key, value] of [['group_name', ''], ['per_pick_amount', '0.50']]) {
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }
  // Team season records (W-L-T) as of Oct 23, 2026, from Sky Sports'
  // NFL standings page (Fri Oct 23, 2026). INSERT OR IGNORE so records
  // the admin edits in the panel survive restarts and redeploys.
  // Records do NOT auto-update from game results; the admin edits them.
  const TEAM_RECORDS = [
    ['Patriots', 4, 3, 0],
    ['Bears', 5, 2, 0],
    ['Steelers', 4, 2, 0],
    ['Saints', 2, 4, 0],
    ['Bengals', 3, 2, 0],
    ['Ravens', 4, 2, 0],
    ['Browns', 4, 2, 0],
    ['Titans', 1, 5, 0],
    ['Colts', 2, 4, 0],
    ['Vikings', 5, 0, 0],
    ['Dolphins', 0, 5, 0],
    ['Jets', 2, 4, 0],
    ['Giants', 3, 2, 1],
    ['Texans', 2, 4, 0],
    ['49ers', 6, 0, 0],
    ['Falcons', 2, 4, 0],
    ['Buccaneers', 1, 5, 0],
    ['Panthers', 3, 2, 0],
    ['Broncos', 4, 2, 0],
    ['Cardinals', 2, 4, 0],
    ['Packers', 3, 2, 0],
    ['Lions', 3, 2, 0],
    ['Rams', 2, 4, 0],
    ['Raiders', 3, 3, 0],
    ['Chiefs', 5, 0, 0],
    ['Seahawks', 3, 3, 0],
    ['Cowboys', 2, 4, 0],
    ['Eagles', 2, 4, 0],
  ];
  const recIns = db.prepare('INSERT OR IGNORE INTO team_records (team, wins, losses, ties) VALUES (?, ?, ?, ?)');
  for (const [team, w, l, t] of TEAM_RECORDS) recIns.run(team, w, l, t);

  // Full Week 8: 14 games, Thu Oct 29–Mon Nov 2, 2026. Added as
  // week_number 9 (8 is the mini test) with label 'Week 8' so it displays
  // correctly. INSERT-guarded by week_number so it seeds exactly once.
  // Only becomes current when deployed after the mini test ends, because
  // the app treats the highest week_number as current — deploying this
  // before Monday night's game would hide the mini test pool.
  const WEEK8_GAMES = [
    ['Panthers', 'Packers', '2026-10-29T20:15:00-04:00', 'Thu Oct 29, 8:15 PM ET'],
    ['Ravens', 'Bills', '2026-11-01T13:00:00-05:00', 'Sun Nov 1, 1:00 PM ET'],
    ['Titans', 'Bengals', '2026-11-01T13:00:00-05:00', 'Sun Nov 1, 1:00 PM ET'],
    ['Cardinals', 'Cowboys', '2026-11-01T13:00:00-05:00', 'Sun Nov 1, 1:00 PM ET'],
    ['Vikings', 'Lions', '2026-11-01T13:00:00-05:00', 'Sun Nov 1, 1:00 PM ET'],
    ['Raiders', 'Jets', '2026-11-01T13:00:00-05:00', 'Sun Nov 1, 1:00 PM ET'],
    ['Browns', 'Steelers', '2026-11-01T13:00:00-05:00', 'Sun Nov 1, 1:00 PM ET'],
    ['Falcons', 'Buccaneers', '2026-11-01T13:00:00-05:00', 'Sun Nov 1, 1:00 PM ET'],
    ['Colts', 'Jaguars', '2026-11-01T13:00:00-05:00', 'Sun Nov 1, 1:00 PM ET'],
    ['Chargers', 'Rams', '2026-11-01T16:05:00-05:00', 'Sun Nov 1, 4:05 PM ET'],
    ['Chiefs', 'Broncos', '2026-11-01T16:25:00-05:00', 'Sun Nov 1, 4:25 PM ET'],
    ['Patriots', 'Dolphins', '2026-11-01T16:25:00-05:00', 'Sun Nov 1, 4:25 PM ET'],
    ['Eagles', 'Commanders', '2026-11-01T20:20:00-05:00', 'Sun Nov 1, 8:20 PM ET'],
    ['Bears', 'Seahawks', '2026-11-02T20:15:00-05:00', 'Mon Nov 2, 8:15 PM ET'],
  ];
  const w8 = db.prepare('SELECT id FROM weeks WHERE season = 2026 AND week_number = 9').get();
  if (!w8) {
    const w = db.prepare(
      "INSERT INTO weeks (season, week_number, nfl_week, open_at, lock_at, label, note) VALUES (2026, 9, 8, '2026-10-27T05:00:00Z', '2026-10-29T17:00:00Z', 'Week 8', 'Full Week 8 — Thursday through Monday games.')"
    ).run();
    const ins = db.prepare(
      'INSERT INTO games (week_id, away_team, home_team, kickoff, kickoff_label) VALUES (?, ?, ?, ?, ?)'
    );
    for (const [away, home, kickoff, label] of WEEK8_GAMES) {
      ins.run(w.lastInsertRowid, away, home, kickoff, label);
    }
  }
}
seed();

// Admin password: set from ADMIN_PASSWORD on first run if unset, or via
// the one-time POST /api/admin/setup endpoint (see below). Never hardcoded.
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
if (process.env.ADMIN_PASSWORD) {
  const row = db.prepare("SELECT password_hash FROM users WHERE username = 'admin'").get();
  if (row && !row.password_hash) {
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE username = 'admin'")
      .run(hashPassword(process.env.ADMIN_PASSWORD, salt), salt);
    console.log('Admin password set from ADMIN_PASSWORD.');
  }
}

// ---------------------------------------------------------------- helpers
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}
function currentWeek() {
  return db.prepare('SELECT * FROM weeks ORDER BY season DESC, week_number DESC LIMIT 1').get();
}
function getUserFromRequest(req) {
  const cookie = (req.headers.cookie || '').split(';').map((s) => s.trim())
    .find((s) => s.startsWith('session='));
  if (!cookie) return null;
  const token = decodeURIComponent(cookie.slice('session='.length));
  const sess = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(token);
  if (!sess || new Date(sess.expires_at) < new Date()) return null;
  return db.prepare('SELECT id, username, name, email, is_admin FROM users WHERE id = ?').get(sess.user_id) || null;
}
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('invalid json')); }
    });
  });
}
function requireUser(req, res) {
  const user = getUserFromRequest(req);
  if (!user) { sendJson(res, 401, { error: 'Not signed in' }); return null; }
  return user;
}
function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (!user.is_admin) { sendJson(res, 403, { error: 'Admin only' }); return null; }
  return user;
}
function weekStatus(week) {
  const now = new Date();
  if (now < new Date(week.open_at)) return 'not_open';
  if (now >= new Date(week.lock_at)) return 'locked';
  return 'open';
}

// ------------------------------------------------------------------ automatic results
// Fully automatic result fetching: when anyone loads the pool or standings,
// the server checks ESPN's public scoreboard for the current week's games
// that still have no winner, and fills in winners for games that are final.
// - Only fills games whose winner is still empty: an admin-entered result
//   is never overwritten.
// - Only final games count (ESPN status "post"); games still playing or
//   not started are left alone.
// - Throttled to one ESPN check per 10 minutes so normal browsing doesn't
//   hammer the source.
// - Any failure (source down, changed format, timeout) is logged and
//   ignored: the app keeps working and manual entry still works.
// - ESPN_SCOREBOARD_URL (env) overrides the base URL; tests use it to
//   point at a local stub instead of the real source.
const ESPN_BASE = process.env.ESPN_SCOREBOARD_URL || 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const ESPN_ABBR = {
  '49ers': 'SF', Bears: 'CHI', Bengals: 'CIN', Bills: 'BUF', Broncos: 'DEN', Browns: 'CLE',
  Buccaneers: 'TB', Cardinals: 'ARI', Chargers: 'LAC', Chiefs: 'KC', Colts: 'IND', Commanders: 'WSH',
  Cowboys: 'DAL', Dolphins: 'MIA', Eagles: 'PHI', Falcons: 'ATL', Giants: 'NYG', Jaguars: 'JAX',
  Jets: 'NYJ', Lions: 'DET', Packers: 'GB', Panthers: 'CAR', Patriots: 'NE', Raiders: 'LV',
  Rams: 'LAR', Ravens: 'BAL', Saints: 'NO', Seahawks: 'SEA', Steelers: 'PIT', Texans: 'HOU',
  Titans: 'TEN', Vikings: 'MIN',
};
let lastAutoFetchAt = 0;
const AUTO_FETCH_MIN_MS = 10 * 60 * 1000;

function etDateOf(kickoff) {
  // Kickoff strings carry an ET offset (e.g. 2026-10-25T09:30:00-04:00),
  // so the date part is already the ET date ESPN lists the game under.
  return String(kickoff).slice(0, 10).replace(/-/g, '');
}

async function maybeAutoFetchResults(week) {
  try {
    const undecided = db.prepare('SELECT * FROM games WHERE week_id = ? AND winner IS NULL').all(week.id);
    if (!undecided.length) return;
    const now = Date.now();
    if (now - lastAutoFetchAt < AUTO_FETCH_MIN_MS) return;
    lastAutoFetchAt = now;
    // Distinct ET dates of undecided games, so each day's scoreboard is
    // fetched once per cycle.
    const dates = [...new Set(undecided.map((g) => etDateOf(g.kickoff)))];
    const eventsByPair = new Map();
    for (const d of dates) {
      const res = await fetch(ESPN_BASE + '?dates=' + d, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error('ESPN scoreboard HTTP ' + res.status);
      const data = await res.json();
      for (const ev of (data.events || [])) {
        const comp = ev.competitions && ev.competitions[0];
        if (!comp) continue;
        const state = comp.status && comp.status.type && comp.status.type.state;
        if (state !== 'post') continue; // only final games
        const teams = {};
        for (const c of (comp.competitors || [])) {
          const abbr = c.team && c.team.abbreviation;
          if (abbr) teams[c.homeAway] = { abbr: String(abbr).toUpperCase(), score: c.score };
        }
        if (!teams.away || !teams.home) continue;
        if (teams.away.score == null || teams.home.score == null) continue;
        eventsByPair.set(teams.away.abbr + '@' + teams.home.abbr, teams);
      }
    }
    const setWinner = db.prepare('UPDATE games SET winner = ? WHERE id = ? AND winner IS NULL');
    let filled = 0;
    for (const g of undecided) {
      const key = (ESPN_ABBR[g.away_team] || '') + '@' + (ESPN_ABBR[g.home_team] || '');
      const ev = eventsByPair.get(key);
      if (!ev) continue;
      const awayScore = Number(ev.away.score);
      const homeScore = Number(ev.home.score);
      if (Number.isNaN(awayScore) || Number.isNaN(homeScore)) continue;
      if (awayScore === homeScore) continue; // a tie has no winner; leave it for the admin
      const winner = awayScore > homeScore ? g.away_team : g.home_team;
      if (setWinner.run(winner, g.id).changes) filled++;
    }
    if (filled) console.log('[results] auto-filled ' + filled + ' winner(s) for week ' + week.week_number);
  } catch (e) {
    console.log('[results] auto-fetch skipped: ' + (e && e.message ? e.message : e));
  }
}

// ------------------------------------------------------------------
// Automatic next-week seeding.
// After a week ends, the server creates the next week by itself from
// ESPN's public schedule feed — no upload, no hand-typed games. It runs
// on pool/standings loads, alongside the results auto-fetch.
// Safety rules (each one exists because of a real failure mode):
// - The new week is only INSERTED once its Tuesday open has arrived, so
//   a Monday-night load can never hide the just-finished week's final
//   standings behind the new week (there is no past-weeks view).
// - It only runs when the current week is finished: every game decided,
//   OR the last kickoff is more than 12 hours old (a tie leaves a winner
//   NULL forever, so the time fallback covers ties and postponements).
// - Regular season only (NFL Week 18 is the last auto-seed).
// - Never duplicates: returns early if the next week already exists.
// - Any failure is logged and ignored; the admin button retries it.
const ABBR_TO_TEAM = Object.fromEntries(Object.entries(ESPN_ABBR).map(([name, abbr]) => [abbr, name]));
let lastAutoSeedAt = 0;

function tzOffsetString(date, timeZone) {
  // Offset of the zone at this instant, as ±HH:MM. Rebuild the wall-clock
  // reading as if it were UTC and diff against the real instant.
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const parts = fmt.formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offsetMin = Math.round((asUTC - date.getTime()) / 60000);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  return sign + String(Math.floor(abs / 60)).padStart(2, '0') + ':' + String(abs % 60).padStart(2, '0');
}

function etKickoff(date) {
  // Kickoff in the manual seeds' format: ET-offset ISO plus an ET label
  // (e.g. 2026-11-05T20:15:00-05:00, 'Thu Nov 5, 8:15 PM ET'). The offset
  // matters: the results auto-fetch slices the date part as the ET date.
  const fmt12 = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  const p12 = fmt12.formatToParts(date);
  const get12 = (t) => p12.find((p) => p.type === t).value;
  const fmt24 = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p24 = fmt24.formatToParts(date);
  const get24 = (t) => p24.find((p) => p.type === t).value;
  const kickoff = `${get24('year')}-${get24('month')}-${get24('day')}T${get24('hour')}:${get24('minute')}:00${tzOffsetString(date, 'America/New_York')}`;
  const label = `${get12('weekday')} ${get12('month')} ${get12('day')}, ${get12('hour')}:${get12('minute')} ${get12('dayPeriod')} ET`;
  return { kickoff, label };
}

function chicagoWallToUTC(year, month, day, hour, minute) {
  // A Chicago wall-clock reading as a UTC ISO string, correct across
  // CDT/CST. Two passes: the offset at the first guess is already right
  // except within an hour of a DST switch, and the second pass fixes
  // even that.
  let utcMs = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 2; i++) {
    const off = tzOffsetString(new Date(utcMs), 'America/Chicago');
    const sign = off[0] === '-' ? -1 : 1;
    const [oh, om] = off.slice(1).split(':').map(Number);
    utcMs = Date.UTC(year, month - 1, day, hour, minute) - sign * (oh * 60 + om) * 60000;
  }
  return new Date(utcMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function weekWindow(firstKickoffMs) {
  // The pool's week: opens Tuesday, locks Thursday 12pm CT. Derive both
  // from the first game's ET date: step back to the Thursday of that
  // NFL week (weeks run Thursday–Monday), then two days further back.
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'short', day: 'numeric' });
  const parts = fmt.formatToParts(new Date(firstKickoffMs));
  const get = (t) => parts.find((p) => p.type === t).value;
  const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  let d = new Date(Date.UTC(Number(get('year')), months[get('month')], Number(get('day'))));
  const backToThu = (d.getUTCDay() + 7 - 4) % 7; // Thursday = 4
  d = new Date(d.getTime() - backToThu * 86400000);
  const thursday = d;
  const tuesday = new Date(d.getTime() - 2 * 86400000);
  return {
    open_at: chicagoWallToUTC(tuesday.getUTCFullYear(), tuesday.getUTCMonth() + 1, tuesday.getUTCDate(), 0, 0),
    lock_at: chicagoWallToUTC(thursday.getUTCFullYear(), thursday.getUTCMonth() + 1, thursday.getUTCDate(), 12, 0),
  };
}

async function maybeAutoSeedNextWeek(week, opts = {}) {
  try {
    const force = !!opts.force; // admin button: skips the finished-week check only
    if (week.nfl_week == null) return { ok: false, seeded: false, reason: 'current week has no NFL week number' };
    const nextNfl = week.nfl_week + 1;
    if (nextNfl > 18) return { ok: false, seeded: false, reason: 'regular season is over' };
    const nextApp = db.prepare('SELECT id FROM weeks WHERE season = ? AND week_number = ?').get(week.season, week.week_number + 1);
    if (nextApp) return { ok: false, seeded: false, reason: 'next week already exists' };
    const games = db.prepare('SELECT * FROM games WHERE week_id = ? ORDER BY kickoff, id').all(week.id);
    if (!games.length) return { ok: false, seeded: false, reason: 'current week has no games' };
    const allDecided = games.every((g) => g.winner);
    const lastKickoffMs = Math.max(...games.map((g) => new Date(g.kickoff).getTime()));
    const finaleOver = Date.now() > lastKickoffMs + 12 * 60 * 60 * 1000;
    if (!force && !allDecided && !finaleOver) return { ok: false, seeded: false, reason: 'current week is not finished' };
    if (!force) {
      const now = Date.now();
      if (now - lastAutoSeedAt < AUTO_FETCH_MIN_MS) return { ok: false, seeded: false, reason: 'throttled' };
      lastAutoSeedAt = now;
    }
    const res = await fetch(ESPN_BASE + '?seasontype=2&week=' + nextNfl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error('ESPN scoreboard HTTP ' + res.status);
    const data = await res.json();
    const byPair = new Map();
    for (const ev of (data.events || [])) {
      const comp = ev.competitions && ev.competitions[0];
      if (!comp || !ev.date) continue;
      const teams = {};
      for (const c of (comp.competitors || [])) {
        const abbr = c.team && c.team.abbreviation ? String(c.team.abbreviation).toUpperCase() : '';
        if (abbr && ABBR_TO_TEAM[abbr]) teams[c.homeAway] = ABBR_TO_TEAM[abbr];
      }
      if (!teams.away || !teams.home) continue;
      const key = teams.away + '@' + teams.home;
      if (!byPair.has(key)) byPair.set(key, { away: teams.away, home: teams.home, date: new Date(ev.date) });
    }
    if (!byPair.size) return { ok: false, seeded: false, reason: 'no games found for next week' };
    const list = [...byPair.values()].sort((a, b) => a.date - b.date);
    const { open_at, lock_at } = weekWindow(list[0].date.getTime());
    if (Date.now() < Date.parse(open_at)) return { ok: false, seeded: false, reason: 'next week has not opened yet' };
    const label = 'Week ' + nextNfl;
    db.exec('BEGIN');
    try {
      const w = db.prepare(
        'INSERT INTO weeks (season, week_number, nfl_week, open_at, lock_at, label, note) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(week.season, week.week_number + 1, nextNfl, open_at, lock_at, label, 'Auto-seeded from the NFL schedule.');
      const ins = db.prepare(
        'INSERT INTO games (week_id, away_team, home_team, kickoff, kickoff_label) VALUES (?, ?, ?, ?, ?)'
      );
      for (const g of list) {
        const k = etKickoff(g.date);
        ins.run(w.lastInsertRowid, g.away, g.home, k.kickoff, k.label);
      }
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      // A concurrent load seeded first: not an error, just already done.
      if (/UNIQUE constraint/.test(e.message || '')) return { ok: false, seeded: false, reason: 'next week already exists' };
      throw e;
    }
    console.log('[seed] auto-seeded ' + label + ' (' + list.length + ' games)');
    return { ok: true, seeded: true, label, gameCount: list.length };
  } catch (e) {
    console.log('[seed] auto-seed skipped: ' + (e && e.message ? e.message : e));
    return { ok: false, seeded: false, reason: 'fetch failed' };
  }
}

// Pool view data shared by every logged-in player.
function poolView(week) {
  const games = db.prepare('SELECT * FROM games WHERE week_id = ? ORDER BY kickoff, id').all(week.id);
  const users = db.prepare('SELECT id, username, name, is_admin FROM users ORDER BY username').all();
  const recordRows = db.prepare('SELECT team, wins, losses, ties FROM team_records').all();
  const recByTeam = new Map(recordRows.map((r) => [r.team, `${r.wins}-${r.losses}-${r.ties}`]));
  const partRows = db.prepare('SELECT user_id, status FROM participation WHERE week_id = ?').all(week.id);
  const partByUser = new Map(partRows.map((r) => [r.user_id, r.status]));
  const pickCounts = new Map(
    db.prepare('SELECT user_id, COUNT(*) AS n FROM picks WHERE game_id IN (SELECT id FROM games WHERE week_id = ?) GROUP BY user_id')
      .all(week.id).map((r) => [r.user_id, r.n])
  );
  const players = users.filter((u) => !u.is_admin).map((u) => ({
    id: u.id,
    username: u.username,
    name: u.name || null,
    status: partByUser.get(u.id) || 'no_response',
    pickCount: pickCounts.get(u.id) || 0,
  }));
  return {
    week: { season: week.season, week_number: week.week_number, label: week.label || null, note: week.note || null, open_at: week.open_at, lock_at: week.lock_at, status: weekStatus(week) },
    groupName: getSetting('group_name') || '',
    perPickAmount: Number(getSetting('per_pick_amount') || '0.50'),
    games: games.map((g) => ({ id: g.id, away: g.away_team, home: g.home_team, kickoffLabel: g.kickoff_label, winner: g.winner, awayRecord: recByTeam.get(g.away_team) || null, homeRecord: recByTeam.get(g.home_team) || null })),
    playing: players.filter((p) => p.status === 'playing'),
    notParticipating: players.filter((p) => p.status === 'not_participating'),
    noResponse: players.filter((p) => p.status === 'no_response'),
  };
}

// ------------------------------------------------------------------ routes
async function handleApi(req, res, url) {
  const pathName = url.pathname;

  // One-time admin password setup: only while the admin has no password.
  if (req.method === 'POST' && pathName === '/api/admin/setup') {
    const body = await readJson(req);
    const admin = db.prepare("SELECT password_hash FROM users WHERE username = 'admin'").get();
    if (!admin) return sendJson(res, 500, { error: 'Admin account missing' });
    if (admin.password_hash) return sendJson(res, 403, { error: 'Admin password already set' });
    if (!body.password || body.password.length < 4) {
      return sendJson(res, 400, { error: 'Password must be at least 4 characters' });
    }
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE username = 'admin'")
      .run(hashPassword(body.password, salt), salt);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathName === '/api/register') {
    const body = await readJson(req);
    const username = (body.username || '').trim();
    const name = (body.name || '').trim();
    const email = (body.email || '').trim().toLowerCase();
    if (!username || !name || !body.password || body.password.length < 4) {
      return sendJson(res, 400, { error: 'Full name, username, and a password of at least 4 characters are required' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJson(res, 400, { error: 'A valid email is required so a password reset link can be sent' });
    }
    if (username.toLowerCase() === 'admin') return sendJson(res, 400, { error: 'That username is reserved' });
    const salt = crypto.randomBytes(16).toString('hex');
    try {
      db.prepare('INSERT INTO users (username, name, email, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)')
        .run(username, name.slice(0, 80), email.slice(0, 120), hashPassword(body.password, salt), salt);
    } catch {
      const clash = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (clash) return sendJson(res, 409, { error: 'That email is already registered' });
      return sendJson(res, 409, { error: 'Username already taken' });
    }
    notifyRegistration(name.slice(0, 80), username);
    return sendJson(res, 201, { ok: true });
  }

  // Forgot username or password: send a one-hour reset link to the email
  // on file. Always answers ok (no account enumeration), except when
  // email sending itself is not configured — that is a global state, not
  // a hint about the address. The email includes the username and the
  // reset link, so one flow covers both "forgot username" and "forgot
  // password". Only the token hash is stored, never the raw token.
  if (req.method === 'POST' && pathName === '/api/forgot-password') {
    const body = await readJson(req);
    const email = (body.email || '').trim().toLowerCase();
    if (!email) return sendJson(res, 400, { error: 'Email is required' });
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return sendJson(res, 503, { error: 'Password reset emails are not set up yet — contact the admin' });
    }
    const user = db.prepare('SELECT id, username, email FROM users WHERE email = ?').get(email);
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
        .run(tokenHash, user.id, expiresAt);
      const host = req.headers.host || '';
      const proto = host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https';
      const link = `${proto}://${host}/reset.html?token=${token}`;
      const groupName = getSetting('group_name') || 'NFL Weekly Picks';
      try {
        await sendMail(user.email,
          `Reset your ${groupName} password`,
          `Hi ${user.username},\n\nYour username is: ${user.username}\n\nReset your password here (link works for 1 hour):\n${link}\n\nIf you did not ask for this, ignore this email — your password is unchanged.`);
      } catch (e) {
        db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(tokenHash);
        console.error('Password reset email failed:', e.message);
        return sendJson(res, 503, { error: 'Could not send the reset email — try again later' });
      }
    }
    return sendJson(res, 200, { ok: true });
  }

  // Consume a reset link: set a new password, invalidate the token, and
  // sign out all of the user's sessions.
  if (req.method === 'POST' && pathName === '/api/reset-password') {
    const body = await readJson(req);
    const token = body.token || '';
    const password = body.password || '';
    if (!token || !password || password.length < 4) {
      return sendJson(res, 400, { error: 'A valid reset link and a password of at least 4 characters are required' });
    }
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const row = db.prepare('SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?').get(tokenHash);
    if (!row || new Date(row.expires_at) < new Date()) {
      return sendJson(res, 400, { error: 'This reset link is invalid or has expired' });
    }
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
      .run(hashPassword(password, salt), salt, row.user_id);
    db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(tokenHash);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathName === '/api/login') {
    const body = await readJson(req);
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get((body.username || '').trim());
    if (!user || !user.password_hash || hashPassword(body.password || '', user.password_salt) !== user.password_hash) {
      return sendJson(res, 401, { error: 'Invalid username or password' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, expires);
    res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; Max-Age=${30 * 24 * 3600}; SameSite=Lax`);
    return sendJson(res, 200, { ok: true, user: { id: user.id, username: user.username, name: user.name || null, isAdmin: !!user.is_admin } });
  }

  if (req.method === 'POST' && pathName === '/api/logout') {
    const user = getUserFromRequest(req);
    if (user) {
      const cookie = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith('session='));
      if (cookie) db.prepare('DELETE FROM sessions WHERE token = ?').run(decodeURIComponent(cookie.slice(8)));
    }
    res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0');
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathName === '/api/me') {
    const user = requireUser(req, res);
    if (!user) return;
    return sendJson(res, 200, { user: { id: user.id, username: user.username, name: user.name || null, email: user.email || null, isAdmin: !!user.is_admin } });
  }

  // One-time name prompt for accounts created before names existed.
  if (req.method === 'POST' && pathName === '/api/me/name') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const name = (body.name || '').trim();
    if (!name) return sendJson(res, 400, { error: 'Name is required' });
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.slice(0, 80), user.id);
    return sendJson(res, 200, { ok: true, name: name.slice(0, 80) });
  }

  // One-time email prompt for accounts created before emails were
  // recorded, so older players can use password resets too.
  if (req.method === 'POST' && pathName === '/api/me/email') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const email = (body.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJson(res, 400, { error: 'A valid email is required' });
    }
    try {
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email.slice(0, 120), user.id);
    } catch {
      return sendJson(res, 409, { error: 'That email is already registered' });
    }
    return sendJson(res, 200, { ok: true, email: email.slice(0, 120) });
  }

  // Public landing-page info: no sign-in needed, so the front page can
  // show the group name, current week, lock time, and cost before login.
  if (req.method === 'GET' && pathName === '/api/public-info') {
    const week = currentWeek();
    const gameCount = db.prepare('SELECT COUNT(*) AS n FROM games WHERE week_id = ?').get(week.id).n;
    const perPick = Number(getSetting('per_pick_amount') || '0.50');
    return sendJson(res, 200, {
      groupName: getSetting('group_name') || '',
      perPickAmount: perPick,
      gameCount,
      fullSheetAmount: +(perPick * gameCount).toFixed(2),
      week: { season: week.season, week_number: week.week_number, label: week.label || null, note: week.note || null, open_at: week.open_at, lock_at: week.lock_at, status: weekStatus(week) },
    });
  }

  if (req.method === 'GET' && pathName === '/api/pool') {
    const user = requireUser(req, res);
    if (!user) return;
    let week = currentWeek();
    await maybeAutoFetchResults(week);
    const seeded = await maybeAutoSeedNextWeek(week);
    if (seeded.seeded) week = currentWeek();
    return sendJson(res, 200, poolView(week));
  }

  if (req.method === 'POST' && pathName === '/api/participation') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    if (!['playing', 'not_participating'].includes(body.status)) {
      return sendJson(res, 400, { error: 'Invalid status' });
    }
    const week = currentWeek();
    db.prepare(`INSERT INTO participation (user_id, week_id, status) VALUES (?, ?, ?)
      ON CONFLICT(user_id, week_id) DO UPDATE SET status = excluded.status`)
      .run(user.id, week.id, body.status);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathName === '/api/my-picks') {
    const user = requireUser(req, res);
    if (!user) return;
    const week = currentWeek();
    const rows = db.prepare(
      'SELECT game_id, team FROM picks WHERE user_id = ? AND game_id IN (SELECT id FROM games WHERE week_id = ?)'
    ).all(user.id, week.id);
    return sendJson(res, 200, { picks: Object.fromEntries(rows.map((r) => [r.game_id, r.team])) });
  }

  if (req.method === 'POST' && pathName === '/api/picks') {
    const user = requireUser(req, res);
    if (!user) return;
    const week = currentWeek();
    if (weekStatus(week) !== 'open') {
      return sendJson(res, 403, { error: `Picks are ${weekStatus(week) === 'locked' ? 'locked' : 'not open yet'} for this week` });
    }
    const part = db.prepare('SELECT status FROM participation WHERE user_id = ? AND week_id = ?').get(user.id, week.id);
    if (!part || part.status !== 'playing') {
      return sendJson(res, 403, { error: 'Mark yourself as playing before submitting picks' });
    }
    const body = await readJson(req);
    const picks = body.picks || [];
    const gameIds = new Set(db.prepare('SELECT id, away_team, home_team FROM games WHERE week_id = ?').all(week.id)
      .map((g) => g.id));
    const valid = new Map(db.prepare('SELECT id, away_team, home_team FROM games WHERE week_id = ?').all(week.id)
      .map((g) => [g.id, [g.away_team, g.home_team]]));
    const upsert = db.prepare(`INSERT INTO picks (user_id, game_id, team) VALUES (?, ?, ?)
      ON CONFLICT(user_id, game_id) DO UPDATE SET team = excluded.team`);
    for (const p of picks) {
      if (!gameIds.has(p.game_id)) return sendJson(res, 400, { error: 'Unknown game' });
      if (!valid.get(p.game_id).includes(p.team)) return sendJson(res, 400, { error: 'Invalid team for game' });
      upsert.run(user.id, p.game_id, p.team);
    }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathName === '/api/standings') {
    const user = requireUser(req, res);
    if (!user) return;
    let week = currentWeek();
    await maybeAutoFetchResults(week);
    const seeded = await maybeAutoSeedNextWeek(week);
    if (seeded.seeded) week = currentWeek();
    const games = db.prepare('SELECT id, winner FROM games WHERE week_id = ?').all(week.id);
    const decided = games.filter((g) => g.winner);
    const users = db.prepare('SELECT id, username, name FROM users WHERE is_admin = 0 ORDER BY username').all();
    const wager = Number(getSetting('per_pick_amount') || '0.50');
    const rows = users.map((u) => {
      const picks = db.prepare('SELECT game_id, team FROM picks WHERE user_id = ?').all(u.id);
      const wins = picks.filter((p) => {
        const g = games.find((x) => x.id === p.game_id);
        return g && g.winner && g.winner === p.team;
      }).length;
      const paidRow = db.prepare('SELECT paid FROM payments WHERE user_id = ? AND week_id = ?').get(u.id, week.id);
      return { id: u.id, username: u.username, name: u.name || null, wins, pickCount: picks.filter((p) => games.some((g) => g.id === p.game_id)).length, owed: +(picks.filter((p) => games.some((g) => g.id === p.game_id)).length * wager).toFixed(2), paid: !!(paidRow && paidRow.paid) };
    });
    rows.sort((a, b) => b.wins - a.wins || a.username.localeCompare(b.username));
    const topWins = rows.length && decided.length ? Math.max(...rows.map((r) => r.wins)) : null;
    const winners = topWins !== null ? rows.filter((r) => r.wins === topWins) : [];
    const pot = +rows.reduce((sum, r) => sum + r.owed, 0).toFixed(2);
    const share = winners.length ? +(pot / winners.length).toFixed(2) : 0;
    return sendJson(res, 200, {
      week: { season: week.season, week_number: week.week_number, label: week.label || null },
      decidedGames: decided.length, totalGames: games.length,
      standings: rows, winners: winners.map((w) => w.username), pot, sharePerWinner: share,
    });
  }

  // ------------------------------------------------------------- admin
  if (req.method === 'GET' && pathName === '/api/admin/overview') {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const week = currentWeek();
    const view = poolView(week);
    const users = db.prepare('SELECT id, username, name, email FROM users WHERE is_admin = 0 ORDER BY username').all();
    const wager = Number(getSetting('per_pick_amount') || '0.50');
    const games = db.prepare('SELECT * FROM games WHERE week_id = ? ORDER BY kickoff, id').all(week.id);
    const players = users.map((u) => {
      const part = db.prepare('SELECT status FROM participation WHERE user_id = ? AND week_id = ?').get(u.id, week.id);
      const picks = db.prepare('SELECT game_id, team FROM picks WHERE user_id = ?').all(u.id)
        .filter((p) => games.some((g) => g.id === p.game_id));
      const paidRow = db.prepare('SELECT paid FROM payments WHERE user_id = ? AND week_id = ?').get(u.id, week.id);
      return {
        id: u.id, username: u.username, name: u.name || null, email: u.email || null,
        status: part ? part.status : 'no_response',
        picks: Object.fromEntries(picks.map((p) => [p.game_id, p.team])),
        pickCount: picks.length,
        owed: +(picks.length * wager).toFixed(2),
        paid: !!(paidRow && paidRow.paid),
      };
    });
    const collected = +players.filter((p) => p.paid).reduce((s, p) => s + p.owed, 0).toFixed(2);
    const owedTotal = +players.reduce((s, p) => s + p.owed, 0).toFixed(2);
    return sendJson(res, 200, {
      groupName: view.groupName, perPickAmount: wager,
      games: games.map((g) => ({ id: g.id, away: g.away_team, home: g.home_team, kickoffLabel: g.kickoff_label, winner: g.winner })),
      players, collected, owedTotal, stillOwed: +(owedTotal - collected).toFixed(2),
    });
  }

  if (req.method === 'POST' && pathName === '/api/admin/settings') {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const body = await readJson(req);
    if (typeof body.group_name === 'string') setSetting('group_name', body.group_name.trim().slice(0, 60));
    if (body.per_pick_amount !== undefined) {
      const n = Number(body.per_pick_amount);
      if (!Number.isFinite(n) || n < 0 || n > 100) return sendJson(res, 400, { error: 'Invalid per-pick amount' });
      setSetting('per_pick_amount', n.toFixed(2));
    }
    return sendJson(res, 200, { ok: true, groupName: getSetting('group_name'), perPickAmount: getSetting('per_pick_amount') });
  }

  if (req.method === 'POST' && pathName === '/api/admin/payments') {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const body = await readJson(req);
    const week = currentWeek();
    const target = db.prepare('SELECT id FROM users WHERE id = ? AND is_admin = 0').get(body.user_id);
    if (!target) return sendJson(res, 404, { error: 'Player not found' });
    db.prepare(`INSERT INTO payments (user_id, week_id, paid) VALUES (?, ?, ?)
      ON CONFLICT(user_id, week_id) DO UPDATE SET paid = excluded.paid`)
      .run(body.user_id, week.id, body.paid ? 1 : 0);
    return sendJson(res, 200, { ok: true });
  }

  // Admin-only player removal. Deletes the player account and everything
  // tied to it (picks, participation, payments, sessions) in one
  // transaction. Used for test accounts and players who never play.
  // A removed person can re-register while registration stays open.
  if (req.method === 'POST' && pathName === '/api/admin/remove-player') {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const body = await readJson(req);
    const target = db.prepare('SELECT id, username FROM users WHERE id = ? AND is_admin = 0').get(body.user_id);
    if (!target) return sendJson(res, 404, { error: 'Player not found' });
    try {
      db.exec('BEGIN');
      db.prepare('DELETE FROM picks WHERE user_id = ?').run(target.id);
      db.prepare('DELETE FROM participation WHERE user_id = ?').run(target.id);
      db.prepare('DELETE FROM payments WHERE user_id = ?').run(target.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      return sendJson(res, 500, { error: 'Remove failed' });
    }
    return sendJson(res, 200, { ok: true, username: target.username });
  }

  // Admin fallback for automatic seeding: seed the next week from ESPN
  // now. Same safety gates as the automatic path, except the finished-
  // week check is skipped — the Tuesday-open gate still applies, so this
  // can never hide a live week early.
  if (req.method === 'POST' && pathName === '/api/admin/seed-next-week') {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const week = currentWeek();
    const result = await maybeAutoSeedNextWeek(week, { force: true });
    return sendJson(res, 200, result);
  }

  // Team season records shown under each team on the pick sheet.
  // Admin-only. Records do NOT auto-update from results; edit here.
  if (req.method === 'GET' && pathName === '/api/admin/records') {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const rows = db.prepare('SELECT team, wins, losses, ties FROM team_records ORDER BY team').all();
    return sendJson(res, 200, { records: rows });
  }

  if (req.method === 'POST' && pathName === '/api/admin/records') {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const body = await readJson(req);
    const team = (body.team || '').trim();
    const wins = Number(body.wins), losses = Number(body.losses), ties = Number(body.ties);
    if (!team || ![wins, losses, ties].every((n) => Number.isInteger(n) && n >= 0 && n <= 30)) {
      return sendJson(res, 400, { error: 'Team and whole-number records (0-30) are required' });
    }
    db.prepare(`INSERT INTO team_records (team, wins, losses, ties) VALUES (?, ?, ?, ?)
      ON CONFLICT(team) DO UPDATE SET wins = excluded.wins, losses = excluded.losses, ties = excluded.ties`)
      .run(team.slice(0, 40), wins, losses, ties);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathName === '/api/admin/results') {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const body = await readJson(req);
    const game = db.prepare('SELECT id, away_team, home_team FROM games WHERE id = ?').get(body.game_id);
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    if (body.winner !== null && ![game.away_team, game.home_team].includes(body.winner)) {
      return sendJson(res, 400, { error: 'Winner must be one of the two teams' });
    }
    db.prepare('UPDATE games SET winner = ? WHERE id = ?').run(body.winner, body.game_id);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

// ------------------------------------------------------------- static files
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serveStatic(req, res, url) {
  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`NFL Weekly Picks running at http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Registration emails: ${process.env.SMTP_USER && process.env.SMTP_PASS ? `enabled → ${NOTIFY_EMAIL}` : 'disabled (set SMTP_USER and SMTP_PASS to enable)'}`);
  const admin = db.prepare("SELECT password_hash FROM users WHERE username = 'admin'").get();
  if (!admin || !admin.password_hash) {
    console.log('Admin account "admin" has no password yet. Set it with ADMIN_PASSWORD on first run, or POST /api/admin/setup once.');
  }
});
