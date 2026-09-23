/**
 * NETMETRO - GENERADOR PROCEDURAL DE TRÁFICO Y NODOS
 * Gestiona la aparición estocástica de nuevas estaciones de red y generación de paquetes.
 */

import { Node } from '../entities/Node.js';
import { Packet } from '../entities/Packet.js';
import {
  NODE_SHAPES, PACKET_RATE_BOOST_FROM_WEEK4, NODE_SPAWN_INTERVAL_MULTIPLIER_FROM_WEEK4,
  PACKET_RATE_BOOST_FROM_WEEK5, PACKET_RATE_JITTER_FROM_WEEK5, HARD_MODE_FROM_WEEK,
  DDOS_PACKET_COLOR, REQUEST_LIMITER_DDOS_SKIP_CHANCE
} from '../config/constants.js';

export class TrafficGenerator {
  constructor(engine) {
    this.engine = engine;
    this.nodeSpawnTimer = 0;
    this.packetSpawnTimer = 0;
    // Multiplicador de variación del intervalo de generación de paquetes, recalculado al azar
    // cada vez que se dispara un paquete desde HARD_MODE_FROM_WEEK (ver update()).
    this.packetSpawnJitter = 1;
    this.nodeCounter = 1;
  }

  reset() {
    this.nodeSpawnTimer = 0;
    this.packetSpawnTimer = 0;
    this.packetSpawnJitter = 1;
    this.nodeCounter = 1;
  }

  update(dt) {
    const config = this.engine.currentLevel;
    if (!config) return;

    // Desde la Semana 4 la red crece y genera tráfico más rápido, encima del escalado semanal
    // normal (trafficMultiplierPerWeek ya sube cada semana desde el inicio).
    const isWeek4OrLater = this.engine.currentWeek >= 4;
    const isHardMode = this.engine.currentWeek >= HARD_MODE_FROM_WEEK;

    // 1. Aparición procedural de nuevos nodos (siempre en pares de la misma forma)
    this.nodeSpawnTimer += dt;
    const nodeIntervalMultiplier = isWeek4OrLater ? NODE_SPAWN_INTERVAL_MULTIPLIER_FROM_WEEK4 : 1;
    const spawnThresholdSecs = config.nodeSpawnIntervalDays * nodeIntervalMultiplier * 8; // 8s por día

    if (this.nodeSpawnTimer >= spawnThresholdSecs && this.engine.nodes.length <= config.maxNodes - 2) {
      this.nodeSpawnTimer = 0;
      this.spawnProceduralNodePair();
    }

    // 2. Generación procedural de paquetes de datos
    this.packetSpawnTimer += dt;
    const packetRateBoost = isWeek4OrLater ? PACKET_RATE_BOOST_FROM_WEEK4 : 1;
    const hardModeBoost = isHardMode ? PACKET_RATE_BOOST_FROM_WEEK5 : 1;
    const baseInterval = 2.4 / (config.packetSpawnRate * Math.pow(config.trafficMultiplierPerWeek, this.engine.currentWeek - 1) * packetRateBoost * hardModeBoost);

    // Desde HARD_MODE_FROM_WEEK, el intervalo real de cada ciclo varía al azar (packetSpawnJitter)
    // en vez de ser siempre exactamente igual, para que el tráfico no se sienta artificialmente
    // sincronizado entre nodos.
    const effectiveInterval = isHardMode ? baseInterval * this.packetSpawnJitter : baseInterval;

    if (this.packetSpawnTimer >= effectiveInterval) {
      this.packetSpawnTimer = 0;
      this.packetSpawnJitter = isHardMode
        ? 1 + (Math.random() * 2 - 1) * PACKET_RATE_JITTER_FROM_WEEK5
        : 1;
      this.spawnRandomPacket();
    }
  }

  /**
   * Crea un nuevo nodo en una celda vacía aleatoria de la grilla de cableado.
   * @param {string|null} forcedShape - Si se indica, se usa esa forma en lugar de la elección
   * procedural habitual (usado por recompensas especiales que otorgan nodos fuera de la
   * generación normal).
   * @param {string|null} role - 'sender' o 'receiver' (ver spawnProceduralNodePair).
   */
  spawnProceduralNode(forcedShape = null, role = null) {
    const roadGrid = this.engine.roadGrid;
    const minCellDistance = 2; // deja al menos 1 celda de margen entre nodos para poder tender cable alrededor
    let attempts = 0;
    let col, row, valid = false;

    // Elegir una celda vacía al azar, con separación mínima respecto a otros nodos
    while (!valid && attempts < 80) {
      attempts++;
      col = Math.floor(Math.random() * roadGrid.cols);
      row = Math.floor(Math.random() * roadGrid.rows);

      if (!roadGrid.isOccupiable(col, row)) continue;

      valid = true;
      for (const existingNode of this.engine.nodes) {
        const cellDist = Math.abs(existingNode.col - col) + Math.abs(existingNode.row - row);
        if (cellDist < minCellDistance) {
          valid = false;
          break;
        }
      }
    }

    if (valid) {
      const shape = forcedShape || this.chooseNextShape();
      const node = new Node(`node_${this.nodeCounter++}`, 0, 0, shape, role);
      roadGrid.placeNode(col, row, node);
      this.engine.nodes.push(node);
      this.engine.soundManager.playNodeSpawn();
      return node;
    }
    return null;
  }

