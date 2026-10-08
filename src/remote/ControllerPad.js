/**
 * NETMETRO - MANDO MÓVIL (LADO DEL TELÉFONO)
 * Se abre al escanear el QR del juego (controller.html?room=XXXX). Envía al juego el estado
 * del stick y de los botones sostenidos por el canal de Supabase Realtime de esa sala, y
 * muestra lo que el juego le devuelve (piezas, mejoras disponibles, recompensa semanal...).
 */

import { supabaseService } from '../services/SupabaseService.js';
import { PAD_TIMEOUT_MS, PAD_TOOLS, ROOM_CODE_PATTERN, channelNameForRoom } from './protocol.js';

const INPUT_MIN_INTERVAL_MS = 110;  // Realtime limita los mensajes por segundo: ~9/s como máximo
const KEEPALIVE_MS = 1000;          // reenviar el estado completo aunque no cambie
const STICK_DEADZONE = 0.12;
const STICK_CHANGE_THRESHOLD = 0.03;

const room = (new URLSearchParams(window.location.search).get('room') || '').toLowerCase();
const clientId = crypto.getRandomValues(new Uint32Array(2)).join('-');

let channel = null;
let isSubscribed = false;
let isWelcomed = false;      // el juego ya respondió a nuestro 'hello'
let lastDesktopSeen = 0;
let sessionEnded = false;
let replacedByOther = false;
let gameState = null;

const input = { x: 0, y: 0, put: false, erase: false };
let lastSentInput = { ...input };
let lastInputSentAt = 0;
let pendingInputTimer = null;

const $ = (id) => document.getElementById(id);

// ==================== CONEXIÓN ====================

async function connect() {
  if (!ROOM_CODE_PATTERN.test(room)) {
    showOverlay('Código inválido', 'Este enlace no contiene una sala válida. Vuelve a escanear el QR desde el juego.');
    setStatus('offline', 'Sin sala');
    return;
  }

  showOverlay('Conectando...', 'Buscando la partida en tu PC.');
  await supabaseService.ready;
  const client = supabaseService.client;
  if (!client) {
    showOverlay('Sin servidor', 'No hay conexión con el servidor del juego. Revisa tu internet y recarga la página.',
      [{ label: 'Reintentar', icon: '🔄', onClick: () => window.location.reload() }]);
    setStatus('offline', 'Sin servidor');
    return;
  }

  channel = client.channel(channelNameForRoom(room), { config: { broadcast: { self: false } } });
  channel
    .on('broadcast', { event: 'state' }, ({ payload }) => onState(payload))
    .on('broadcast', { event: 'feedback' }, ({ payload }) => {
      if (payload && payload.to === clientId) {
        showToast(payload.message, payload.ok ? 'ok' : 'error');
        if (!payload.ok) vibrate([40, 50, 40]);
      }
    })
    .on('broadcast', { event: 'bye' }, () => {
      sessionEnded = true;
      releaseAll();
      render();
    })
    .subscribe((status) => {
      isSubscribed = status === 'SUBSCRIBED';
      if (isSubscribed) send('hello', {});
      render();
    });

  setInterval(heartbeat, KEEPALIVE_MS);
}

function send(event, payload) {
  if (!channel || !isSubscribed) return;
  channel.send({ type: 'broadcast', event, payload: { ...payload, id: clientId } }).catch(() => {});
}

function heartbeat() {
  if (sessionEnded || replacedByOther || !isSubscribed) return;

  if (!isWelcomed) {
    send('hello', {});
  } else if (performance.now() - lastInputSentAt >= KEEPALIVE_MS * 0.9) {
    flushInput();
  }

  if (isWelcomed && performance.now() - lastDesktopSeen > PAD_TIMEOUT_MS) {
    // El juego dejó de responder: volver a saludar hasta que conteste
    isWelcomed = false;
    releaseAll();
  }
  render();
}

function onState(state) {
  if (!state || sessionEnded) return;
  lastDesktopSeen = performance.now();

  if (state.to !== clientId) {
    // El juego respondió a otro teléfono: ese tomó el control
    if (isWelcomed || !replacedByOther) {
      replacedByOther = true;
      isWelcomed = false;
      releaseAll();
      render();
    }
    return;
  }

  replacedByOther = false;
  isWelcomed = true;
  gameState = state;
  render();
}

// ==================== ENVÍO DEL ESTADO DEL MANDO ====================

// Encola el envío del estado del mando respetando el límite de mensajes por segundo. Los
// cambios de botones se envían de inmediato; los del stick, como mucho cada INPUT_MIN_INTERVAL_MS.
function queueInput(immediate = false) {
  const wait = INPUT_MIN_INTERVAL_MS - (performance.now() - lastInputSentAt);
  if (immediate || wait <= 0) {
    flushInput();
  } else if (!pendingInputTimer) {
    pendingInputTimer = setTimeout(flushInput, wait);
  }
}

