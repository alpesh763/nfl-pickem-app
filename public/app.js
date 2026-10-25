// NFL Weekly Picks frontend — vanilla JS against the /api routes.
'use strict';

const $ = (id) => document.getElementById(id);
let me = null;
let pool = null;
let myPicks = {};

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

async function loadStandings() {
  const data = await api('/api/standings');
  $('standingsLine').textContent = (data.week.label || 'Week ' + data.week.week_number) + ' · ' + data.decidedGames + ' of ' + data.totalGames + ' games decided.';
  document.querySelector('#standingsTable tbody').innerHTML = data.standings.map((s) =>
    '<tr><td>' + displayName(s) + '</td><td>' + s.wins + '</td><td>' + s.pickCount + '</td></tr>').join('');
  if (data.decidedGames === data.totalGames && data.winners.length) {
    $('winnerLine').classList.remove('hidden');
    $('winnerLine').textContent = 'Week winner' + (data.winners.length > 1 ? 's (tie — pot split)' : '') + ': ' + data.winners.join(', ') +
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

async function loadAdmin() {
  if (!me.isAdmin) return;
  const data = await api('/api/admin/overview');
  $('groupNameInput').value = data.groupName;
  $('wagerInput').value = data.perPickAmount;
  $('adminTotals').textContent = fmtMoney(data.collected) + ' collected · ' + fmtMoney(data.stillOwed) + ' still owed · ' + fmtMoney(data.owedTotal) + ' total owed.';
  document.querySelector('#paymentsTable tbody').innerHTML = data.players.map((p) =>
    '<tr><td>' + displayName(p) + '</td><td>' + p.status.replace('_', ' ') + '</td><td>' + p.pickCount + '</td><td>' + fmtMoney(p.owed) + '</td>' +
    '<td><input type="checkbox" data-paid-user="' + p.id + '"' + (p.paid ? ' checked' : '') + '> Paid</td></tr>').join('');
  document.querySelectorAll('[data-paid-user]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      await api('/api/admin/payments', 'POST', { user_id: Number(cb.dataset.paidUser), paid: cb.checked });
      loadAdmin();
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
  loadRecords();
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
  try {
    await api('/api/register', 'POST', { name: $('regName').value, username: $('regUsername').value, password: $('regPassword').value });
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

$('saveSettingsBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/admin/settings', 'POST', {
      group_name: $('groupNameInput').value,
      per_pick_amount: $('wagerInput').value,
    });
    $('settingsMsg').textContent = 'Saved. Group name: "' + (data.groupName || '(none)') + '", per-pick: $' + data.perPickAmount + '.';
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
  } catch { /* keep static fallback text */ }
  const ok = await refreshMe();
  if (ok) showTab('pool');
})();
