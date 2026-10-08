/**
 * NETMETRO - MANDO MÓVIL (LADO DEL JUEGO)
 * Abre una sala en Supabase Realtime a la que se une el teléfono (controller.html) al escanear
 * el QR. El teléfono solo envía el estado de su stick y botones; aquí se integra el movimiento
 * de un cursor virtual en cada frame, así el cursor se mueve fluido aunque los mensajes lleguen
 * a pocos por segundo y con algo de latencia.
 *
 * Con el botón "Poner" sostenido, el cursor tiende cable por donde pasa (igual que arrastrar
 * con el mouse); con "Quitar" sostenido, retira los tramos que toca. Las mejoras manuales se
 * colocan sobre la celda o nodo que está bajo el cursor.
 */

import { supabaseService } from '../services/SupabaseService.js';
import { pixelToCell } from '../core/Grid.js';
import { GRID_CELL_SIZE, GAME_SPEEDS } from '../config/constants.js';
import { PAD_TIMEOUT_MS, PAD_TOOLS, channelNameForRoom, generateRoomCode } from './protocol.js';

const CURSOR_MAX_SPEED = 720;        // px/s con el stick al tope
const CURSOR_SPEED_CURVE = 1.6;      // >1: poco recorrido del stick = movimiento fino
const CURSOR_EDGE_MARGIN = 140;      // px: al acercarse al borde de la pantalla, la cámara lo sigue
const STATE_MIN_INTERVAL_MS = 200;   // no enviar estado al teléfono más de 5 veces por segundo
const STATE_KEEPALIVE_MS = 2000;     // reenviar el estado aunque no cambie, para que sepa que seguimos

export class RemoteController {
  constructor(engine) {
    this.engine = engine;

    this.channel = null;
    this.roomCode = null;
    this.status = 'closed'; // 'closed' | 'unavailable' | 'waiting' | 'connected' | 'error'
    this.onStatusChange = null;

    this.controllerId = null;
    this.lastSeen = 0;
    this.input = { x: 0, y: 0, put: false, erase: false };

    // Cursor virtual en coordenadas de MUNDO
    this.cursor = { x: 0, y: 0 };
    this.prevCursorCell = null;
    this.stroke = { lastCell: null, warned: false };
    this.isPainting = false;
    this.wasPutHeld = false;
    this.wasEraseHeld = false;
    this.lastEngineState = engine.state;

    this.lastStateJson = '';
    this.lastStateSentAt = -Infinity;
  }

  get isConnected() {
    return this.status === 'connected';
  }

  // Abre la sala (si no estaba abierta). Devuelve false si no hay conexión con Supabase.
  async open() {
    if (this.channel) return true;

    await supabaseService.ready;
    const client = supabaseService.client;
    if (!client) {
      this.setStatus('unavailable');
      return false;
    }

    this.roomCode = generateRoomCode();
    this.channel = client.channel(channelNameForRoom(this.roomCode), {
      config: { broadcast: { self: false } }
    });

    this.channel
      .on('broadcast', { event: 'hello' }, ({ payload }) => this.onHello(payload))
      .on('broadcast', { event: 'input' }, ({ payload }) => this.onInput(payload))
      .on('broadcast', { event: 'action' }, ({ payload }) => this.onAction(payload))
      .on('broadcast', { event: 'bye' }, ({ payload }) => {
        if (payload && payload.id === this.controllerId) this.dropController();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (!this.isConnected) this.setStatus('waiting');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.setStatus('error');
        }
      });

