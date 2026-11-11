// NFL Weekly Picks frontend — vanilla JS against the /api routes.
'use strict';

const $ = (id) => document.getElementById(id);
let me = null;
let pool = null;
let myPicks = {};
let nbaPool = null;
let nbaPicks = {};
let nbaStandingsWeekId = null;

// NFL team nickname -> ESPN logo abbreviation (logos via ESPN's public team-logo CDN).
const TEAM_ABBR = {
  '49ers': 'sf', Bears: 'chi', Bengals: 'cin', Bills: 'buf', Broncos: 'den', Browns: 'cle',
  Buccaneers: 'tb', Cardinals: 'ari', Chargers: 'lac', Chiefs: 'kc', Colts: 'ind', Commanders: 'wsh',
  Cowboys: 'dal', Dolphins: 'mia', Eagles: 'phi', Falcons: 'atl', Giants: 'nyg', Jaguars: 'jax',
  Jets: 'nyj', Lions: 'det', Packers: 'gb', Panthers: 'car', Patriots: 'ne', Raiders: 'lv',
  Rams: 'lar', Ravens: 'bal', Saints: 'no', Seahawks: 'sea', Steelers: 'pit', Texans: 'hou',
  Titans: 'ten', Vikings: 'min',
};
const teamLogoUrl = (team) => 'https://a.espncdn.com/i/teamlogos/nfl/500/' + (TEAM_ABBR[team] || '') + '.png';

// NBA team nickname -> ESPN logo abbreviation (same public CDN, nba path).
const NBA_TEAM_LOGO = {
  Hawks: 'atl', Celtics: 'bos', Nets: 'bkn', Hornets: 'cha', Bulls: 'chi',
  Cavaliers: 'cle', Mavericks: 'dal', Nuggets: 'den', Pistons: 'det', Warriors: 'gs',
  Rockets: 'hou', Pacers: 'ind', Clippers: 'lac', Lakers: 'lal', Grizzlies: 'mem',
  Heat: 'mia', Bucks: 'mil', Timberwolves: 'min', Pelicans: 'no', Knicks: 'ny',
  Thunder: 'okc', Magic: 'orl', '76ers': 'phi', Suns: 'phx', 'Trail Blazers': 'por',
  Kings: 'sac', Spurs: 'sa', Raptors: 'tor', Jazz: 'utah', Wizards: 'was',
};
const nbaTeamLogoUrl = (team) => 'https://a.espncdn.com/i/teamlogos/nba/500/' + (NBA_TEAM_LOGO[team] || '') + '.png';
let currentTab = 'pool';

async function api(path, method, body) {
  const res = await fetch(path, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function show(viewId) {
  for (const id of ['authView', 'appView']) $(id).classList.toggle('hidden', id !== viewId);
}
function showTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + tab));
  if (tab === 'pool') loadPool();
  if (tab === 'picks') loadPicks();
  if (tab === 'standings') loadStandings();
  if (tab === 'money') loadMoney();
  if (tab === 'nba') loadNba();
  if (tab === 'admin') loadAdmin();
}

function fmtMoney(n) { return '$' + Number(n).toFixed(2); }
function displayName(p) { return p.name ? p.name + ' (' + p.username + ')' : p.username; }
function fmtLock(iso) {
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT';
}

async function refreshMe() {
  try {
    const data = await api('/api/me');
    me = data.user;
    $('whoAmI').textContent = displayName(me) + (me.isAdmin ? ' (Admin)' : '');
    $('userBar').classList.remove('hidden');
    $('adminTabBtn').classList.toggle('hidden', !me.isAdmin);
    // One-time prompt for accounts created before names existed.
    $('namePrompt').classList.toggle('hidden', !(!me.isAdmin && !me.name));
    // One-time prompt for accounts created before emails were recorded.
    $('emailPrompt').classList.toggle('hidden', !(!me.isAdmin && !me.email));
    show('appView');
    return true;
  } catch {
    me = null;
    show('authView');
    return false;
  }
}

