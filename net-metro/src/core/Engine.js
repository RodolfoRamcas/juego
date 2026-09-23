/**
 * NETMETRO - MOTOR PRINCIPAL DE JUEGO (ENGINE)
 * Orquesta el ciclo de renderizado a 60 FPS, estado de juego, telemetría y subsistemas.
 */

import {
  TIME_CONFIG, GAME_SPEEDS, GRID_CELL_SIZE, PIECE_COST_PER_TILE,
  MAX_PACKET_LIFETIME, MAX_LOST_PACKETS, ROAD_COLOR, ROAD_GLOW, ROAD_BLOCKED_COLOR,
  GRID_COLS_FIXED, GRID_ROWS_FIXED, NODE_RECEIVE_COOLDOWN, LOAD_BALANCER_RECEIVE_COOLDOWN, SWITCH_BURST_CAPACITY,
  DDOS_RECEIVER_LOCKOUT_SECONDS, LOAD_BALANCER_DDOS_LOCKOUT_MULTIPLIER, RESTART_HOLD_SECONDS,
  FIREWALL_MAX_CHARGES, LOAD_BALANCER_MAX_CHARGES
} from '../config/constants.js';
import { GAME_CONFIG } from '../config/levels.js';
import { RoadGrid } from './RoadGrid.js';
import { Router } from './Router.js';
import { InputHandler } from './InputHandler.js';
import { TrafficGenerator } from '../systems/TrafficGenerator.js';
import { EventSystem } from '../systems/EventSystem.js';
import { UpgradeSystem } from '../systems/UpgradeSystem.js';
import { soundManager } from '../audio/SoundManager.js';
import { supabaseService } from '../services/SupabaseService.js';

