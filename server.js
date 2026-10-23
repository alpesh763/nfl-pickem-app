// NFL Weekly Picks — real multi-player pool app.
// Zero-dependency Node.js server (built-in http + node:sqlite + crypto).
// One shared SQLite database, so every player sees the same pool state
// and everything flows back to the admin.
//
// Money is TRACKING ONLY. No real payments are processed here — players
// settle outside the app. Stripe, PayPal, Venmo and Cash App prohibit
// gambling pools in their terms, so this app never touches real money.
//
// Run:  node server.js            (defaults: PORT=3000, data in ./pickem.db)
// Env:  PORT, DB_PATH, ADMIN_PASSWORD (sets the admin password on first
//       run if the admin account has no password yet).

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

// ---------------------------------------------------------------- schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    password_salt TEXT,
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
  const existing = db.prepare('SELECT id FROM weeks WHERE season = 2026 AND week_number = 7').get();
  if (!existing) {
    const w = db.prepare(
      "INSERT INTO weeks (season, week_number, open_at, lock_at) VALUES (2026, 7, '2026-10-20T05:00:00Z', '2026-10-22T22:00:00Z')"
    ).run();
    const ins = db.prepare(
      'INSERT INTO games (week_id, away_team, home_team, kickoff, kickoff_label) VALUES (?, ?, ?, ?, ?)'
    );
    for (const [away, home, kickoff, label] of WEEK7_GAMES) {
      ins.run(w.lastInsertRowid, away, home, kickoff, label);
    }
  }
  // Mini test week: Sunday + Monday games only (Oct 25-26), so the app
  // can be tested live before full Week 8. Locks Sun Oct 25 at 8:00 AM
  // Central, 30 minutes before the first kickoff (Steelers-Saints, Paris).
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
      "INSERT INTO weeks (season, week_number, open_at, lock_at, label, note) VALUES (2026, 8, '2026-10-22T23:00:00Z', '2026-10-25T13:00:00Z', 'Mini Test — Oct 25–26', 'Mini test week — Sunday and Monday games only.')"
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
  return db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(sess.user_id) || null;
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

// Pool view data shared by every logged-in player.
function poolView(week) {
  const games = db.prepare('SELECT * FROM games WHERE week_id = ? ORDER BY kickoff, id').all(week.id);
  const users = db.prepare('SELECT id, username, is_admin FROM users ORDER BY username').all();
  const partRows = db.prepare('SELECT user_id, status FROM participation WHERE week_id = ?').all(week.id);
  const partByUser = new Map(partRows.map((r) => [r.user_id, r.status]));
  const pickCounts = new Map(
    db.prepare('SELECT user_id, COUNT(*) AS n FROM picks WHERE game_id IN (SELECT id FROM games WHERE week_id = ?) GROUP BY user_id')
      .all(week.id).map((r) => [r.user_id, r.n])
  );
  const players = users.filter((u) => !u.is_admin).map((u) => ({
    id: u.id,
    username: u.username,
    status: partByUser.get(u.id) || 'no_response',
    pickCount: pickCounts.get(u.id) || 0,
  }));
  return {
    week: { season: week.season, week_number: week.week_number, label: week.label || null, note: week.note || null, open_at: week.open_at, lock_at: week.lock_at, status: weekStatus(week) },
    groupName: getSetting('group_name') || '',
    perPickAmount: Number(getSetting('per_pick_amount') || '0.50'),
    games: games.map((g) => ({ id: g.id, away: g.away_team, home: g.home_team, kickoffLabel: g.kickoff_label, winner: g.winner })),
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
    if (!username || !body.password || body.password.length < 4) {
      return sendJson(res, 400, { error: 'Username and a password of at least 4 characters are required' });
    }
    if (username.toLowerCase() === 'admin') return sendJson(res, 400, { error: 'That username is reserved' });
    const salt = crypto.randomBytes(16).toString('hex');
    try {
      db.prepare('INSERT INTO users (username, password_hash, password_salt) VALUES (?, ?, ?)')
        .run(username, hashPassword(body.password, salt), salt);
    } catch {
      return sendJson(res, 409, { error: 'Username already taken' });
    }
    return sendJson(res, 201, { ok: true });
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
    return sendJson(res, 200, { ok: true, user: { id: user.id, username: user.username, isAdmin: !!user.is_admin } });
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
    return sendJson(res, 200, { user: { id: user.id, username: user.username, isAdmin: !!user.is_admin } });
  }

  if (req.method === 'GET' && pathName === '/api/pool') {
    const user = requireUser(req, res);
    if (!user) return;
    return sendJson(res, 200, poolView(currentWeek()));
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
    const week = currentWeek();
    const games = db.prepare('SELECT id, winner FROM games WHERE week_id = ?').all(week.id);
    const decided = games.filter((g) => g.winner);
    const users = db.prepare('SELECT id, username FROM users WHERE is_admin = 0 ORDER BY username').all();
    const wager = Number(getSetting('per_pick_amount') || '0.50');
    const rows = users.map((u) => {
      const picks = db.prepare('SELECT game_id, team FROM picks WHERE user_id = ?').all(u.id);
      const wins = picks.filter((p) => {
        const g = games.find((x) => x.id === p.game_id);
        return g && g.winner && g.winner === p.team;
      }).length;
      const paidRow = db.prepare('SELECT paid FROM payments WHERE user_id = ? AND week_id = ?').get(u.id, week.id);
      return { id: u.id, username: u.username, wins, pickCount: picks.filter((p) => games.some((g) => g.id === p.game_id)).length, owed: +(picks.filter((p) => games.some((g) => g.id === p.game_id)).length * wager).toFixed(2), paid: !!(paidRow && paidRow.paid) };
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
    const users = db.prepare('SELECT id, username FROM users WHERE is_admin = 0 ORDER BY username').all();
    const wager = Number(getSetting('per_pick_amount') || '0.50');
    const games = db.prepare('SELECT * FROM games WHERE week_id = ? ORDER BY kickoff, id').all(week.id);
    const players = users.map((u) => {
      const part = db.prepare('SELECT status FROM participation WHERE user_id = ? AND week_id = ?').get(u.id, week.id);
      const picks = db.prepare('SELECT game_id, team FROM picks WHERE user_id = ?').all(u.id)
        .filter((p) => games.some((g) => g.id === p.game_id));
      const paidRow = db.prepare('SELECT paid FROM payments WHERE user_id = ? AND week_id = ?').get(u.id, week.id);
      return {
        id: u.id, username: u.username,
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
  const admin = db.prepare("SELECT password_hash FROM users WHERE username = 'admin'").get();
  if (!admin || !admin.password_hash) {
    console.log('Admin account "admin" has no password yet. Set it with ADMIN_PASSWORD on first run, or POST /api/admin/setup once.');
  }
});