async function loadPool() {
  pool = await api('/api/pool');
  const title = 'NFL WEEKLY PICKS' + (pool.groupName ? ' — ' + pool.groupName : '');
  $('appTitle').textContent = title;
  $('weekHeading').textContent = pool.week.label
    ? pool.week.label + ' — ' + pool.week.season + ' season'
    : 'Week ' + pool.week.week_number + ' — ' + pool.week.season + ' season';
  $('poolNote').textContent = pool.week.note || 'Picks open Tuesday. All picks lock Thursday at 12:00 PM Central.';
  $('lockLine').textContent = 'Picks lock ' + fmtLock(pool.week.lock_at) + ' · Status: ' + pool.week.status;
  const render = (el, list) => {
    $(el).innerHTML = list.length
      ? list.map((p) => '<li>' + displayName(p) + ' (' + p.pickCount + ' picks)</li>').join('')
      : '<li class="muted">Nobody yet</li>';
  };
  render('playingList', pool.playing);
  render('notPartList', pool.notParticipating);
  render('noRespList', pool.noResponse);
  // Highlight the button matching YOUR current choice, so it's obvious at a
  // glance whether you're playing or sitting out. (Previously "I'm playing"
  // was always orange and "Not participating" never was, so a
  // not-participating choice looked unconfirmed.)
  const myStatus = me && (pool.playing.some((p) => p.id === me.id) ? 'playing'
    : pool.notParticipating.some((p) => p.id === me.id) ? 'not_participating' : null);
  $('playBtn').classList.toggle('primary', myStatus === 'playing');
  $('skipBtn').classList.toggle('primary', myStatus === 'not_participating');
}

async function loadPicks() {
  if (!pool) pool = await api('/api/pool');
  myPicks = (await api('/api/my-picks')).picks;
  const locked = pool.week.status !== 'open';
  $('pickLockNote').classList.toggle('hidden', !locked);
  $('savePicksBtn').disabled = locked;
  $('pickCostLine').textContent = 'Each pick costs ' + fmtMoney(pool.perPickAmount) + '. Full sheet (' + pool.games.length + ' picks) = ' + fmtMoney(pool.perPickAmount * pool.games.length) + '.';
  $('gamesList').innerHTML = pool.games.map((g) => {
    const sel = myPicks[g.id] || '';
    const pickBtn = (team, rec) => {
      const abbr = TEAM_ABBR[team];
      const img = abbr ? '<img class="teamLogo" src="' + teamLogoUrl(team) + '" alt="" onerror="this.style.display=\'none\'">' : '';
      return '<button type="button" class="pickBtn' + (sel === team ? ' selected' : '') + '" data-game="' + g.id + '" data-team="' + team + '" ' + (locked ? 'disabled' : '') + '>' + img +
        '<span class="team"><b>' + team + '</b>' + (rec ? '<span class="record">' + rec + '</span>' : '') + '</span></button>';
    };
    return '<div class="game-row"><div class="kick">' + g.kickoffLabel + (g.winner ? ' · Winner: ' + g.winner : '') + '</div>' +
      '<div class="pickMatchup">' + pickBtn(g.away, g.awayRecord) + '<span class="vs">vs</span>' + pickBtn(g.home, g.homeRecord) + '</div></div>';
  }).join('');
  // Tap a team to pick it; tap the picked team again to clear it.
  document.querySelectorAll('.pickBtn').forEach((btn) => btn.addEventListener('click', () => {
    const gid = btn.dataset.game;
    const team = btn.dataset.team;
    if (myPicks[gid] === team) {
      delete myPicks[gid];
      btn.classList.remove('selected');
    } else {
      myPicks[gid] = team;
      document.querySelectorAll('.pickBtn[data-game="' + gid + '"]').forEach((b) => b.classList.toggle('selected', b === btn));
    }
  }));
}

// Standings for the selected week. Defaults to the current week; the
// selector lists every week, newest first, and remembers the choice
// while the tab is revisited. The winner line sits above the table so
// the week's winner is unmistakable, not something to work out from
// the rows. For a past week the week is final, so the top-wins
// player(s) are the winner(s) even if a tied game left one game
// undecided — ties list every tied player, since ties split the pot.
// For the current week the old rule stays: no winner line until every
// game is decided, so a mid-week leader is never shown as the winner.
let standingsWeekId = null;