  /**
   * Crea un PAR de nodos de la misma forma con roles fijos y complementarios: uno EMISOR
   * (solo origina paquetes, como un cliente que solicita) y otro RECEPTOR (el único que los
   * acepta, como el servidor que responde). Así el tráfico entre ambos fluye en una sola
   * dirección, en vez de que los dos se manden paquetes entre sí indistintamente.
   * Nunca deja una figura "huérfana" sin pareja: si solo se pudo colocar uno de los dos
   * (por falta de espacio en la grilla), se deshace y no se agrega ningún nodo suelto.
   */
  spawnProceduralNodePair() {
    const shape = this.chooseNextShape();

    const first = this.spawnProceduralNode(shape, 'sender');
    if (!first) return null;

    const second = this.spawnProceduralNode(shape, 'receiver');
    if (!second) {
      // No había espacio para completar el par: deshacer el primero
      this.engine.roadGrid.removeNode(first.col, first.row);
      const idx = this.engine.nodes.indexOf(first);
      if (idx !== -1) this.engine.nodes.splice(idx, 1);
      return null;
    }

    return [first, second];
  }

  // Cuántas figuras (de config.allowedShapes, en orden) están desbloqueadas según la semana
  // actual: las primeras 3 (círculo, cuadrado, triángulo) desde el inicio; a partir de la
  // Semana 4 se desbloquea una figura nueva cada 2 semanas (4, 6, 8...) hasta agotar la lista.
  getUnlockedShapeCount() {
    const totalShapes = this.engine.currentLevel.allowedShapes.length;
    const week = this.engine.currentWeek;
    if (week < 4) return Math.min(3, totalShapes);

    const extraUnlocks = Math.floor((week - 4) / 2) + 1;
    return Math.min(3 + extraUnlocks, totalShapes);
  }

  chooseNextShape() {
    const allowed = this.engine.currentLevel.allowedShapes.slice(0, this.getUnlockedShapeCount());
    const existingShapes = this.engine.nodes.map(n => n.shape);

    // Asegurar que cada forma permitida exista al menos una vez
    for (const shape of allowed) {
      if (!existingShapes.includes(shape)) {
        return shape;
      }
    }

    // Proporción balanceada: la mayoría son clientes (Circle), menos servidores/DBs
    const roll = Math.random();
    if (roll < 0.55 && allowed.includes(NODE_SHAPES.CIRCLE)) {
      return NODE_SHAPES.CIRCLE;
    }
    if (roll < 0.80 && allowed.includes(NODE_SHAPES.SQUARE)) {
      return NODE_SHAPES.SQUARE;
    }
    if (roll < 0.93 && allowed.includes(NODE_SHAPES.TRIANGLE)) {
      return NODE_SHAPES.TRIANGLE;
    }
    return allowed[Math.floor(Math.random() * allowed.length)];
  }

  spawnRandomPacket() {
    if (this.engine.nodes.length < 2) return;

    // El tráfico va siempre de un EMISOR a un RECEPTOR de su misma forma (p.ej. un cliente que
    // solicita a "el" servidor de esa figura, nunca al revés ni entre dos emisores/receptores).
    const shapesWithBothRoles = new Set();
    const seenSenders = new Set();
    const seenReceivers = new Set();
    for (const node of this.engine.nodes) {
      if (node.role === 'sender') seenSenders.add(node.shape);
      else if (node.role === 'receiver') seenReceivers.add(node.shape);
    }
    for (const shape of seenSenders) {
      if (seenReceivers.has(shape)) shapesWithBothRoles.add(shape);
    }

    if (shapesWithBothRoles.size === 0) return;

    const pairableShapes = [...shapesWithBothRoles];
    const targetShape = pairableShapes[Math.floor(Math.random() * pairableShapes.length)];
    this.spawnPacketOfShape(targetShape);
  }