function flushInput() {
  clearTimeout(pendingInputTimer);
  pendingInputTimer = null;
  lastInputSentAt = performance.now();
  lastSentInput = { ...input };
  send('input', {
    x: Math.round(input.x * 1000) / 1000,
    y: Math.round(input.y * 1000) / 1000,
    put: input.put,
    erase: input.erase
  });
}

function releaseAll() {
  input.x = 0;
  input.y = 0;
  input.put = false;
  input.erase = false;
  resetStickVisual();
  document.querySelectorAll('.pad-hold-btn').forEach(btn => btn.classList.remove('pressed'));
  if (isWelcomed) flushInput();
}

// ==================== STICK ====================

const stickZone = $('stick-zone');
const stickBase = $('stick-base');
const stickKnob = $('stick-knob');
let stickPointerId = null;
let stickCenter = { x: 0, y: 0 };

stickZone.addEventListener('pointerdown', (e) => {
  if (stickPointerId !== null) return;
  stickPointerId = e.pointerId;
  stickZone.setPointerCapture(e.pointerId);
  const rect = stickBase.getBoundingClientRect();
  stickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  stickKnob.classList.add('active');
  updateStick(e);
});

stickZone.addEventListener('pointermove', (e) => {
  if (e.pointerId === stickPointerId) updateStick(e);
});

for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  stickZone.addEventListener(type, (e) => {
    if (e.pointerId !== stickPointerId) return;
    stickPointerId = null;
    resetStickVisual();
    input.x = 0;
    input.y = 0;
    queueInput(true);
  });
}

function updateStick(e) {
  const maxRadius = stickBase.getBoundingClientRect().width * 0.36;
  let dx = e.clientX - stickCenter.x;
  let dy = e.clientY - stickCenter.y;
  const dist = Math.hypot(dx, dy);
  if (dist > maxRadius) {
    dx = (dx / dist) * maxRadius;
    dy = (dy / dist) * maxRadius;
  }
  stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;

  // Zona muerta: pequeños temblores del pulgar no mueven el cursor
  const magnitude = Math.min(1, dist / maxRadius);
  if (magnitude < STICK_DEADZONE) {
    input.x = 0;
    input.y = 0;
  } else {
    const scaled = (magnitude - STICK_DEADZONE) / (1 - STICK_DEADZONE);
    input.x = (dx / (magnitude * maxRadius)) * scaled;
    input.y = (dy / (magnitude * maxRadius)) * scaled;
  }

  const changed = Math.abs(input.x - lastSentInput.x) > STICK_CHANGE_THRESHOLD ||
    Math.abs(input.y - lastSentInput.y) > STICK_CHANGE_THRESHOLD ||
    ((input.x === 0 && input.y === 0) !== (lastSentInput.x === 0 && lastSentInput.y === 0));
  if (changed) queueInput();
}

function resetStickVisual() {
  stickKnob.style.transform = '';
  stickKnob.classList.remove('active');
}

// ==================== BOTONES SOSTENIDOS (PONER / QUITAR CABLE) ====================

document.querySelectorAll('[data-hold]').forEach((btn) => {
  const key = btn.dataset.hold;
  let pointerId = null;

  btn.addEventListener('pointerdown', (e) => {
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    btn.setPointerCapture(e.pointerId);
    btn.classList.add('pressed');
    input[key] = true;
    vibrate(12);
    queueInput(true);
  });

  const release = (e) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    btn.classList.remove('pressed');
    input[key] = false;
    queueInput(true);
  };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('lostpointercapture', release);
});

// ==================== MEJORAS MANUALES Y BOTONES SUPERIORES ====================

const toolsContainer = $('pad-tools');
for (const tool of PAD_TOOLS) {
  const btn = document.createElement('button');
  btn.className = 'pad-tool';
  btn.dataset.tool = tool.id;
  btn.disabled = true;
  btn.innerHTML = `
    <span class="pad-tool-icon">${tool.icon}</span>
    <span class="pad-tool-name">${tool.name}</span>
    <span class="pad-tool-count">0</span>
  `;
  btn.addEventListener('click', () => {
    vibrate(15);
    send('action', { type: 'tool', tool: tool.id });
  });
  toolsContainer.appendChild(btn);
}

$('pad-btn-pause').addEventListener('click', () => send('action', { type: 'pause' }));
$('pad-btn-center').addEventListener('click', () => send('action', { type: 'center' }));

// ==================== INTERFAZ ====================