async function loadStandings(weekId) {
  const { weeks, currentWeekId } = await api('/api/weeks');
  const sel = $('standingsWeekSelect');
  const keep = weekId !== undefined ? weekId : (standingsWeekId !== null ? standingsWeekId : currentWeekId);
  sel.innerHTML = weeks.map((w) => {
    const name = w.label || ('Week ' + w.week_number);
    return '<option value="' + w.id + '"' + (w.id === keep ? ' selected' : '') + '>' + name + (w.isCurrent ? ' (current)' : '') + '</option>';
  }).join('');
  const chosen = weeks.some((w) => w.id === keep) ? keep : currentWeekId;
  standingsWeekId = chosen;
  sel.value = String(chosen);
  const data = await api('/api/standings?week_id=' + chosen);
  $('standingsLine').textContent = (data.week.label || 'Week ' + data.week.week_number) + ' · ' + data.decidedGames + ' of ' + data.totalGames + ' games decided.';
  document.querySelector('#standingsTable tbody').innerHTML = data.standings.map((s) =>
    '<tr><td>' + displayName(s) + '</td><td>' + s.wins + '</td><td>' + s.pickCount + '</td></tr>').join('');
  const showWinner = data.winners.length && (!data.week.isCurrent || data.decidedGames === data.totalGames);
  if (showWinner) {
    const winnerNames = data.winners.map((un) => {
      const row = data.standings.find((s) => s.username === un);
      return row ? displayName(row) : un;
    });
    $('winnerLine').classList.remove('hidden');
    $('winnerLine').textContent = 'Winner' + (data.winners.length > 1 ? 's (tie — pot split)' : '') + ': ' + winnerNames.join(', ') +
      ' · Pot ' + fmtMoney(data.pot) + ' · ' + fmtMoney(data.sharePerWinner) + ' each.';
  } else {
    $('winnerLine').classList.add('hidden');
  }
}

async function loadMoney() {
  const data = await api('/api/standings');
  const mine = data.standings.find((s) => s.id === me.id);
  $('myMoneyLine').textContent = mine
    ? 'Your sheet: ' + mine.pickCount + ' picks · ' + fmtMoney(mine.owed) + ' owed · ' + (mine.paid ? 'Paid ✓' : 'Not paid yet')
    : 'You have no picks this week.';
  const collected = data.standings.filter((s) => s.paid).reduce((s, x) => s + x.owed, 0);
  const owed = data.standings.reduce((s, x) => s + x.owed, 0);
  $('poolMoneyLine').textContent = 'Pool total: ' + fmtMoney(collected) + ' collected of ' + fmtMoney(owed) + ' owed.';
}

