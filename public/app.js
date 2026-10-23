// NFL Weekly Picks frontend — vanilla JS against the /api routes.
'use strict';

const $ = (id) => document.getElementById(id);
let me = null;
let pool = null;
let myPicks = {};
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
function fmtLock(iso) {
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT';
}

async function refreshMe() {
  try {
    const data = await api('/api/me');
    me = data.user;
    $('whoAmI').textContent = me.username + (me.isAdmin ? ' (Admin)' : '');
    $('userBar').classList.remove('hidden');
    $('adminTabBtn').classList.toggle('hidden', !me.isAdmin);
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
      ? list.map((p) => '<li>' + p.username + ' (' + p.pickCount + ' picks)</li>').join('')
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
    return '<div class="game-row"><div><b>' + g.away + ' at ' + g.home + '</b><div class="kick">' + g.kickoffLabel + (g.winner ? ' · Winner: ' + g.winner : '') + '</div></div>' +
      '<select data-game="' + g.id + '" ' + (locked ? 'disabled' : '') + '>' +
      '<option value="">Pick a winner…</option>' +
      '<option value="' + g.away + '"' + (sel === g.away ? ' selected' : '') + '>' + g.away + '</option>' +
      '<option value="' + g.home + '"' + (sel === g.home ? ' selected' : '') + '>' + g.home + '</option>' +
      '</select></div>';
  }).join('');
}

async function loadStandings() {
  const data = await api('/api/standings');
  $('standingsLine').textContent = (data.week.label || 'Week ' + data.week.week_number) + ' · ' + data.decidedGames + ' of ' + data.totalGames + ' games decided.';
  document.querySelector('#standingsTable tbody').innerHTML = data.standings.map((s) =>
    '<tr><td>' + s.username + '</td><td>' + s.wins + '</td><td>' + s.pickCount + '</td></tr>').join('');
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
  const mine = data.standings.find((s) => s.username === me.username);
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
    '<tr><td>' + p.username + '</td><td>' + p.status.replace('_', ' ') + '</td><td>' + p.pickCount + '</td><td>' + fmtMoney(p.owed) + '</td>' +
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
    return '<div class="card"><h3>' + p.username + ' (' + p.status.replace('_', ' ') + ')</h3>' + lines + '</div>';
  }).join('');
}

// ------------------------------------------------------------ events
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

$('signInBtn').addEventListener('click', async () => {
  $('authError').classList.add('hidden');
  try {
    const data = await api('/api/login', 'POST', { username: $('username').value, password: $('password').value });
    me = data.user;
    await refreshMe();
    showTab('pool');
  } catch (e) {
    // If the admin account has no password yet, offer the one-time setup.
    if ($('username').value.trim().toLowerCase() === 'admin') $('adminSetup').classList.remove('hidden');
    $('authError').textContent = e.message;
    $('authError').classList.remove('hidden');
  }
});

$('registerBtn').addEventListener('click', async () => {
  $('authError').classList.add('hidden');
  try {
    await api('/api/register', 'POST', { username: $('username').value, password: $('password').value });
    $('authMsg').textContent = 'Account created. Sign in now.';
    $('authMsg').classList.remove('hidden');
  } catch (e) {
    $('authError').textContent = e.message;
    $('authError').classList.remove('hidden');
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
  const picks = [];
  document.querySelectorAll('[data-game]').forEach((sel) => {
    if (sel.value) picks.push({ game_id: Number(sel.dataset.game), team: sel.value });
  });
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
  const ok = await refreshMe();
  if (ok) showTab('pool');
})();