const DAY_NAMES = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.state = 'MENU'; // 'MENU' | 'PLAYING' | 'UPGRADE_CHOICE' | 'GAMEOVER'
    this.currentLevel = null;
    this.speed = GAME_SPEEDS.NORMAL;

    // Colecciones de entidades
    this.nodes = [];
    this.roadGrid = new RoadGrid();
    this.activePackets = [];
    this.lossEffects = []; // marcas visuales breves donde un paquete se pierde por tiempo límite

    // Presupuesto de construcción e inventario
    this.roadBudget = 0;           // Piezas de cable disponibles (sin tope máximo)
    this.protocolAccelerators = 0; // Inicia con 0 especiales
    this.networkSwitches = 0;      // Inicia con 0 switches (se colocan a elección del jugador)
    this.cableReinforcements = 0;  // Inicia con 0 piezas de refuerzo
    this.requestLimiters = 0;      // Inicia con 0 limitadores de requests
    this.activeTool = 'road';      // 'road' | 'accelerator' | 'switch' | 'reinforcement' | 'limiter'
    this.alarmTimer = 0;

    // Reinicio rápido: mantener presionada la tecla R reinicia la partida con un layout de
    // figuras nuevo (ver update() y setRestartKeyHeld). Se exige mantenerla, no solo pulsarla,
    // para evitar perder la red construida por un toque accidental.
    this.isRestartKeyDown = false;
    this.restartHoldTimer = 0;

    // Cámara: el mundo de la grilla es más grande que la pantalla, así que la vista se
    // desplaza sobre él en vez de estar fija (evita nodos generados fuera de la vista inicial)
    this.camera = { x: 0, y: 0 };

    // Hardware y defensas: Firewall y Balanceador de Carga tienen un número limitado de usos
    // (0 = no lo tienes / se agotó). Cada ataque DDoS real que enfrentan (verificado contra el
    // contador de eventos, ver EventSystem.activeEventType) consume 1 uso; al llegar a 0 se
    // pierden y vuelven a poder salir en las recompensas semanales (ver UpgradeSystem).
    this.firewallCharges = 0;
    // Mientras esté en 1, cualquier nodo golpeado por un impacto DDoS durante el ataque ACTUAL
    // recibe solo la mitad del bloqueo de recepción normal (ver Engine.onDDoSPacketHit). Lo fija
    // EventSystem.triggerDDoS al iniciar cada ataque, según si quedaban usos del Balanceador.
    this.loadBalancerCharges = 0;
    this.loadBalancerActiveForAttack = false;

    // Presión de tiempo: paquetes perdidos por exceder su tiempo límite de entrega
    this.packetsLost = 0;

    // Tiempo y progresión
    this.currentWeek = 1;
    this.currentDayIndex = 0; // 0 (LUN) a 6 (DOM)
    this.dayTime = 0;         // 0 a 1 dentro del día

    // Telemetría y estadísticas
    this.packetsDelivered = 0;
    this.throughputGbps = 0.0;
    this.averageLatencyMs = 12;
    this.recentDeliveries = [];

    // Referencias a subsistemas
    this.soundManager = soundManager;
    this.supabaseService = supabaseService;
    this.inputHandler = new InputHandler(this);
    this.trafficGenerator = new TrafficGenerator(this);
    this.eventSystem = new EventSystem(this);
    this.upgradeSystem = new UpgradeSystem(this);

    // Ajuste dinámico de dimensiones
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());

    this.lastTimestamp = performance.now();
  }

  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;

    // El tamaño de la grilla del mapa es FIJO (GRID_COLS_FIXED x GRID_ROWS_FIXED): no depende
    // de la ventana ni de la pantalla, así que solo hace falta (re)configurarla aquí una vez
    // por resize; nunca invalida cables/nodos ya colocados (RoadGrid.configure solo cambia
    // cols/rows, no toca las celdas).
    this.roadGrid.configure(GRID_COLS_FIXED, GRID_ROWS_FIXED);
    this.clampCamera();
  }

  // Mantiene la cámara dentro de los límites del mundo de la grilla
  clampCamera() {
    const worldWidth = this.roadGrid.cols * GRID_CELL_SIZE;
    const worldHeight = this.roadGrid.rows * GRID_CELL_SIZE;
    const maxX = Math.max(0, worldWidth - this.canvas.width);
    const maxY = Math.max(0, worldHeight - this.canvas.height);
    this.camera.x = Math.min(Math.max(0, this.camera.x), maxX);
    this.camera.y = Math.min(Math.max(0, this.camera.y), maxY);
  }

  // Centra la cámara sobre el promedio de posiciones de los nodos actuales (o el centro del
  // mundo si aún no hay ninguno). Es el botón "Centrar" (🎯) del HUD.
  centerCameraOnNodes() {
    if (this.nodes.length === 0) {
      this.centerCameraOnGrid();
      return;
    }
    const avgX = this.nodes.reduce((sum, n) => sum + n.x, 0) / this.nodes.length;
    const avgY = this.nodes.reduce((sum, n) => sum + n.y, 0) / this.nodes.length;
    this.camera.x = avgX - this.canvas.width / 2;
    this.camera.y = avgY - this.canvas.height / 2;
    this.clampCamera();
  }

  // Centra la cámara sobre el centro geométrico del mapa (tamaño fijo), sin importar dónde
  // hayan quedado los nodos. Se usa al iniciar/reiniciar la partida (ver startGame).
  centerCameraOnGrid() {
    this.camera.x = (this.roadGrid.cols * GRID_CELL_SIZE - this.canvas.width) / 2;
    this.camera.y = (this.roadGrid.rows * GRID_CELL_SIZE - this.canvas.height) / 2;
    this.clampCamera();
  }

  // Modo único de Supervivencia Infinita: no hay campaña de misiones, así que arranca (o
  // reinicia) siempre la misma configuración de juego.
  startGame() {
    const levelConfig = GAME_CONFIG;

    this.currentLevel = levelConfig;
    this.state = 'PLAYING';
    this.speed = GAME_SPEEDS.NORMAL;

    // Resetear entidades y red de cables. El mapa tiene tamaño fijo (GRID_COLS_FIXED x
    // GRID_ROWS_FIXED, ver constants.js): no depende de la pantalla del jugador ni cambia entre
    // partidas; la cámara se recorre con WASD/flechas, arrastre con clic central o rueda del mouse.
    this.nodes = [];
    this.roadGrid = new RoadGrid();
    this.roadGrid.configure(GRID_COLS_FIXED, GRID_ROWS_FIXED);
    this.activePackets = [];
    this.lossEffects = [];
    this.firewallCharges = 0;
    this.loadBalancerCharges = 0;
    this.loadBalancerActiveForAttack = false;

    // Presupuesto inicial de piezas de cable e inventario especial
    this.roadBudget = levelConfig.initialRoadBudget || 40;
    this.protocolAccelerators = 0;
    this.networkSwitches = 0;
    this.cableReinforcements = 0;
    this.requestLimiters = 0;
    this.activeTool = 'road';
    this.packetsLost = 0;

    // Resetear métricas
    this.currentWeek = 1;
    this.currentDayIndex = 0;
    this.dayTime = 0;
    this.packetsDelivered = 0;
    this.throughputGbps = 0.0;
    this.averageLatencyMs = 12;
    this.recentDeliveries = [];

    // Resetear subsistemas
    this.trafficGenerator.reset();
    this.eventSystem.reset();
    this.upgradeSystem.reset();

    // Crear nodos iniciales distribuidos en la grilla, siempre en pares de la misma forma
    for (let i = 0; i < levelConfig.initialNodes; i += 2) {
      this.trafficGenerator.spawnProceduralNodePair();
    }

    // La cámara siempre arranca centrada en el centro geométrico del mapa (tamaño fijo), sin
    // importar dónde hayan quedado colocados los nodos iniciales.
    this.centerCameraOnGrid();

    // Actualizar UI
    this.updateHUDLabels();
    this.updateRoadUI();
    this.updateFirewallBadge();
    this.updateBalancerBadge();
    document.getElementById('game-hud').classList.remove('hidden');
    document.getElementById('road-tray').classList.remove('hidden');
    document.getElementById('btn-toggle-top-hud').classList.remove('hidden');
    document.getElementById('btn-toggle-bottom-hud').classList.remove('hidden');
  }

  // Coloca un tramo de cable si la celda está libre y hay presupuesto (sin feedback de UI:
  // lo maneja InputHandler para no saturar de toasts/sonidos durante un trazo de arrastre)
  paveTile(col, row) {
    if (!this.roadGrid.isOccupiable(col, row)) return false;
    if (this.roadBudget < PIECE_COST_PER_TILE) return false;

    this.roadGrid.placeRoad(col, row);
    this.roadBudget -= PIECE_COST_PER_TILE;
    this.updateRoadUI();
    this.recalculateAllRoutes();
    return true;
  }

  // Retira un tramo de cable y reembolsa su pieza. Si el tramo tenía un Acelerador de
  // Protocolo o una Pieza de Refuerzo instalados, también se devuelven esos ítems a la bandeja
  // (antes se perdían para siempre al borrar el tramo). Devuelve `false` si no había nada que
  // retirar, o un objeto informativo (siempre truthy) si tuvo éxito.
  eraseTile(col, row) {
    const cell = this.roadGrid.getCell(col, row);
    const wasBoosted = !!(cell && cell.isBoosted);
    const wasReinforced = !!(cell && cell.isReinforced);

    const removed = this.roadGrid.removeRoad(col, row);
    if (!removed) return false;

    this.roadBudget += PIECE_COST_PER_TILE;
    if (wasBoosted) {
      this.protocolAccelerators++;
    }
    if (wasReinforced) {
      this.cableReinforcements++;
    }
    this.updateRoadUI();
    this.recalculateAllRoutes();
    return { acceleratorRefunded: wasBoosted, reinforcementRefunded: wasReinforced };
  }

  applyAcceleratorToTile(col, row) {
    if (this.protocolAccelerators <= 0) return false;

    const cell = this.roadGrid.getCell(col, row);
    if (!cell || cell.type !== 'road') return false;
    if (cell.isBoosted) return false;

    cell.isBoosted = true;
    this.protocolAccelerators--;
    this.activeTool = 'road';
    this.soundManager.playLineConnected();
    this.updateRoadUI();
    return true;
  }

  applyReinforcementToTile(col, row) {
    if (this.cableReinforcements <= 0) return false;

    const cell = this.roadGrid.getCell(col, row);
    if (!cell || cell.type !== 'road') return false;
    if (cell.isReinforced) return false;

    cell.isReinforced = true;
    this.cableReinforcements--;
    this.activeTool = 'road';
    this.soundManager.playLineConnected();
    this.updateRoadUI();
    return true;
  }

  applySwitchToNode(node) {
    if (this.networkSwitches <= 0) return false;
    if (node.hasSwitch) return false;

    node.installSwitch();
    this.networkSwitches--;
    this.activeTool = 'road';
    this.soundManager.playLineConnected();
    this.updateRoadUI();
    return true;
  }

  applyRequestLimiterToNode(node) {
    if (this.requestLimiters <= 0) return false;
    if (node.hasRequestLimiter) return false;

    node.installRequestLimiter();
    this.requestLimiters--;
    this.activeTool = 'road';
    this.soundManager.playLineConnected();
    this.updateRoadUI();
    return true;
  }

  // Llamado desde main.js en cada keydown/keyup de la tecla R (y al perder el foco de la
  // ventana, para no dejar el conteo "pegado" si el jugador suelta la tecla fuera del juego).
  setRestartKeyHeld(held) {
    this.isRestartKeyDown = held;
    if (!held) {
      this.restartHoldTimer = 0;
      this.updateRestartHoldUI();
    }
  }

  // Barra de progreso semitransparente que aparece mientras se mantiene R presionada, para que
  // el reinicio se sienta intencional y nunca sea una sorpresa.
  updateRestartHoldUI() {
    const container = document.getElementById('restart-hold-indicator');
    const fill = document.getElementById('restart-hold-fill');
    if (!container || !fill) return;

    const ratio = Math.min(1, this.restartHoldTimer / RESTART_HOLD_SECONDS);
    container.classList.toggle('hidden', ratio <= 0);
    fill.style.width = `${(ratio * 100).toFixed(1)}%`;
  }

  setSpeed(speedValue) {
    this.speed = speedValue;
    document.getElementById('btn-speed-pause').classList.toggle('active', speedValue === GAME_SPEEDS.PAUSE);
    document.getElementById('btn-speed-1x').classList.toggle('active', speedValue === GAME_SPEEDS.NORMAL);
    document.getElementById('btn-speed-2x').classList.toggle('active', speedValue === GAME_SPEEDS.FAST);
  }

  attemptRoutePacket(originNode, packet) {
    const solution = Router.findShortestPathToShape(originNode, packet.targetShape, this.roadGrid);
    if (solution) {
      // Remover del búfer del nodo e iniciar tránsito por el cable
      originNode.removePacket(packet.id);
      packet.startTransit(solution.route);
      this.activePackets.push(packet);
      // Marcar la ruta como "usada" para que futuros paquetes prefieran caminos menos cargados
      this.roadGrid.markRouteLoad(solution.route);
    }
  }

  recalculateAllRoutes() {
    // Reintentar enrutar todos los paquetes que se encuentren en búfer de los nodos
    for (const node of this.nodes) {
      const waitingPackets = [...node.buffer];
      for (const pkt of waitingPackets) {
        this.attemptRoutePacket(node, pkt);
      }
    }
  }

  onPacketDelivered(packet, node) {
    this.packetsDelivered++;
    this.recentDeliveries.push(performance.now());
    this.soundManager.playPacketDelivered();

    // Cooldown de recepción: el nodo queda "enfriándose" antes de poder aceptar otro paquete,
    // así los siguientes forman una cola visible esperando su turno en la casilla de entrada.
    // El Switch reduce este enfriamiento en el nodo donde está instalado.
    const baseCooldown = node.hasSwitch ? LOAD_BALANCER_RECEIVE_COOLDOWN : NODE_RECEIVE_COOLDOWN;

    if (node.hasSwitch) {
      // El Switch conmuta varios "puertos" a la vez: acepta entregas seguidas sin cooldown
      // hasta completar la ráfaga, y recién ahí aplica el enfriamiento normal.
      node.switchBurstCount++;
      if (node.switchBurstCount >= SWITCH_BURST_CAPACITY) {
        node.receiveCooldownTimer = baseCooldown;
        node.switchBurstCount = 0;
      } else {
        node.receiveCooldownTimer = 0;
      }
    } else {
      node.receiveCooldownTimer = baseCooldown;
    }

    // Eliminar de paquetes activos
    const idx = this.activePackets.indexOf(packet);
    if (idx !== -1) {
      this.activePackets.splice(idx, 1);
    }
  }

  // Un paquete DDoS logró llegar al nodo receptor: no cuenta como entrega legítima (no suma a
  // las métricas de rendimiento), y en vez del cooldown normal, bloquea por completo la
  // recepción del nodo durante DDOS_RECEIVER_LOCKOUT_SECONDS (la mitad si el Balanceador de
  // Carga está activo). Cada impacto reinicia el bloqueo desde cero, así que el conteo real
  // solo arranca tras el ÚLTIMO paquete DDoS que llegue.
  onDDoSPacketHit(packet, node) {
    const lockoutDuration = this.loadBalancerActiveForAttack
      ? DDOS_RECEIVER_LOCKOUT_SECONDS * LOAD_BALANCER_DDOS_LOCKOUT_MULTIPLIER
      : DDOS_RECEIVER_LOCKOUT_SECONDS;

    node.receiveCooldownTimer = lockoutDuration;
    node.ddosLockoutTimer = lockoutDuration;
    node.ddosLockoutMaxDuration = lockoutDuration;
    node.switchBurstCount = 0;
    this.soundManager.playWarningAlarm();

    const idx = this.activePackets.indexOf(packet);
    if (idx !== -1) {
      this.activePackets.splice(idx, 1);
    }
  }

  // Un paquete DDoS se quedó quieto más de DDOS_PACKET_STATIONARY_DROP_TIME (cable cortado o
  // congestión bloqueando el paso): es la defensa esperada contra el ataque, así que se
  // descarta SIN sumar al contador de paquetes perdidos por tiempo límite.
  onDDoSPacketDropped(packet, position) {
    if (position) {
      this.spawnLossEffect(position.x, position.y, 'ddos_blocked');
    }

    const idx = this.activePackets.indexOf(packet);
    if (idx !== -1) {
      this.activePackets.splice(idx, 1);
    }
  }

  // Recorre todos los paquetes (en búfer y en tránsito) y descarta los que superan su
  // tiempo límite de vida. Es la principal fuente de presión de tiempo real del juego.
  updatePacketLifetimes(dt) {
    for (let i = this.activePackets.length - 1; i >= 0; i--) {
      const pkt = this.activePackets[i];
      pkt.totalLifetime += dt;
      if (pkt.totalLifetime >= MAX_PACKET_LIFETIME) {
        this.activePackets.splice(i, 1);
        this.onPacketLost(pkt, pkt.getCurrentPosition());
        if (this.state !== 'PLAYING') return;
      }
    }

    for (const node of this.nodes) {
      for (let i = node.buffer.length - 1; i >= 0; i--) {
        const pkt = node.buffer[i];
        pkt.totalLifetime += dt;
        if (pkt.totalLifetime >= MAX_PACKET_LIFETIME) {
          node.buffer.splice(i, 1);
          this.onPacketLost(pkt, { x: node.x, y: node.y });
          if (this.state !== 'PLAYING') return;
        }
      }
    }
  }

  onPacketLost(packet, position) {
    this.packetsLost++;
    this.soundManager.playWarningAlarm();
    // Sin toast por cada paquete perdido (saturaría la pantalla): el contador del HUD ya lo
    // refleja, pero sí se marca visualmente el lugar exacto donde se perdió (ver spawnLossEffect)
    if (position) {
      this.spawnLossEffect(position.x, position.y);
    }

    if (this.packetsLost >= MAX_LOST_PACKETS) {
      this.triggerGameOver(`Colapso logístico: se superó el máximo de ${MAX_LOST_PACKETS} paquetes perdidos por tiempo de entrega excedido.`);
    }
  }

  // Marca visual breve en el punto exacto donde un paquete se perdió o se descartó. `type`
  // 'lost' (X roja, por defecto) es una pérdida real por tiempo límite; 'ddos_blocked' (check
  // verde) es un paquete DDoS neutralizado, que no cuenta como pérdida. Se autodestruye sola.
  spawnLossEffect(x, y, type = 'lost') {
    this.lossEffects.push({ x, y, timer: 0, duration: 0.9, type });
  }

  updateLossEffects(dt) {
    for (let i = this.lossEffects.length - 1; i >= 0; i--) {
      this.lossEffects[i].timer += dt;
      if (this.lossEffects[i].timer >= this.lossEffects[i].duration) {
        this.lossEffects.splice(i, 1);
      }
    }
  }

  update(timestamp) {
    const rawDt = (timestamp - this.lastTimestamp) / 1000;
    this.lastTimestamp = timestamp;

    // Limitar delta time para evitar saltos si la pestaña estuvo oculta
    const clampedRawDt = Math.min(rawDt, 0.1);
    const dt = clampedRawDt * this.speed;

    // El desplazamiento de cámara con teclado usa tiempo real (no escalado por velocidad de
    // simulación): debe seguir funcionando aunque el juego esté en pausa (velocidad 0)
    if (this.state === 'PLAYING') {
      this.inputHandler.updateCameraPan(clampedRawDt);
    }

    // Reinicio rápido (mantener R): también usa tiempo real, para que funcione incluso en
    // pausa. Al completar el umbral, reinicia la partida con un layout de figuras nuevo
    // (startGame() ya coloca los nodos iniciales en posiciones aleatorias).
    if (this.state === 'PLAYING' && this.isRestartKeyDown) {
      this.restartHoldTimer += clampedRawDt;
      this.updateRestartHoldUI();
      if (this.restartHoldTimer >= RESTART_HOLD_SECONDS) {
        this.isRestartKeyDown = false;
        this.restartHoldTimer = 0;
        this.startGame();
        return;
      }
    } else if (this.restartHoldTimer > 0) {
      // Se soltó la tecla, o la partida terminó (Game Over) mientras se mantenía presionada:
      // no dejar la barra de progreso a medias.
      this.restartHoldTimer = 0;
      this.updateRestartHoldUI();
    }

    if (this.state === 'PLAYING') {
      // 1. Reloj de juego y progresión de días
      this.updateClock(dt);

      // 2. Actualizar nodos y verificar posible saturación crítica o abandono sin conexión
      let anySaturating = false;
      for (const node of this.nodes) {
        const isConnected = node.role !== 'receiver' || this.roadGrid.hasAdjacentRoad(node.col, node.row);
        const result = node.update(dt, isConnected);
        if (result.isOverflowed) {
          this.triggerGameOver(`Colapso de red en ${node.label} (${node.shape.toUpperCase()}) por Buffer Overflow.`);
          return;
        }
        if (result.isDisconnected) {
          this.triggerGameOver(`Colapso de red: ${node.label} (${node.shape.toUpperCase()}) quedó sin ningún cable conectado durante demasiado tiempo.`);
          return;
        }
        if (node.overflowTime > 0 || node.disconnectedTime > 0) {
          anySaturating = true;
        }
      }

      // Alerta sonora periódica mientras un nodo se esté saturando o desconectado (para
      // alertar al jugador)
      if (anySaturating) {
        this.alarmTimer = (this.alarmTimer || 0) + dt;
        if (this.alarmTimer >= 1.5) {
          this.alarmTimer = 0;
          this.soundManager.playWarningAlarm();
        }
      } else {
        this.alarmTimer = 0;
      }

      // 3. Actualizar la grilla de cableado (tramos bloqueados por mantenimiento). Si algún
      // corte se repara, reintentar de inmediato el enrutamiento de los paquetes en espera:
      // el tráfico debe retomar su ritmo normal sin depender de que el jugador construya algo.
      if (this.roadGrid.update(dt)) {
        this.recalculateAllRoutes();
      }

      // 4. Descartar paquetes que excedieron su tiempo límite de entrega
      this.updatePacketLifetimes(dt);
      if (this.state !== 'PLAYING') return; // pudo dispararse Game Over por paquetes perdidos
      this.updateLossEffects(dt);

      // 5. Actualizar paquetes en tránsito
      for (let i = this.activePackets.length - 1; i >= 0; i--) {
        const pkt = this.activePackets[i];
        const event = pkt.update(dt, this);

        if (event) {
          if (event.status === 'delivered') {
            this.onPacketDelivered(event.packet, event.node);
          } else if (event.status === 'ddos_hit') {
            this.onDDoSPacketHit(event.packet, event.node);
          } else if (event.status === 'ddos_dropped') {
            this.onDDoSPacketDropped(event.packet, event.position);
          } else if (event.status === 'reroute') {
            this.activePackets.splice(i, 1);
            this.attemptRoutePacket(event.node, event.packet);
          }
        }
      }

      // 6. Subsistemas de tráfico y eventos
      this.trafficGenerator.update(dt);
      this.eventSystem.update(dt);

      // 7. Calcular telemetría
      this.updateTelemetry();
    }
  }

  updateClock(dt) {
    const dayDuration = TIME_CONFIG.SECONDS_PER_DAY;
    this.dayTime += dt / dayDuration;

    if (this.dayTime >= 1) {
      this.dayTime = 0;
      this.currentDayIndex++;

      // Fin de la semana (Domingo a la medianoche): la red sigue creciendo sin límite
      // (Supervivencia Infinita no tiene condición de victoria), así que solo se otorgan
      // las recompensas semanales.
      if (this.currentDayIndex >= TIME_CONFIG.DAYS_PER_WEEK) {
        this.currentDayIndex = 0;
        this.currentWeek++;

        // Mostrar menú de recompensas semanales
        this.upgradeSystem.showWeeklyRewardModal();
      }
    }

    // Actualizar elementos visuales del reloj
    document.getElementById('hud-day-name').textContent = DAY_NAMES[this.currentDayIndex];
    const hour = Math.floor(this.dayTime * 24).toString().padStart(2, '0');
    const min = Math.floor((this.dayTime * 24 % 1) * 60).toString().padStart(2, '0');
    document.getElementById('hud-time').textContent = `${hour}:${min}`;
    document.getElementById('hud-week-badge').textContent = `SEM ${this.currentWeek}`;

    const totalWeekProgress = ((this.currentDayIndex + this.dayTime) / TIME_CONFIG.DAYS_PER_WEEK) * 100;
    document.getElementById('week-progress-bar').style.width = `${totalWeekProgress}%`;
  }

  updateTelemetry() {
    // Filtrar entregas de los últimos 4 segundos para calcular throughput dinámico
    const now = performance.now();
    this.recentDeliveries = this.recentDeliveries.filter(t => now - t < 4000);
    const rate = this.recentDeliveries.length / 4.0; // paquetes por segundo
    this.throughputGbps = (rate * 0.85).toFixed(1);

    // Latencia simulada en función del tamaño de la red de cableado y la congestión
    const roadTileCount = this.roadGrid.getAllRoadCells().length;
    const baseLatency = 8 + Math.min(30, roadTileCount * 0.3);
    const congestionFactor = this.nodes.reduce((acc, n) => acc + n.buffer.length, 0) * 1.5;
    this.averageLatencyMs = Math.round(baseLatency + congestionFactor);

    document.getElementById('hud-packets-count').textContent = `${this.packetsDelivered} pkts`;
    document.getElementById('hud-bandwidth').textContent = `${this.throughputGbps} Gbps`;

    const latencyEl = document.getElementById('hud-latency');
    latencyEl.textContent = `${this.averageLatencyMs} ms`;
    latencyEl.className = 'hud-value ' + (this.averageLatencyMs > 40 ? 'text-crit' : (this.averageLatencyMs > 25 ? 'text-warn' : 'text-good'));

    const lostEl = document.getElementById('hud-packets-lost');
    if (lostEl) {
      lostEl.textContent = `${this.packetsLost} / ${MAX_LOST_PACKETS}`;
      lostEl.className = 'hud-value ' + (this.packetsLost >= MAX_LOST_PACKETS - 2 ? 'text-crit' : (this.packetsLost > 0 ? 'text-warn' : 'text-good'));
    }
  }

  triggerGameOver(cause) {
    this.state = 'GAMEOVER';
    this.soundManager.playGameOver();

    document.getElementById('gameover-cause').textContent = cause;
    document.getElementById('stat-go-packets').textContent = this.packetsDelivered;
    document.getElementById('stat-go-time').textContent = `Semana ${this.currentWeek}`;
    document.getElementById('stat-go-throughput').textContent = `${this.throughputGbps} Gbps`;

    document.getElementById('modal-gameover').classList.remove('hidden');
  }

  render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Todo el contenido del mundo (grilla, cables, paquetes, nodos) se dibuja desplazado por
    // la cámara: así la vista puede recorrer libremente un mundo más grande que la pantalla
    this.ctx.save();
    this.ctx.translate(-this.camera.x, -this.camera.y);

    // 1. Malla tenue de la grilla (guía visual para tender cable)
    this.renderGridOverlay();

    // 2. Dibujar la red de cableado
    this.renderRoadTiles();

    // 3. Previsualización de arrastre / resaltado de celda bajo el cursor
    this.inputHandler.render(this.ctx);

    // 4. Dibujar paquetes en tránsito
    for (const packet of this.activePackets) {
      packet.render(this.ctx);
    }

    // 5. Dibujar nodos
    for (const node of this.nodes) {
      node.render(this.ctx);
    }

    // 5.5 Marcas de "paquete perdido" (X roja + anillo) en el punto exacto donde expiraron
    this.renderLossEffects();

    this.ctx.restore();

    // 6. Indicadores en el borde de pantalla (espacio de pantalla, sin cámara) que apuntan
    // hacia nodos fuera de la vista actual: así nunca quedan "invisibles" al generarse lejos
    this.renderOffscreenIndicators();
  }

  renderGridOverlay() {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
    ctx.lineWidth = 1;

    const worldWidth = this.roadGrid.cols * GRID_CELL_SIZE;
    const worldHeight = this.roadGrid.rows * GRID_CELL_SIZE;

    for (let c = 0; c <= this.roadGrid.cols; c++) {
      const x = c * GRID_CELL_SIZE;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, worldHeight);
      ctx.stroke();
    }
    for (let r = 0; r <= this.roadGrid.rows; r++) {
      const y = r * GRID_CELL_SIZE;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(worldWidth, y);
      ctx.stroke();
    }

    // Borde del mundo, para percibir los límites del mapa al llegar a una esquina
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, worldWidth, worldHeight);
    ctx.restore();
  }

  // Dibuja una breve marca en cada punto donde un paquete se acaba de perder o descartar, y se
  // desvanece sola. 'lost' (X roja): pérdida real por tiempo límite. 'ddos_blocked' (check
  // verde): paquete DDoS neutralizado por quedarse sin avanzar, no cuenta como pérdida.
  renderLossEffects() {
    if (this.lossEffects.length === 0) return;
    const ctx = this.ctx;

    for (const effect of this.lossEffects) {
      const isBlocked = effect.type === 'ddos_blocked';
      const color = isBlocked ? '#10b981' : '#f43f5e';
      const t = Math.min(1, effect.timer / effect.duration);
      const alpha = 1 - t;
      const riseOffset = t * 20; // sube un poco mientras se desvanece, como aviso flotante

      ctx.save();
      ctx.translate(effect.x, effect.y - riseOffset);
      ctx.globalAlpha = alpha;

      // Anillo expansivo
      ctx.beginPath();
      ctx.arc(0, 0, 8 + t * 16, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (isBlocked) {
        // Marca "✓"
        ctx.moveTo(-6, 0);
        ctx.lineTo(-1.5, 5);
        ctx.lineTo(6, -6);
      } else {
        // Marca "X"
        ctx.moveTo(-6, -6);
        ctx.lineTo(6, 6);
        ctx.moveTo(6, -6);
        ctx.lineTo(-6, 6);
      }
      ctx.stroke();

      // Etiqueta
      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.fillText(isBlocked ? 'DDOS BLOQUEADO' : 'PERDIDO', 0, -20);

      ctx.restore();
    }
  }

  // Dibuja pequeñas flechas en el borde de la pantalla apuntando hacia nodos que quedaron
  // fuera de la vista actual de la cámara (p. ej. recién generados lejos del jugador)
  renderOffscreenIndicators() {
    if (this.state !== 'PLAYING' || this.nodes.length === 0) return;

    const ctx = this.ctx;
    const margin = 30;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    const halfW = Math.max(1, cx - margin);
    const halfH = Math.max(1, cy - margin);

    for (const node of this.nodes) {
      const screenX = node.x - this.camera.x;
      const screenY = node.y - this.camera.y;
      const isVisible = screenX > -node.radius && screenX < this.canvas.width + node.radius &&
                         screenY > -node.radius && screenY < this.canvas.height + node.radius;
      if (isVisible) continue;

      const dx = screenX - cx || 0.0001;
      const dy = screenY - cy || 0.0001;
      const angle = Math.atan2(dy, dx);
      const scale = Math.min(Math.abs(halfW / dx), Math.abs(halfH / dy));
      const ix = cx + dx * scale;
      const iy = cy + dy * scale;

      ctx.save();
      ctx.translate(ix, iy);
      ctx.rotate(angle);
      ctx.fillStyle = node.isCritical ? '#f43f5e' : '#38bdf8';
      ctx.shadowColor = node.isCritical ? 'rgba(244, 63, 94, 0.8)' : 'rgba(56, 189, 248, 0.7)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(11, 0);
      ctx.lineTo(-6, 7);
      ctx.lineTo(-6, -7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  renderRoadTiles() {
    const ctx = this.ctx;
    const inset = 6; // margen visual entre tiles vecinos
    const size = GRID_CELL_SIZE - inset;
    const half = GRID_CELL_SIZE / 2;

    for (const { col, row, cell } of this.roadGrid.getAllRoadCells()) {
      const cx = col * GRID_CELL_SIZE + half;
      const cy = row * GRID_CELL_SIZE + half;

      ctx.save();
      if (cell.isBlocked) {
        ctx.fillStyle = 'rgba(244, 63, 94, 0.25)';
        ctx.strokeStyle = ROAD_BLOCKED_COLOR;
        ctx.setLineDash([5, 4]);
      } else if (cell.isBoosted) {
        ctx.fillStyle = 'rgba(245, 158, 11, 0.28)';
        ctx.strokeStyle = '#f59e0b';
        ctx.shadowColor = 'rgba(245, 158, 11, 0.5)';
        ctx.shadowBlur = 8;
      } else {
        // Tinte violeta proporcional a la carga reciente: muestra visualmente qué tramos
        // está evitando el Router por congestión (se satura alrededor de 6 unidades de carga)
        const loadRatio = Math.min(1, (cell.load || 0) / 6);
        if (loadRatio > 0.15) {
          ctx.fillStyle = `rgba(168, 85, 247, ${(0.12 + loadRatio * 0.35).toFixed(2)})`;
          ctx.strokeStyle = '#a855f7';
          ctx.shadowColor = 'rgba(168, 85, 247, 0.45)';
          ctx.shadowBlur = 4 + loadRatio * 6;
        } else {
          ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
          ctx.strokeStyle = ROAD_COLOR;
          ctx.shadowColor = ROAD_GLOW;
          ctx.shadowBlur = 4;
        }
      }
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.roundRect(cx - size / 2, cy - size / 2, size, size, 8);
      ctx.fill();
      ctx.stroke();

      // Marco interior verde para tramos reforzados: se dibuja encima de cualquier otro
      // estado (bloqueado, acelerado o congestionado) para que siempre sea visible.
      if (cell.isReinforced) {
        ctx.shadowBlur = 0;
        ctx.setLineDash([]);
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(cx - size / 2 + 4, cy - size / 2 + 4, size - 8, size - 8, 5);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  loop(timestamp) {
    this.update(timestamp);
    this.render();
    requestAnimationFrame((t) => this.loop(t));
  }

  start() {
    requestAnimationFrame((t) => this.loop(t));
  }

  // Pestaña central semitransparente reservada para los eventos grandes (DDoS, Demanda Pico):
  // solo muestra el nombre del evento, sin detalles.
  showEventBanner(message, type = 'info') {
    const container = document.getElementById('event-banner-container');
    if (!container) return;

    const banner = document.createElement('div');
    banner.className = `event-banner ${type}`;
    banner.textContent = message;

    container.appendChild(banner);
    setTimeout(() => {
      banner.style.opacity = '0';
      banner.style.transform = 'translateY(-8px)';
      banner.style.transition = 'opacity 0.3s, transform 0.3s';
      setTimeout(() => banner.remove(), 300);
    }, 2200);
  }

  updateHUDLabels() {
    if (this.currentLevel) {
      document.getElementById('hud-mission-name').textContent = this.currentLevel.name;
    }
  }

  // Muestra/oculta el icono 🛡️ en la esquina superior del HUD mientras queden usos del
  // Firewall, y el número de usos restantes.
  updateFirewallBadge() {
    const badge = document.getElementById('firewall-badge');
    if (badge) {
      badge.classList.toggle('hidden', this.firewallCharges <= 0);
      badge.textContent = `🛡️×${this.firewallCharges}`;
    }
  }

  // Igual que updateFirewallBadge, pero para el Balanceador de Carga (⚖️).
  updateBalancerBadge() {
    const badge = document.getElementById('balancer-badge');
    if (badge) {
      badge.classList.toggle('hidden', this.loadBalancerCharges <= 0);
      badge.textContent = `⚖️×${this.loadBalancerCharges}`;
    }
  }

  updateRoadUI() {
    // 1. Contador de presupuesto de piezas de cable
    const countEl = document.getElementById('road-budget-count');
    if (countEl) {
      countEl.textContent = `${this.roadBudget} piezas`;
      countEl.className = `tray-counter badge ${this.roadBudget <= 5 ? 'text-crit' : ''}`;
    }

    // 2. Herramienta de tendido de cable (siempre disponible)
    const toolRoad = document.getElementById('tool-road');
    if (toolRoad) {
      toolRoad.classList.toggle('active', this.activeTool === 'road');
    }

    // 3. Botones de hardware especial (inician en 0)
    const badgeAcc = document.getElementById('badge-count-accelerator');
    const toolAcc = document.getElementById('tool-accelerator');
    if (badgeAcc && toolAcc) {
      badgeAcc.textContent = `${this.protocolAccelerators} disp.`;
      toolAcc.classList.toggle('disabled', this.protocolAccelerators <= 0);
      toolAcc.classList.toggle('active', this.activeTool === 'accelerator');
    }

    const badgeSwitch = document.getElementById('badge-count-switch');
    const toolSwitch = document.getElementById('tool-switch');
    if (badgeSwitch && toolSwitch) {
      badgeSwitch.textContent = `${this.networkSwitches} disp.`;
      toolSwitch.classList.toggle('disabled', this.networkSwitches <= 0);
      toolSwitch.classList.toggle('active', this.activeTool === 'switch');
    }

    const badgeReinforcement = document.getElementById('badge-count-reinforcement');
    const toolReinforcement = document.getElementById('tool-reinforcement');
    if (badgeReinforcement && toolReinforcement) {
      badgeReinforcement.textContent = `${this.cableReinforcements} disp.`;
      toolReinforcement.classList.toggle('disabled', this.cableReinforcements <= 0);
      toolReinforcement.classList.toggle('active', this.activeTool === 'reinforcement');
    }

    const badgeLimiter = document.getElementById('badge-count-limiter');
    const toolLimiter = document.getElementById('tool-limiter');
    if (badgeLimiter && toolLimiter) {
      badgeLimiter.textContent = `${this.requestLimiters} disp.`;
      toolLimiter.classList.toggle('disabled', this.requestLimiters <= 0);
      toolLimiter.classList.toggle('active', this.activeTool === 'limiter');
    }
  }
}