// NBA tab: pool + pick sheet + standings + money in one pane, mirroring
// the NFL tabs but against the /api/nba/* routes. Before the first slate
// opens (Tue Nov 10) the pool endpoint 404s; show that instead of
// breaking the tab.
async function loadNba() {
  let data;
  try {
    data = await api('/api/nba/pool');
  } catch (e) {
    $('nbaWeekHeading').textContent = 'NBA starts Tuesday Nov 10';
    $('nbaLockLine').textContent = e.message || '';
    $('nbaPoolNote').textContent = 'First slate: Thu Nov 12 – Mon Nov 16, 2026. Picks open Tuesday, lock Thursday at 12:00 PM Central.';
    $('nbaPickCostLine').textContent = '';
    $('nbaGamesList').innerHTML = '';
    $('nbaStandingsLine').textContent = '';
    document.querySelector('#nbaStandingsTable tbody').innerHTML = '';
    $('nbaMyMoneyLine').textContent = '';
    $('nbaPoolMoneyLine').textContent = '';
    return;
  }
  nbaPool = data;
  $('nbaWeekHeading').textContent = (nbaPool.week.label || 'NBA') + ' — ' + nbaPool.week.season + ' season';
  $('nbaLockLine').textContent = 'Picks lock ' + fmtLock(nbaPool.week.lock_at) + ' · Status: ' + nbaPool.week.status;
  $('nbaPoolNote').textContent = nbaPool.week.note || 'Picks open Tuesday. All picks lock Thursday at 12:00 PM Central.';
  const render = (el, list) => {
    $(el).innerHTML = list.length
      ? list.map((p) => '<li>' + displayName(p) + ' (' + p.pickCount + ' picks)</li>').join('')
      : '<li class="muted">Nobody yet</li>';
  };
  render('nbaPlayingList', nbaPool.playing);
  render('nbaNotPartList', nbaPool.notParticipating);
  render('nbaNoRespList', nbaPool.noResponse);
  const myStatus = me && (nbaPool.playing.some((p) => p.id === me.id) ? 'playing'
    : nbaPool.notParticipating.some((p) => p.id === me.id) ? 'not_participating' : null);
  $('nbaPlayBtn').classList.toggle('primary', myStatus === 'playing');
  $('nbaSkipBtn').classList.toggle('primary', myStatus === 'not_participating');
  // Pick sheet.
  nbaPicks = (await api('/api/nba/my-picks')).picks;
  const locked = nbaPool.week.status !== 'open';
  $('nbaPickLockNote').classList.toggle('hidden', !locked);
  $('nbaSavePicksBtn').disabled = locked;
  $('nbaPickCostLine').textContent = 'Each pick costs ' + fmtMoney(nbaPool.perPickAmount) + '. Full sheet (' + nbaPool.games.length + ' picks) = ' + fmtMoney(nbaPool.perPickAmount * nbaPool.games.length) + '.';
  $('nbaGamesList').innerHTML = nbaPool.games.map((g) => {
    const sel = nbaPicks[g.id] || '';
    const pickBtn = (team, rec) => {
      const abbr = NBA_TEAM_LOGO[team];
      const img = abbr ? '<img class="teamLogo" src="' + nbaTeamLogoUrl(team) + '" alt="" onerror="this.style.display=\'none\'">' : '';
      return '<button type="button" class="pickBtn nbaPickBtn' + (sel === team ? ' selected' : '') + '" data-game="' + g.id + '" data-team="' + team + '" ' + (locked ? 'disabled' : '') + '>' + img +
        '<span class="team"><b>' + team + '</b>' + (rec ? '<span class="record">' + rec + '</span>' : '') + '</span></button>';
    };
    return '<div class="game-row"><div class="kick">' + g.kickoffLabel + (g.winner ? ' · Winner: ' + g.winner : '') + '</div>' +
      '<div class="pickMatchup">' + pickBtn(g.away, g.awayRecord) + '<span class="vs">vs</span>' + pickBtn(g.home, g.homeRecord) + '</div></div>';
  }).join('');
  // Tap a team to pick it; tap the picked team again to clear it.
  document.querySelectorAll('.nbaPickBtn').forEach((btn) => btn.addEventListener('click', () => {
    const gid = btn.dataset.game;
    const team = btn.dataset.team;
    if (nbaPicks[gid] === team) {
      delete nbaPicks[gid];
      btn.classList.remove('selected');
    } else {
      nbaPicks[gid] = team;
      document.querySelectorAll('.nbaPickBtn[data-game="' + gid + '"]').forEach((b) => b.classList.toggle('selected', b === btn));
    }
  }));
  await loadNbaStandings();
  // Money (from the current week's standings payload).
  const standings = await api('/api/nba/standings');
  const mine = standings.standings.find((s) => s.id === me.id);
  $('nbaMyMoneyLine').textContent = mine
    ? 'Your sheet: ' + mine.pickCount + ' picks · ' + fmtMoney(mine.owed) + ' owed · ' + (mine.paid ? 'Paid ✓' : 'Not paid yet')
    : 'You have no picks this week.';
  const collected = standings.standings.filter((s) => s.paid).reduce((s, x) => s + x.owed, 0);
  const owed = standings.standings.reduce((s, x) => s + x.owed, 0);
  $('nbaPoolMoneyLine').textContent = 'Pool total: ' + fmtMoney(collected) + ' collected of ' + fmtMoney(owed) + ' owed.';
}

async function loadNbaStandings(weekId) {
  const { weeks, currentWeekId } = await api('/api/nba/weeks');
  const sel = $('nbaStandingsWeekSelect');
  const keep = weekId !== undefined ? weekId : (nbaStandingsWeekId !== null ? nbaStandingsWeekId : currentWeekId);
  sel.innerHTML = weeks.map((w) => {
    const name = w.label || ('NBA Week ' + w.week_number);
    return '<option value="' + w.id + '"' + (w.id === keep ? ' selected' : '') + '>' + name + (w.isCurrent ? ' (current)' : '') + '</option>';
  }).join('');
  const chosen = weeks.some((w) => w.id === keep) ? keep : currentWeekId;
  nbaStandingsWeekId = chosen;
  sel.value = String(chosen);
  const data = await api('/api/nba/standings?week_id=' + chosen);
  $('nbaStandingsLine').textContent = (data.week.label || 'NBA Week ' + data.week.week_number) + ' · ' + data.decidedGames + ' of ' + data.totalGames + ' games decided.';
  document.querySelector('#nbaStandingsTable tbody').innerHTML = data.standings.map((s) =>
    '<tr><td>' + displayName(s) + '</td><td>' + s.wins + '</td><td>' + s.pickCount + '</td></tr>').join('');
  const showWinner = data.winners.length && (!data.week.isCurrent || data.decidedGames === data.totalGames);
  if (showWinner) {
    const winnerNames = data.winners.map((un) => {
      const row = data.standings.find((s) => s.username === un);
      return row ? displayName(row) : un;
    });
    $('nbaWinnerLine').classList.remove('hidden');
    $('nbaWinnerLine').textContent = 'Winner' + (data.winners.length > 1 ? 's (tie — pot split)' : '') + ': ' + winnerNames.join(', ') +
      ' · Pot ' + fmtMoney(data.pot) + ' · ' + fmtMoney(data.sharePerWinner) + ' each.';
  } else {
    $('nbaWinnerLine').classList.add('hidden');
  }
}