function render() {
  if (sessionEnded) {
    setStatus('offline', 'Sesión cerrada');
    showOverlay('Sesión terminada', 'El juego cerró la conexión con este mando. Escanea un QR nuevo para volver a conectarte.');
    return;
  }
  if (replacedByOther) {
    setStatus('offline', 'Otro mando activo');
    showOverlay('Otro teléfono tomó el control', 'Solo un mando puede controlar la partida a la vez.',
      [{ label: 'Retomar control', icon: '🎮', onClick: () => { replacedByOther = false; send('hello', {}); render(); } }]);
    return;
  }
  if (!isSubscribed) {
    setStatus('waiting', 'Conectando...');
    showOverlay('Conectando...', 'Buscando la partida en tu PC.');
    return;
  }
  if (!isWelcomed || !gameState) {
    const lost = lastDesktopSeen > 0;
    setStatus(lost ? 'offline' : 'waiting', lost ? 'Reconectando...' : 'Esperando al juego...');
    showOverlay(lost ? 'Conexión perdida' : 'Esperando al juego...',
      lost ? 'Intentando reconectar con la PC. Revisa que el juego siga abierto.' : 'Asegúrate de que el juego siga abierto en tu PC.');
    return;
  }

  setStatus('online', `Conectado · sala ${room.toUpperCase()}`);
  const state = gameState;

  $('pad-budget').textContent = state.budget;
  $('pad-budget').parentElement.classList.toggle('low', state.budget <= 5);
  $('pad-week').textContent = state.week;
  const pauseBtn = $('pad-btn-pause');
  pauseBtn.textContent = state.paused ? '▶' : '⏸';
  pauseBtn.classList.toggle('active', state.paused);

  toolsContainer.querySelectorAll('.pad-tool').forEach((btn) => {
    const count = (state.counts && state.counts[btn.dataset.tool]) || 0;
    btn.disabled = count <= 0;
    btn.querySelector('.pad-tool-count').textContent = count;
  });

  if (state.phase === 'menu') {
    showOverlay('¡Mando conectado!', 'Sujeta el teléfono en horizontal. Stick izquierdo: mover el cursor. Botones derechos: poner/quitar cable y colocar mejoras.',
      [{ label: 'Iniciar partida', icon: '🚀', onClick: () => send('action', { type: 'start' }) }]);
  } else if (state.phase === 'upgrade') {
    showOverlay('Fin de semana completado', 'Elige una mejora de infraestructura:',
      state.upgrades.map((u, index) => ({
        label: u.name, icon: u.icon, onClick: () => send('action', { type: 'upgrade', index })
      })));
  } else if (state.phase === 'gameover') {
    showOverlay('Colapso del sistema', 'La partida terminó. Puedes guardar tu récord desde la PC.',
      [{ label: 'Reintentar partida', icon: '🔄', onClick: () => send('action', { type: 'retry' }) }]);
  } else {
    hideOverlay();
  }
}

function setStatus(kind, label) {
  $('pad-dot').className = `pad-dot ${kind === 'online' ? 'online' : kind === 'offline' ? 'offline' : ''}`;
  $('pad-status-label').textContent = label;
}

// Clave del contenido mostrado: evita reconstruir los botones (y cortar un toque a medias)
// cada vez que llega un estado idéntico del juego
let overlayKey = '';

function showOverlay(title, message, actions = []) {
  const key = JSON.stringify([title, message, actions.map(a => a.label)]);
  $('pad-overlay').classList.remove('hidden');
  if (key === overlayKey) return;
  overlayKey = key;

  releaseAll();
  $('pad-overlay-title').textContent = title;
  $('pad-overlay-message').textContent = message;
  const container = $('pad-overlay-actions');
  container.innerHTML = '';
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.className = 'pad-overlay-btn';
    const icon = document.createElement('span');
    icon.className = 'pad-overlay-btn-icon';
    icon.textContent = action.icon || '';
    btn.append(icon, action.label);
    btn.addEventListener('click', () => { vibrate(15); action.onClick(); });
    container.appendChild(btn);
  }
}

function hideOverlay() {
  overlayKey = '';
  $('pad-overlay').classList.add('hidden');
}

let toastTimer = null;
function showToast(message, kind) {
  const toast = $('pad-toast');
  toast.textContent = message;
  toast.className = `pad-toast show ${kind || ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

function vibrate(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* sin vibración */ }
}

// ==================== PANTALLA COMPLETA, ORIENTACIÓN Y PANTALLA ENCENDIDA ====================

// Los navegadores solo permiten pantalla completa y bloqueo de orientación tras un toque del
// usuario. En iPhone no existen: ahí el aviso de "gira tu teléfono" cubre el caso vertical.
document.addEventListener('pointerdown', async () => {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('landscape');
    }
  } catch (e) { /* no soportado: se sigue jugando igual */ }
}, { once: true });

let wakeLock = null;
async function keepScreenOn() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) { /* no soportado */ }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    keepScreenOn();
  } else {
    // Al salir de la página (bloqueo, cambio de app) se sueltan todos los controles: si no, el
    // juego seguiría tendiendo cable o moviendo el cursor con el último estado recibido
    releaseAll();
  }
});

window.addEventListener('pagehide', () => send('bye', {}));
document.addEventListener('contextmenu', (e) => e.preventDefault());

keepScreenOn();
render();
connect();
