// ===================== CONFIG =====================
// Add or rename roles here. Everything else builds itself from this list.
const ROLES = [
  { name: 'Civilian',  label: 'Civilians',  color: '#4fa3ff' },
  { name: 'Mafia',     label: 'Mafia',      color: '#ff4d4d' },
  { name: 'Doctor',    label: 'Doctors',    color: '#3ddc97' },
  { name: 'Jester',    label: 'Jesters',    color: '#c77dff' },
  { name: 'Detective', label: 'Detectives', color: '#ffc93c' },
];
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 30;

// ===================== STATE =====================
// Setup values live here, so they are still there when you return to the start screen.
const state = {
  players: 6,
  counts: { Civilian: 3, Mafia: 1, Doctor: 1, Jester: 0, Detective: 1 },
  names: Array(MAX_PLAYERS).fill(''),
  minutes: 3,
  seconds: 0,
};
let game = null;     // created when a game starts
let wakeLock = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const total = () => Object.values(state.counts).reduce((a, b) => a + b, 0);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  document.documentElement.style.backgroundColor = '';
}

// ===================== SETUP SCREEN =====================
function buildRoleRows() {
  const box = $('role-rows');
  box.innerHTML = ROLES.map((r) => `
    <div class="row">
      <span class="role-name" style="--c:${r.color}">${r.label}</span>
      <div class="stepper">
        <button type="button" data-role="${r.name}" data-d="-1" aria-label="Fewer ${r.label}">−</button>
        <output id="count-${r.name}">0</output>
        <button type="button" data-role="${r.name}" data-d="1" aria-label="More ${r.label}">+</button>
      </div>
    </div>`).join('');
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const role = b.dataset.role;
    const d = Number(b.dataset.d);
    if (d > 0 && total() >= state.players) return;
    state.counts[role] = Math.max(0, state.counts[role] + d);
    updateSetup();
  });
}

function buildNames() {
  $('names').innerHTML = Array.from({ length: state.players }, (_, i) =>
    `<input type="text" data-i="${i}" maxlength="20" placeholder="Player ${i + 1}" value="${esc(state.names[i])}" autocomplete="off">`
  ).join('');
}

function changePlayers(d) {
  const n = clamp(state.players + d, MIN_PLAYERS, MAX_PLAYERS);
  if (n === state.players) return;
  // Keep every non-civilian role as is, and let Civilians fill the remaining seats.
  const others = total() - state.counts.Civilian;
  state.players = n;
  state.counts.Civilian = Math.max(0, n - others);
  buildNames();
  updateSetup();
}

function updateSetup() {
  $('players-out').textContent = state.players;
  $('players-minus').disabled = state.players <= MIN_PLAYERS;
  $('players-plus').disabled = state.players >= MAX_PLAYERS;

  const full = total() >= state.players;
  ROLES.forEach((r) => {
    $('count-' + r.name).textContent = state.counts[r.name];
  });
  document.querySelectorAll('#role-rows button').forEach((b) => {
    const d = Number(b.dataset.d);
    b.disabled = d < 0 ? state.counts[b.dataset.role] <= 0 : full;
  });

  const diff = state.players - total();
  const status = $('status');
  status.className = 'status';
  if (diff === 0) {
    status.textContent = `All ${state.players} players have a role.`;
    status.classList.add('ok');
  } else if (diff > 0) {
    status.textContent = `${diff} ${diff === 1 ? 'player needs' : 'players need'} a role.`;
  } else {
    status.textContent = `${-diff} too many ${-diff === 1 ? 'role' : 'roles'}. Remove some.`;
    status.classList.add('bad');
  }

  const duration = state.minutes * 60 + state.seconds;
  $('start').disabled = diff !== 0 || duration <= 0;
}

// ===================== STARTING A GAME =====================
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function startGame() {
  const deck = [];
  ROLES.forEach((r) => { for (let i = 0; i < state.counts[r.name]; i++) deck.push(r); });
  shuffle(deck);

  game = {
    assign: deck.map((role, i) => ({ role, name: state.names[i].trim() || `Player ${i + 1}` })),
    i: 0,
    revealed: false,
    round: 0,
    duration: (state.minutes * 60 + state.seconds) * 1000,
    end: 0,
    done: false,
    iv: null,
  };
  lockScreen();
  showScreen('deal');
  renderDeal();
}