async function loadAdmin() {
  if (!me.isAdmin) return;
  const data = await api('/api/admin/overview');
  $('groupNameInput').value = data.groupName;
  $('wagerInput').value = data.perPickAmount;
  $('nbaWagerInput').value = data.nbaPerPickAmount;
  $('adminTotals').textContent = fmtMoney(data.collected) + ' collected · ' + fmtMoney(data.stillOwed) + ' still owed · ' + fmtMoney(data.owedTotal) + ' total owed.';
  document.querySelector('#paymentsTable tbody').innerHTML = data.players.map((p) =>
    '<tr><td>' + displayName(p) + '</td><td>' + (p.email || '') + '</td><td>' + p.status.replace('_', ' ') + '</td><td>' + p.pickCount + '</td><td>' + fmtMoney(p.owed) + '</td>' +
    '<td><input type="checkbox" data-paid-user="' + p.id + '"' + (p.paid ? ' checked' : '') + '> Paid</td>' +
    '<td><button type="button" data-remove-user="' + p.id + '">Remove</button></td></tr>').join('');
  document.querySelectorAll('[data-paid-user]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      await api('/api/admin/payments', 'POST', { user_id: Number(cb.dataset.paidUser), paid: cb.checked });
      loadAdmin();
    });
  });
  document.querySelectorAll('[data-remove-user]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.removeUser);
      const player = data.players.find((x) => x.id === id);
      if (!player) return;
      if (!confirm('Remove ' + displayName(player) + '? This permanently deletes their account, picks, and payment record.')) return;
      try {
        await api('/api/admin/remove-player', 'POST', { user_id: id });
        loadAdmin();
      } catch (e) {
        alert(e.message);
      }
    });
  });
  $('resultsList').innerHTML = data.games.map((g) =>
    '<div class="game-row"><div><b>' + g.away + ' at ' + g.home + '</b><div class="kick">' + g.kickoffLabel + '</div></div>' +
    '<select data-result-game="' + g.id + '">' +
    '<option value="">No result yet</option>' +
    '<option value="' + g.away + '"' + (g.winner === g.away ? ' selected' : '') + '>' + g.away + '</option>' +
    '<option value="' + g.home + '"' + (g.winner === g.home ? ' selected' : '') + '>' + g.home + '</option>' +
    '</select></div>').join('');
  document.querySelectorAll('[data-result-game]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      await api('/api/admin/results', 'POST', { game_id: Number(sel.dataset.resultGame), winner: sel.value || null });
      loadAdmin();
    });
  });
  $('allPicksList').innerHTML = data.players.map((p) => {
    const lines = data.games.map((g) => {
      const pick = p.picks[g.id];
      return '<div>' + g.away + ' at ' + g.home + ': <b>' + (pick || '—') + '</b></div>';
    }).join('');
    return '<div class="card"><h3>' + displayName(p) + ' (' + p.status.replace('_', ' ') + ')</h3>' + lines + '</div>';
  }).join('');
  // NBA admin: same overview shape, scoped to sport=nba. A 404 just
  // means no NBA week exists yet (before Tue Nov 10).
  try {
    const nba = await api('/api/admin/overview?sport=nba');
    $('nbaAdminTotals').textContent = fmtMoney(nba.collected) + ' collected · ' + fmtMoney(nba.stillOwed) + ' still owed · ' + fmtMoney(nba.owedTotal) + ' total owed.';
    document.querySelector('#nbaPaymentsTable tbody').innerHTML = nba.players.map((p) =>
      '<tr><td>' + displayName(p) + '</td><td>' + (p.email || '') + '</td><td>' + p.status.replace('_', ' ') + '</td><td>' + p.pickCount + '</td><td>' + fmtMoney(p.owed) + '</td>' +
      '<td><input type="checkbox" data-nba-paid-user="' + p.id + '"' + (p.paid ? ' checked' : '') + '> Paid</td></tr>').join('');
    document.querySelectorAll('[data-nba-paid-user]').forEach((cb) => {
      cb.addEventListener('change', async () => {
        await api('/api/admin/payments', 'POST', { user_id: Number(cb.dataset.nbaPaidUser), paid: cb.checked, sport: 'nba' });
        loadAdmin();
      });
    });
    $('nbaResultsList').innerHTML = nba.games.map((g) =>
      '<div class="game-row"><div><b>' + g.away + ' at ' + g.home + '</b><div class="kick">' + g.kickoffLabel + '</div></div>' +
      '<select data-nba-result-game="' + g.id + '">' +
      '<option value="">No result yet</option>' +
      '<option value="' + g.away + '"' + (g.winner === g.away ? ' selected' : '') + '>' + g.away + '</option>' +
      '<option value="' + g.home + '"' + (g.winner === g.home ? ' selected' : '') + '>' + g.home + '</option>' +
      '</select></div>').join('');
    document.querySelectorAll('[data-nba-result-game]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        await api('/api/admin/results', 'POST', { game_id: Number(sel.dataset.nbaResultGame), winner: sel.value || null });
        loadAdmin();
      });
    });
  } catch (e) {
    $('nbaAdminTotals').textContent = 'No NBA week yet — the first slate opens Tuesday Nov 10, 2026.';
    document.querySelector('#nbaPaymentsTable tbody').innerHTML = '';
    $('nbaResultsList').innerHTML = '';
  }
  loadRecords();
  loadNbaRecords();
}