    return true;
  }

  // Cierra la sala: el teléfono conectado queda desvinculado y el próximo QR será otro
  async close() {
    if (!this.channel) return;
    const channel = this.channel;
    try {
      await channel.send({ type: 'broadcast', event: 'bye', payload: {} });
    } catch (e) { /* si no llega, el teléfono igual detecta el silencio por timeout */ }

    this.channel = null;
    this.roomCode = null;
    this.dropController();
    this.setStatus('closed');
    supabaseService.client.removeChannel(channel);
  }

  getControllerUrl() {
    if (!this.roomCode) return null;
    const url = new URL('controller.html', window.location.href);
    url.searchParams.set('room', this.roomCode);
    return url.href;
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    if (this.onStatusChange) this.onStatusChange(status);
  }

  send(event, payload) {
    if (!this.channel) return;
    this.channel.send({ type: 'broadcast', event, payload }).catch(() => {});
  }

  // ==================== MENSAJES DEL TELÉFONO ====================

  onHello(payload) {
    if (!payload || !payload.id) return;

    // El último teléfono en saludar toma el control (p. ej. si se recargó la página del mando)
    if (payload.id !== this.controllerId) {
      const wasConnected = this.isConnected;
      this.controllerId = payload.id;
      this.resetInput();
      if (!wasConnected) this.centerCursorOnScreen();
    }

    this.lastSeen = performance.now();
    this.lastStateJson = ''; // forzar el envío inmediato del estado (sirve de "bienvenida")
    this.setStatus('connected');
  }

  onInput(payload) {
    if (!payload || payload.id !== this.controllerId) return;
    this.lastSeen = performance.now();
    this.input = {
      x: clampUnit(payload.x),
      y: clampUnit(payload.y),
      put: !!payload.put,
      erase: !!payload.erase
    };
  }

  onAction(payload) {
    if (!payload || payload.id !== this.controllerId) return;
    this.lastSeen = performance.now();

    const engine = this.engine;
    switch (payload.type) {
      case 'tool':
        if (this.canActOnMap()) this.applyTool(payload.tool);
        break;

      case 'pause':
        if (this.canActOnMap()) {
          engine.setSpeed(engine.speed === GAME_SPEEDS.PAUSE ? GAME_SPEEDS.NORMAL : GAME_SPEEDS.PAUSE);
        }
        break;

      case 'center':
        if (engine.state === 'PLAYING') {
          engine.centerCameraOnNodes();
          this.centerCursorOnScreen();
        }
        break;

      case 'upgrade':
        if (this.isUpgradeModalOpen()) engine.upgradeSystem.chooseUpgrade(payload.index);
        break;

      // Reutilizan los mismos botones de la interfaz para no duplicar su lógica
      case 'start':
        if (engine.state === 'MENU') document.getElementById('btn-play-game').click();
        break;

      case 'retry':
        if (engine.state === 'GAMEOVER') document.getElementById('btn-retry').click();
        break;
    }
    this.lastStateJson = '';
  }

  dropController() {
    this.controllerId = null;
    this.resetInput();
    if (this.channel) this.setStatus('waiting');
  }

  resetInput() {
    this.input = { x: 0, y: 0, put: false, erase: false };
    this.endStrokes();
  }

  endStrokes() {
    this.isPainting = false;
    this.stroke.lastCell = null;
    this.wasPutHeld = false;
    this.wasEraseHeld = false;
  }

  // ==================== ACCIONES SOBRE EL MAPA ====================

  isUpgradeModalOpen() {
    const modal = document.getElementById('modal-upgrade');
    return !!modal && !modal.classList.contains('hidden');
  }

  canActOnMap() {
    return this.engine.state === 'PLAYING' && !this.isUpgradeModalOpen();
  }

  getToolCounts() {
    const e = this.engine;
    return {
      accelerator: e.protocolAccelerators,
      reinforcement: e.cableReinforcements,
      switch: e.networkSwitches,
      limiter: e.requestLimiters,
      hammer: e.hammers
    };
  }

  applyTool(toolId) {
    const tool = PAD_TOOLS.find(t => t.id === toolId);
    if (!tool) return;

    const engine = this.engine;
    const { col, row } = pixelToCell(this.cursor.x, this.cursor.y);
    const tile = engine.roadGrid.getCell(col, row);
    const node = tile && tile.type === 'node' ? tile.node : null;

    let ok = false;
    switch (tool.id) {
      case 'accelerator': ok = engine.applyAcceleratorToTile(col, row); break;
      case 'reinforcement': ok = engine.applyReinforcementToTile(col, row); break;
      case 'switch': ok = !!node && engine.applySwitchToNode(node); break;
      case 'limiter': ok = !!node && engine.applyRequestLimiterToNode(node); break;
      case 'hammer': ok = !!node && engine.applyHammerToNode(node); break;
    }

    if (ok) {
      this.send('feedback', { to: this.controllerId, ok: true, message: `${tool.icon} ${tool.name} colocado` });
      return;
    }

    engine.soundManager.playWarningAlarm();
    let message;
    if (this.getToolCounts()[tool.id] <= 0) {
      message = `No te quedan piezas de ${tool.name}`;
    } else if (tool.id === 'hammer' && node) {
      message = 'No puedes demoler la única pareja de esa forma';
    } else if (tool.target === 'road') {
      message = `Apunta a un tramo de cable sin ${tool.name}`;
    } else {
      message = `Apunta a un nodo sin ${tool.name}`;
    }
    this.send('feedback', { to: this.controllerId, ok: false, message });
  }

  // ==================== BUCLE (llamado desde Engine.update con tiempo real) ====================

  update(rawDt) {
    // Al empezar una partida nueva, el cursor arranca en el centro de la vista
    if (this.engine.state !== this.lastEngineState) {
      if (this.engine.state === 'PLAYING') this.centerCursorOnScreen();
      this.endStrokes();
      this.lastEngineState = this.engine.state;
    }

    if (!this.isConnected) return;

    if (performance.now() - this.lastSeen > PAD_TIMEOUT_MS) {
      this.dropController();
      return;
    }

    if (this.canActOnMap()) {
      this.moveCursor(rawDt);
      this.applyHeldButtons();
    } else {
      this.endStrokes();
    }

    this.pushState();
  }

  moveCursor(dt) {
    const { x, y } = this.input;
    const magnitude = Math.min(1, Math.hypot(x, y));
    if (magnitude === 0) return;

    const speed = CURSOR_MAX_SPEED * Math.pow(magnitude, CURSOR_SPEED_CURVE);
    const worldW = this.engine.roadGrid.cols * GRID_CELL_SIZE;
    const worldH = this.engine.roadGrid.rows * GRID_CELL_SIZE;
    this.cursor.x = Math.min(Math.max(0, this.cursor.x + (x / magnitude) * speed * dt), worldW - 1);
    this.cursor.y = Math.min(Math.max(0, this.cursor.y + (y / magnitude) * speed * dt), worldH - 1);

    // La cámara sigue al cursor cuando se acerca al borde de la pantalla. Solo mientras el
    // cursor se mueve, para no pelear con el desplazamiento por teclado/mouse.
    const camera = this.engine.camera;
    const { width, height } = this.engine.canvas;
    const marginX = Math.min(CURSOR_EDGE_MARGIN, width * 0.25);
    const marginY = Math.min(CURSOR_EDGE_MARGIN, height * 0.25);
    const screenX = this.cursor.x - camera.x;
    const screenY = this.cursor.y - camera.y;
    if (screenX < marginX) camera.x = this.cursor.x - marginX;
    else if (screenX > width - marginX) camera.x = this.cursor.x - (width - marginX);
    if (screenY < marginY) camera.y = this.cursor.y - marginY;
    else if (screenY > height - marginY) camera.y = this.cursor.y - (height - marginY);
    this.engine.clampCamera();
  }

  applyHeldButtons() {
    const inputHandler = this.engine.inputHandler;
    const cell = pixelToCell(this.cursor.x, this.cursor.y);
    // Celdas recorridas desde el frame anterior: si el cursor cruzó una esquina en diagonal (o
    // fue muy rápido), se rellenan los pasos intermedios para no dejar huecos en el cable
    const path = this.prevCursorCell ? cellsBetween(this.prevCursorCell, cell) : [cell];
    this.prevCursorCell = cell;

    const { put, erase } = this.input;

    if (put) {
      if (!this.wasPutHeld) {
        // Igual que con el mouse: el trazo empieza solo al presionar, no se reintenta al moverse
        this.isPainting = inputHandler.beginStroke(this.stroke, cell);
      } else if (this.isPainting) {
        for (const step of path) inputHandler.extendStroke(this.stroke, step);
      }
    } else if (this.wasPutHeld) {
      this.isPainting = false;
      this.stroke.lastCell = null;
    }

    if (erase && !put) {
      const targets = this.wasEraseHeld ? path : [cell];
      let erasedAny = false;
      for (const step of targets) {
        if (this.engine.eraseTile(step.col, step.row)) erasedAny = true;
      }
      if (erasedAny) this.engine.soundManager.playLineDeleted();
    }

    this.wasPutHeld = put;
    this.wasEraseHeld = erase && !put;
  }

  centerCursorOnScreen() {
    const camera = this.engine.camera;
    this.cursor.x = camera.x + this.engine.canvas.width / 2;
    this.cursor.y = camera.y + this.engine.canvas.height / 2;
    this.prevCursorCell = null;
  }

  buildState() {
    const engine = this.engine;
    let phase = 'playing';
    if (engine.state === 'MENU') phase = 'menu';
    else if (engine.state === 'GAMEOVER') phase = 'gameover';
    else if (this.isUpgradeModalOpen()) phase = 'upgrade';

    return {
      to: this.controllerId,
      phase,
      paused: engine.speed === GAME_SPEEDS.PAUSE,
      week: engine.currentWeek,
      budget: engine.roadBudget,
      counts: this.getToolCounts(),
      upgrades: phase === 'upgrade'
        ? engine.upgradeSystem.currentOptions.map(u => ({ icon: u.icon, name: u.name }))
        : []
    };
  }

  pushState() {
    const now = performance.now();
    if (now - this.lastStateSentAt < STATE_MIN_INTERVAL_MS) return;

    const json = JSON.stringify(this.buildState());
    if (json === this.lastStateJson && now - this.lastStateSentAt < STATE_KEEPALIVE_MS) return;

    this.lastStateJson = json;
    this.lastStateSentAt = now;
    this.send('state', JSON.parse(json));
  }

  // ==================== RENDER (espacio de mundo, dentro de la transformación de cámara) ====================

  render(ctx) {
    if (!this.isConnected || this.engine.state !== 'PLAYING') return;

    const { x, y } = this.cursor;
    this.engine.inputHandler.renderCellHighlight(ctx, x, y, 'road');

    const { put, erase } = this.input;
    const color = put ? '#22d3ee' : erase ? '#f43f5e' : '#f8fafc';
    const pulse = Math.sin(performance.now() / 180) * 1.5;
    const radius = 10 + pulse;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Cruz con un hueco en el centro, para ver bien la celda apuntada
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - radius - 6, y); ctx.lineTo(x - 4, y);
    ctx.moveTo(x + 4, y); ctx.lineTo(x + radius + 6, y);
    ctx.moveTo(x, y - radius - 6); ctx.lineTo(x, y - 4);
    ctx.moveTo(x, y + 4); ctx.lineTo(x, y + radius + 6);
    ctx.stroke();

    if (put || erase) {
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(x, y, radius - 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Etiqueta "📱" junto al cursor, para distinguirlo del puntero del mouse
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.font = '13px sans-serif';
    ctx.fillText('📱', x + radius + 4, y - radius - 2);
    ctx.restore();
  }
}

function clampUnit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}

// Celdas recorridas en pasos ortogonales desde `from` (excluida) hasta `to` (incluida)
function cellsBetween(from, to) {
  const cells = [];
  let { col, row } = from;
  while (col !== to.col || row !== to.row) {
    if (col !== to.col) col += Math.sign(to.col - col);
    else row += Math.sign(to.row - row);
    cells.push({ col, row });
  }
  return cells;
}
