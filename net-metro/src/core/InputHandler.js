/**
 * NETMETRO - MANEJADOR DE ENTRADA (INPUT HANDLER)
 * Control por arrastre: mantén presionado y arrastra el mouse para tender tramos de
 * cable contiguos. Clic derecho retira un tramo. Las herramientas especiales
 * (Acelerador de Protocolo, Balanceador) usan clic simple sobre su objetivo.
 *
 * Cámara: el mundo de la grilla es más grande que la pantalla, así que además se puede
 * desplazar la vista con WASD/flechas, arrastrando con el clic central del mouse, o con
 * la rueda (Shift+rueda para desplazamiento horizontal).
 */

import { pixelToCell, areAdjacentCells } from './Grid.js';
import { GRID_CELL_SIZE, CAMERA_PAN_SPEED } from '../config/constants.js';

const PAN_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class InputHandler {
  constructor(engine) {
    this.engine = engine;
    this.canvas = engine.canvas;

    // mouseX/mouseY se guardan en coordenadas de MUNDO (ya con el offset de cámara aplicado),
    // no de pantalla, ya que todo el contenido del juego vive en espacio de mundo.
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseInsideCanvas = false;

    // Estado del trazo de tendido de cable por arrastre
    this.isPaintingRoad = false;
    this.lastPaintedCell = null; // { col, row } de la última celda tocada en este trazo
    this.budgetWarnedThisStroke = false;

    // Estado de desplazamiento de cámara (pan) por arrastre con clic central
    this.isPanning = false;
    this.panStartClient = { x: 0, y: 0 };
    this.panStartCamera = { x: 0, y: 0 };

    // Teclas de desplazamiento de cámara actualmente presionadas
    this.keysPressed = new Set();

    this.setupListeners();
  }

  setupListeners() {
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', () => { this.endPaintStroke(); this.endPan(); });
    this.canvas.addEventListener('mouseleave', () => { this.mouseInsideCanvas = false; });
    this.canvas.addEventListener('mouseenter', () => { this.mouseInsideCanvas = true; });
    this.canvas.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));

    // Soporte táctil
    this.canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    window.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    window.addEventListener('touchend', () => this.endPaintStroke());
  }

  getCanvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }

  // Convierte coordenadas de pantalla (canvas) a coordenadas de mundo, aplicando el offset
  // actual de la cámara
  screenToWorld(coords) {
    return {
      x: coords.x + this.engine.camera.x,
      y: coords.y + this.engine.camera.y
    };
  }

  getNodeAt(x, y, radiusTolerance = 26) {
    for (const node of this.engine.nodes) {
      const dist = Math.hypot(node.x - x, node.y - y);
      if (dist <= radiusTolerance) {
        return node;
      }
    }
    return null;
  }

  onMouseDown(e) {
    // Clic central (botón 1) o Alt+clic izquierdo: iniciar desplazamiento de cámara (pan),
    // sin importar el estado del juego (permite mirar el mapa incluso en pausa)
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      this.startPan(e);
      return;
    }

    if (this.engine.state !== 'PLAYING') return;
    if (e.button !== 0) return; // solo clic izquierdo inicia acciones (derecho = borrar, ver onContextMenu)

    const coords = this.getCanvasCoords(e);
    const world = this.screenToWorld(coords);
    this.mouseX = world.x;
    this.mouseY = world.y;

    if (this.engine.activeTool === 'accelerator') {
      const cell = pixelToCell(world.x, world.y);
      this.engine.applyAcceleratorToTile(cell.col, cell.row);
      return;
    }

    if (this.engine.activeTool === 'reinforcement') {
      const cell = pixelToCell(world.x, world.y);
      this.engine.applyReinforcementToTile(cell.col, cell.row);
      return;
    }

    if (this.engine.activeTool === 'switch') {
      const clickedNode = this.getNodeAt(world.x, world.y);
      if (clickedNode) {
        this.engine.applySwitchToNode(clickedNode);
      }
      return;
    }

    if (this.engine.activeTool === 'limiter') {
      const clickedNode = this.getNodeAt(world.x, world.y);
      if (clickedNode) {
        this.engine.applyRequestLimiterToNode(clickedNode);
      }
      return;
    }

    // Herramienta estándar: tender cable por arrastre
    this.startPaintStroke(world.x, world.y);
  }

  startPan(e) {
    this.isPanning = true;
    this.panStartClient = { x: e.clientX, y: e.clientY };
    this.panStartCamera = { x: this.engine.camera.x, y: this.engine.camera.y };
    this.canvas.style.cursor = 'grabbing';
  }

  endPan() {
    if (!this.isPanning) return;
    this.isPanning = false;
    this.canvas.style.cursor = '';
  }

  startPaintStroke(x, y) {
    const cell = pixelToCell(x, y);
    if (!this.engine.roadGrid.isInBounds(cell.col, cell.row)) return;

    this.budgetWarnedThisStroke = false;
    const existing = this.engine.roadGrid.getCell(cell.col, cell.row);

    if (existing && (existing.type === 'road' || existing.type === 'node')) {
      // Continuar el trazo desde infraestructura ya existente, sin costo
      this.lastPaintedCell = cell;
      this.isPaintingRoad = true;
      return;
    }

    if (this.engine.paveTile(cell.col, cell.row)) {
      this.engine.soundManager.playLineConnected();
      this.lastPaintedCell = cell;
      this.isPaintingRoad = true;
    } else {
      this.engine.soundManager.playWarningAlarm();
    }
  }

  continuePaintStroke(x, y) {
    const cell = pixelToCell(x, y);
    if (!this.engine.roadGrid.isInBounds(cell.col, cell.row)) return;
    if (!this.lastPaintedCell) { this.lastPaintedCell = cell; return; }
    if (cell.col === this.lastPaintedCell.col && cell.row === this.lastPaintedCell.row) return;
    if (!areAdjacentCells(this.lastPaintedCell.col, this.lastPaintedCell.row, cell.col, cell.row)) return; // el cursor saltó una celda: se ignora

    const existing = this.engine.roadGrid.getCell(cell.col, cell.row);
    if (existing && (existing.type === 'road' || existing.type === 'node')) {
      this.lastPaintedCell = cell;
      return;
    }

    if (this.engine.paveTile(cell.col, cell.row)) {
      this.lastPaintedCell = cell;
    } else if (!this.budgetWarnedThisStroke) {
      this.budgetWarnedThisStroke = true;
      this.engine.soundManager.playWarningAlarm();
    }
  }

  endPaintStroke() {
    this.isPaintingRoad = false;
    this.lastPaintedCell = null;
  }

  onMouseMove(e) {
    if (this.isPanning) {
      // El desplazamiento se calcula en píxeles de cliente convertidos a píxeles de canvas,
      // para que el arrastre siga al cursor 1:1 aunque el canvas esté escalado por CSS
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      const dx = (this.panStartClient.x - e.clientX) * scaleX;
      const dy = (this.panStartClient.y - e.clientY) * scaleY;
      this.engine.camera.x = this.panStartCamera.x + dx;
      this.engine.camera.y = this.panStartCamera.y + dy;
      this.engine.clampCamera();
      return;
    }

    const coords = this.getCanvasCoords(e);
    const world = this.screenToWorld(coords);
    this.mouseX = world.x;
    this.mouseY = world.y;

    if (this.isPaintingRoad && this.engine.state === 'PLAYING') {
      this.continuePaintStroke(world.x, world.y);
    }
  }

  onContextMenu(e) {
    e.preventDefault();
    if (this.engine.state !== 'PLAYING') return;

    const coords = this.getCanvasCoords(e);
    const world = this.screenToWorld(coords);
    const cell = pixelToCell(world.x, world.y);

    const result = this.engine.eraseTile(cell.col, cell.row);
    if (result) {
      this.engine.soundManager.playLineDeleted();
    }
  }

  onWheel(e) {
    if (this.engine.state !== 'PLAYING') return;
    e.preventDefault();

    if (e.shiftKey) {
      // Shift+rueda: desplazamiento horizontal (usa deltaY del mouse tradicional o deltaX de trackpad)
      this.engine.camera.x += (e.deltaY !== 0 ? e.deltaY : e.deltaX);
    } else {
      this.engine.camera.x += e.deltaX;
      this.engine.camera.y += e.deltaY;
    }
    this.engine.clampCamera();
  }

  onKeyDown(e) {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (PAN_KEYS.has(e.code)) {
      this.keysPressed.add(e.code);
    }
  }

  onKeyUp(e) {
    this.keysPressed.delete(e.code);
  }

  // Desplaza la cámara según las teclas de movimiento actualmente presionadas. Se llama con
  // tiempo real (no escalado por velocidad de simulación) para que funcione incluso en pausa.
  updateCameraPan(dt) {
    if (this.keysPressed.size === 0) return;

    let dx = 0;
    let dy = 0;
    if (this.keysPressed.has('KeyA') || this.keysPressed.has('ArrowLeft')) dx -= 1;
    if (this.keysPressed.has('KeyD') || this.keysPressed.has('ArrowRight')) dx += 1;
    if (this.keysPressed.has('KeyW') || this.keysPressed.has('ArrowUp')) dy -= 1;
    if (this.keysPressed.has('KeyS') || this.keysPressed.has('ArrowDown')) dy += 1;
    if (dx === 0 && dy === 0) return;

    // Normalizar para no desplazarse más rápido en diagonal
    const len = Math.hypot(dx, dy);
    this.engine.camera.x += (dx / len) * CAMERA_PAN_SPEED * dt;
    this.engine.camera.y += (dy / len) * CAMERA_PAN_SPEED * dt;
    this.engine.clampCamera();
  }

  onTouchStart(e) {
    e.preventDefault();
    this.onMouseDown({ ...e, button: 0 });
  }

  onTouchMove(e) {
    e.preventDefault();
    this.onMouseMove(e);
  }

  render(ctx) {
    if (this.engine.state !== 'PLAYING' || !this.mouseInsideCanvas || this.isPanning) return;

    const cell = pixelToCell(this.mouseX, this.mouseY);
    if (!this.engine.roadGrid.isInBounds(cell.col, cell.row)) return;

    const existing = this.engine.roadGrid.getCell(cell.col, cell.row);

    let color = '#22d3ee'; // válido para tender cable
    if (this.engine.activeTool === 'accelerator') {
      color = existing && existing.type === 'road' && !existing.isBoosted ? '#f59e0b' : '#f43f5e';
    } else if (this.engine.activeTool === 'switch') {
      color = existing && existing.type === 'node' && !existing.node.hasSwitch ? '#06b6d4' : '#f43f5e';
    } else if (this.engine.activeTool === 'reinforcement') {
      color = existing && existing.type === 'road' && !existing.isReinforced ? '#10b981' : '#f43f5e';
    } else if (this.engine.activeTool === 'limiter') {
      color = existing && existing.type === 'node' && !existing.node.hasRequestLimiter ? '#22c55e' : '#f43f5e';
    } else if (existing) {
      color = existing.type === 'node' ? '#22d3ee' : '#94a3b8'; // ya hay cable/nodo: se puede continuar el trazo gratis
    }

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.roundRect(cell.col * GRID_CELL_SIZE + 2, cell.row * GRID_CELL_SIZE + 2, GRID_CELL_SIZE - 4, GRID_CELL_SIZE - 4, 6);
    ctx.stroke();
    ctx.restore();
  }
}