// NBA team records editor (Admin → NBA). Same shape as loadRecords
// for the NFL, but W-L only — NBA games can't tie. A hand edit is
// overwritten by the next automatic ESPN refresh.
async function loadNbaRecords() {
  try {
    const data = await api('/api/admin/nba-records');
    $('nbaRecordsList').innerHTML = data.records.map((r) =>
      '<div class="rec-row" data-team="' + r.team + '"><b>' + r.team + '</b>' +
      '<label>W <input type="number" min="0" max="82" data-nba-rec-w value="' + r.wins + '"></label>' +
      '<label>L <input type="number" min="0" max="82" data-nba-rec-l value="' + r.losses + '"></label>' +
      '<button data-nba-rec-save>Save</button></div>').join('');
    document.querySelectorAll('[data-nba-rec-save]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.rec-row');
        try {
          await api('/api/admin/nba-records', 'POST', {
            team: row.dataset.team,
            wins: row.querySelector('[data-nba-rec-w]').value,
            losses: row.querySelector('[data-nba-rec-l]').value,
          });
          $('nbaRecordsMsg').textContent = 'Saved ' + row.dataset.team + '.';
        } catch (e) {
          $('nbaRecordsMsg').textContent = e.message;
        }
      });
    });
  } catch (e) {
    $('nbaRecordsList').innerHTML = '';
    $('nbaRecordsMsg').textContent = e.message;
  }
}

async function loadRecords() {
  const data = await api('/api/admin/records');
  $('recordsList').innerHTML = data.records.map((r) =>
    '<div class="rec-row" data-team="' + r.team + '"><b>' + r.team + '</b>' +
    '<label>W <input type="number" min="0" max="30" data-rec-w value="' + r.wins + '"></label>' +
    '<label>L <input type="number" min="0" max="30" data-rec-l value="' + r.losses + '"></label>' +
    '<label>T <input type="number" min="0" max="30" data-rec-t value="' + r.ties + '"></label>' +
    '<button data-rec-save>Save</button></div>').join('');
  document.querySelectorAll('[data-rec-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.rec-row');
      try {
        await api('/api/admin/records', 'POST', {
          team: row.dataset.team,
          wins: row.querySelector('[data-rec-w]').value,
          losses: row.querySelector('[data-rec-l]').value,
          ties: row.querySelector('[data-rec-t]').value,
        });
        $('recordsMsg').textContent = 'Saved ' + row.dataset.team + '.';
      } catch (e) {
        $('recordsMsg').textContent = e.message;
      }
    });
  });
}

// ------------------------------------------------------------ events
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// Show/hide password (eyeball) toggles.
document.querySelectorAll('.pwToggle').forEach((btn) => btn.addEventListener('click', () => {
  const input = document.getElementById(btn.dataset.target);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.textContent = show ? '🙈' : '👁';
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}));