// ===================== DEALING ROLES =====================
function renderDeal() {
  const p = game.assign[game.i];
  $('deal-count').textContent = `${game.i + 1} of ${game.assign.length}`;
  $('deal-content').innerHTML = game.revealed
    ? `<p class="pre">${esc(p.name)}, you are</p>
       <h2 class="role" style="color:${p.role.color}">${p.role.name}</h2>
       <p class="hint">Tap to hide</p>`
    : `<p class="pre">${game.i === 0 ? 'Give the phone to' : 'Now pass the phone to'}</p>
       <h2 class="who">${esc(p.name)}</h2>
       <p class="hint">Tap to reveal your role</p>`;
}

function onDealTap() {
  if (!game.revealed) {
    game.revealed = true;
    renderDeal();
    return;
  }
  game.revealed = false;
  game.i++;
  if (game.i >= game.assign.length) {
    showScreen('timer');
    startRound();
  } else {
    renderDeal();
  }
}

// ===================== ROUND TIMER =====================
function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function setBackground(p) {
  // p goes from 0 (black) to 1 (full red)
  document.documentElement.style.backgroundColor = `rgb(${Math.round(209 * p)}, 0, 0)`;
}

function startRound() {
  game.round++;
  game.done = false;
  game.end = Date.now() + game.duration;
  $('round-label').textContent = `Round ${game.round}`;
  $('timer-msg').textContent = '';
  $('timer').classList.remove('done');
  clearInterval(game.iv);
  tick();
  game.iv = setInterval(tick, 100);
}

function tick() {
  const left = Math.max(0, game.end - Date.now());
  $('clock').textContent = fmt(Math.ceil(left / 1000));
  setBackground(1 - left / game.duration);
  if (left <= 0) finishRound();
}

function finishRound() {
  clearInterval(game.iv);
  game.done = true;
  setBackground(1);
  $('clock').textContent = '0:00';
  $('timer-msg').textContent = 'Round over. Tap anywhere to start the next round.';
  $('timer').classList.add('done');
  if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
}

// ===================== ENDING =====================
function endGame() {
  clearInterval(game.iv);
  unlockScreen();
  $('result-list').innerHTML = game.assign.map((p) => `
    <div class="result-row">
      <span>${esc(p.name)}</span>
      <span class="result-role" style="color:${p.role.color}">${p.role.name}</span>
    </div>`).join('');
  showScreen('results');
}

// ===================== KEEP SCREEN AWAKE =====================
async function lockScreen() {
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not supported, that's fine */ }
}
function unlockScreen() {
  try { wakeLock && wakeLock.release(); } catch (e) { /* ignore */ }
  wakeLock = null;
}

// ===================== EVENTS =====================
$('players-minus').addEventListener('click', () => changePlayers(-1));
$('players-plus').addEventListener('click', () => changePlayers(1));

$('names').addEventListener('input', (e) => {
  if (e.target.dataset.i !== undefined) state.names[e.target.dataset.i] = e.target.value;
});

$('minutes').addEventListener('input', (e) => { state.minutes = clamp(parseInt(e.target.value, 10) || 0, 0, 99); updateSetup(); });
$('seconds').addEventListener('input', (e) => { state.seconds = clamp(parseInt(e.target.value, 10) || 0, 0, 59); updateSetup(); });

$('start').addEventListener('click', startGame);
$('deal').addEventListener('click', onDealTap);

$('timer').addEventListener('click', () => { if (game.done) startRound(); });
$('end').addEventListener('click', (e) => {
  e.stopPropagation(); // don't let this count as "start next round"
  if (confirm('End the game and reveal everyone\'s roles?')) endGame();
});

$('again').addEventListener('click', () => showScreen('setup'));

// ===================== INIT =====================
$('minutes').value = state.minutes;
$('seconds').value = state.seconds;
buildRoleRows();
buildNames();
updateSetup();