  // Genera un paquete desde un EMISOR aleatorio hacia el/los RECEPTOR(es) de la forma indicada
  // (requiere al menos uno de cada rol). Es la unidad básica que reutilizan tanto el tráfico
  // normal como las ráfagas de eventos (Flash Crowd, DDoS dirigido). `isDDoS` marca el paquete
  // como parte de un ataque: se pinta en rojo y sigue las reglas especiales de
  // Packet.update / Engine.onDDoSPacketHit / onDDoSPacketDropped.
  spawnPacketOfShape(shape, isDDoS = false) {
    const senders = this.engine.nodes.filter(n => n.shape === shape && n.role === 'sender');
    if (senders.length === 0) return false;
    const hasReceiver = this.engine.nodes.some(n => n.shape === shape && n.role === 'receiver');
    if (!hasReceiver) return false;

    const originNode = isDDoS ? this.pickDDoSOriginSender(senders) : senders[Math.floor(Math.random() * senders.length)];
    if (!originNode) return false; // el Limitador de Requests frenó este turno del DDoS

    const packet = new Packet(originNode, shape);
    if (isDDoS) {
      packet.isDDoS = true;
      packet.color = DDOS_PACKET_COLOR;
    }
    const added = originNode.addPacket(packet);

    if (added) {
      // Intentar enrutar de inmediato si hay una ruta establecida
      this.engine.attemptRoutePacket(originNode, packet);
    }
    return added;
  }

  // Sortea uniformemente qué emisor le toca originar el próximo paquete DDoS. Si el elegido
  // tiene Limitador de Requests instalado, hay REQUEST_LIMITER_DDOS_SKIP_CHANCE (75%) de
  // probabilidad de que ese turno se descarte por completo (retorna null, no se genera ningún
  // paquete esta ráfaga) en vez de repartir la diferencia entre los demás emisores. Así el nodo
  // limitado termina generando, en promedio, exactamente un 75% menos de paquetes maliciosos
  // que le tocarían por su cuota normal, sin importar cuántos otros emisores haya en la red.
  pickDDoSOriginSender(senders) {
    const candidate = senders[Math.floor(Math.random() * senders.length)];
    if (candidate.hasRequestLimiter && Math.random() < REQUEST_LIMITER_DDOS_SKIP_CHANCE) {
      return null;
    }
    return candidate;
  }

  // Evento de Demanda Pico (Flash Crowd): en cada ráfaga, genera un paquete desde una fracción
  // de los nodos emisores con receptor disponible (`fraction`: 1 = todos), elegidos al azar en
  // cada ráfaga, así la presión de tráfico masivo escala con el tamaño de la red sin depender
  // de un único emisor aleatorio.
  spawnBurstFromAllSenders(fraction = 1) {
    const shapesWithReceiver = new Set();
    for (const node of this.engine.nodes) {
      if (node.role === 'receiver') shapesWithReceiver.add(node.shape);
    }

    const eligibleSenders = this.engine.nodes.filter(
      n => n.role === 'sender' && shapesWithReceiver.has(n.shape)
    );
    const senders = fraction >= 1 ? eligibleSenders : this.pickRandomSubset(eligibleSenders, fraction);

    let spawned = 0;
    for (const node of senders) {
      const packet = new Packet(node, node.shape);
      if (node.addPacket(packet)) {
        this.engine.attemptRoutePacket(node, packet);
        spawned++;
      }
    }
    return spawned;
  }

  // Elige al azar una fracción de los elementos de `list` (redondeando hacia arriba y con al
  // menos 1 si la lista no está vacía), sin repetir ninguno.
  pickRandomSubset(list, fraction) {
    if (list.length === 0) return [];
    const count = Math.max(1, Math.round(list.length * fraction));
    const shuffled = [...list].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  triggerDemandSpike(durationSeconds = 8, intervalMs = 300, senderFraction = 1) {
    const interval = setInterval(() => {
      if (this.engine.state !== 'PLAYING') return;
      this.spawnBurstFromAllSenders(senderFraction);
    }, intervalMs);

    setTimeout(() => {
      clearInterval(interval);
    }, durationSeconds * 1000);
  }

  // Versión liviana de la Demanda Pico (antes de FLASH_CROWD_HEAVY_FROM_WEEK): un único
  // paquete aleatorio por ráfaga, igual que el comportamiento original del evento.
  triggerLightDemandSpike(durationSeconds = 6, intervalMs = 400) {
    const interval = setInterval(() => {
      if (this.engine.state !== 'PLAYING') return;
      this.spawnRandomPacket();
    }, intervalMs);

    setTimeout(() => {
      clearInterval(interval);
    }, durationSeconds * 1000);
  }

  // Ataque DDoS dirigido: durante `durationSeconds`, inunda específicamente la forma del nodo
  // atacado con paquetes extra (a un ritmo mucho mayor que el tráfico normal), marcados como
  // DDoS (rojos). Como el enrutador sigue eligiendo el camino de menor costo hacia esa forma, la
  // avalancha se concentra sobre el mismo cableado una y otra vez: cortar ese tramo (clic
  // derecho) es la respuesta táctica directa para que se queden sin avanzar y se descarten
  // solos, en vez de dejarlos llegar al receptor y bloquearlo.
  triggerTargetedDDoS(targetNode, durationSeconds = 7, intervalMs = 380) {
    const shape = targetNode.shape;

    const interval = setInterval(() => {
      if (this.engine.state !== 'PLAYING') return;
      this.spawnPacketOfShape(shape, true);
    }, intervalMs);

    setTimeout(() => {
      clearInterval(interval);
    }, durationSeconds * 1000);
  }
}