function showAuthForm(which) {
  $('signInForm').classList.toggle('hidden', which !== 'signin');
  $('registerForm').classList.toggle('hidden', which !== 'register');
  $('authError').classList.add('hidden');
}
$('toRegisterBtn').addEventListener('click', () => showAuthForm('register'));
$('toSignInBtn').addEventListener('click', () => showAuthForm('signin'));

$('signInForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('authError').classList.add('hidden');
  try {
    const data = await api('/api/login', 'POST', { username: $('siUsername').value, password: $('siPassword').value });
    me = data.user;
    await refreshMe();
    showTab('pool');
  } catch (err) {
    // If the admin account has no password yet, offer the one-time setup.
    if ($('siUsername').value.trim().toLowerCase() === 'admin') $('adminSetup').classList.remove('hidden');
    $('authError').textContent = err.message;
    $('authError').classList.remove('hidden');
  }
});

$('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('authError').classList.add('hidden');
  if (!$('regName').value.trim()) {
    $('authError').textContent = 'Full name is required to create an account.';
    $('authError').classList.remove('hidden');
    return;
  }
  if ($('regPassword').value !== $('regConfirm').value) {
    $('authError').textContent = 'Passwords do not match.';
    $('authError').classList.remove('hidden');
    return;
  }
  if (!$('regEmail').value.trim()) {
    $('authError').textContent = 'Email is required so a password reset link can be sent.';
    $('authError').classList.remove('hidden');
    return;
  }
  try {
    await api('/api/register', 'POST', { name: $('regName').value, username: $('regUsername').value, email: $('regEmail').value, password: $('regPassword').value });
    $('authMsg').textContent = 'Account created. Sign in now.';
    $('authMsg').classList.remove('hidden');
    $('siUsername').value = $('regUsername').value;
    showAuthForm('signin');
  } catch (err) {
    $('authError').textContent = err.message;
    $('authError').classList.remove('hidden');
  }
});

$('saveNameBtn').addEventListener('click', async () => {
  const name = $('namePromptInput').value.trim();
  if (!name) {
    $('namePromptMsg').textContent = 'Please enter your full name.';
    return;
  }
  try {
    await api('/api/me/name', 'POST', { name });
    me.name = name;
    $('whoAmI').textContent = displayName(me) + (me.isAdmin ? ' (Admin)' : '');
    $('namePrompt').classList.add('hidden');
    loadPool();
  } catch (e) {
    $('namePromptMsg').textContent = e.message;
  }
});

$('saveEmailBtn').addEventListener('click', async () => {
  const email = $('emailPromptInput').value.trim();
  if (!email) {
    $('emailPromptMsg').textContent = 'Please enter your email.';
    return;
  }
  try {
    await api('/api/me/email', 'POST', { email });
    me.email = email;
    $('emailPrompt').classList.add('hidden');
  } catch (e) {
    $('emailPromptMsg').textContent = e.message;
  }
});

// Admin fallback for automatic seeding. Attached once here (not inside
// loadAdmin) because this button is static HTML, not re-rendered.
$('seedNextWeekBtn').addEventListener('click', async () => {
  $('seedNextWeekMsg').textContent = 'Seeding…';
  try {
    const r = await api('/api/admin/seed-next-week', 'POST', {});
    $('seedNextWeekMsg').textContent = r.seeded
      ? ('Seeded ' + r.label + ' (' + r.gameCount + ' games).')
      : ('Not seeded: ' + (r.reason || 'unknown') + '.');
    loadAdmin();
  } catch (e) {
    $('seedNextWeekMsg').textContent = e.message;
  }
});

// Standings week selector: static HTML, so attach once here (not inside
// loadStandings, which re-renders the options).
$('standingsWeekSelect').addEventListener('change', () => loadStandings(Number($('standingsWeekSelect').value)));

$('adminSetupBtn').addEventListener('click', async () => {
  $('authError').classList.add('hidden');
  try {
    await api('/api/admin/setup', 'POST', { password: $('adminPassword').value });
    $('authMsg').textContent = 'Admin password set. Sign in as admin now.';
    $('authMsg').classList.remove('hidden');
    $('adminSetup').classList.add('hidden');
  } catch (e) {
    $('authError').textContent = e.message;
    $('authError').classList.remove('hidden');
  }
});

$('signOutBtn').addEventListener('click', async () => {
  await api('/api/logout', 'POST', {});
  me = null;
  $('userBar').classList.add('hidden');
  show('authView');
});

$('playBtn').addEventListener('click', async () => {
  await api('/api/participation', 'POST', { status: 'playing' });
  $('partMsg').textContent = "You're in for this week. Head to My Picks to make your selections.";
  $('partMsg').classList.remove('hidden');
  loadPool();
});
$('skipBtn').addEventListener('click', async () => {
  await api('/api/participation', 'POST', { status: 'not_participating' });
  $('partMsg').textContent = "Marked as not participating this week.";
  $('partMsg').classList.remove('hidden');
  loadPool();
});

$('savePicksBtn').addEventListener('click', async () => {
  const gameIds = new Set((pool.games || []).map((g) => String(g.id)));
  const picks = Object.entries(myPicks)
    .filter(([gid]) => gameIds.has(gid))
    .map(([game_id, team]) => ({ game_id: Number(game_id), team }));
  try {
    await api('/api/picks', 'POST', { picks });
    $('saveMsg').textContent = 'Picks saved (' + picks.length + ').';
    loadPool();
  } catch (e) {
    $('saveMsg').textContent = e.message;
  }
});

// NBA tab buttons (static HTML, attached once like the NFL ones).
$('nbaPlayBtn').addEventListener('click', async () => {
  await api('/api/nba/participation', 'POST', { status: 'playing' });
  $('nbaPartMsg').textContent = "You're in for this NBA week. Make your picks below.";
  $('nbaPartMsg').classList.remove('hidden');
  loadNba();
});
$('nbaSkipBtn').addEventListener('click', async () => {
  await api('/api/nba/participation', 'POST', { status: 'not_participating' });
  $('nbaPartMsg').textContent = 'Marked as not participating this NBA week.';
  $('nbaPartMsg').classList.remove('hidden');
  loadNba();
});
$('nbaSavePicksBtn').addEventListener('click', async () => {
  const gameIds = new Set(((nbaPool && nbaPool.games) || []).map((g) => String(g.id)));
  const picks = Object.entries(nbaPicks)
    .filter(([gid]) => gameIds.has(gid))
    .map(([game_id, team]) => ({ game_id: Number(game_id), team }));
  try {
    await api('/api/nba/picks', 'POST', { picks });
    $('nbaSaveMsg').textContent = 'Picks saved (' + picks.length + ').';
    loadNba();
  } catch (e) {
    $('nbaSaveMsg').textContent = e.message;
  }
});
$('nbaStandingsWeekSelect').addEventListener('change', () => loadNbaStandings(Number($('nbaStandingsWeekSelect').value)));
$('seedNextNbaBtn').addEventListener('click', async () => {
  $('seedNextNbaMsg').textContent = 'Seeding…';
  try {
    const r = await api('/api/admin/seed-next-nba-week', 'POST', {});
    $('seedNextNbaMsg').textContent = r.seeded
      ? ('Seeded ' + r.label + ' (' + r.gameCount + ' games).')
      : ('Not seeded: ' + (r.reason || 'unknown') + '.');
    loadAdmin();
  } catch (e) {
    $('seedNextNbaMsg').textContent = e.message;
  }
});

$('saveSettingsBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/admin/settings', 'POST', {
      group_name: $('groupNameInput').value,
      per_pick_amount: $('wagerInput').value,
      nba_per_pick_amount: $('nbaWagerInput').value,
    });
    $('settingsMsg').textContent = 'Saved. Group name: "' + (data.groupName || '(none)') + '", per-pick: $' + data.perPickAmount + ' (NBA: $' + data.nbaPerPickAmount + ').';
    loadPool();
  } catch (e) {
    $('settingsMsg').textContent = e.message;
  }
});

// ------------------------------------------------------------- boot
(async () => {
  // Fill the landing page from public info (best effort; the static
  // fallback text in the HTML already covers the mini test).
  try {
    const info = await api('/api/public-info');
    const title = 'NFL WEEKLY PICKS' + (info.groupName ? ' — ' + info.groupName : '');
    $('appTitle').textContent = title;
    const weekName = info.week.label || ('Week ' + info.week.week_number);
    $('heroLock').textContent = weekName + ' · picks lock ' + fmtLock(info.week.lock_at);
    $('heroCost').textContent = fmtMoney(info.perPickAmount) + ' per pick (' + fmtMoney(info.fullSheetAmount) + ' for a full ' + info.gameCount + '-game sheet).';
    $('heroPrice').textContent = '🏈 Weekly pool · ' + fmtMoney(info.perPickAmount) + ' a pick';
  } catch { /* keep static fallback text */ }
  const ok = await refreshMe();
  if (ok) showTab('pool');
})();
