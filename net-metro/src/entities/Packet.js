/**
 * NETMETRO - ENTIDAD PAQUETE DE DATOS
 * Viaja tramo a tramo por la red de cableado hacia un nodo que coincida con su
 * targetShape. Si permanece demasiado tiempo sin llegar (en búfer o en tránsito),
 * se pierde: esa es la principal fuente de presión de tiempo del juego.
 */

import {
  NODE_SHAPES, PACKET_PIXELS_PER_SECOND, PROTOCOL_ACCELERATOR_MULTIPLIER, TILE_VACATE_COOLDOWN,
  DDOS_PACKET_STATIONARY_DROP_TIME, PACKET_STUCK_REROUTE_SECONDS
} from '../config/constants.js';

let packetCounter = 1;

// Distancia mínima considerada entre puntos para evitar velocidades absurdas en tramos casi nulos
const MIN_SEGMENT_DISTANCE = 20;

// Cuando un paquete llega al final de un tramo pero el nodo de destino no puede aceptarlo
// todavía (cooldown / bloqueo DDoS activo), se queda "tocando la puerta" con progress = 1. Sin
// este margen, esa posición coincide exactamente con el centro del nodo y el paquete se ve
// como si hubiera entrado adentro pese a estar bloqueado. Este margen (en píxeles) lo frena
// visualmente justo antes de llegar, sin alterar la lógica real de entrega.
const NODE_QUEUE_VISUAL_MARGIN_PX = 24;

export class Packet {
  constructor(originNode, targetShape) {
    this.id = `pkt_${packetCounter++}`;
    this.originNode = originNode;
    this.lastNodeVisited = originNode; // dónde reencolar si la ruta se rompe a mitad de camino
    this.targetShape = targetShape;
    this.color = '#38bdf8'; // Azul claro por defecto

    // Estado de tránsito
    this.inTransit = false;
    this.fromPoint = null;
    this.toPoint = null;
    this.progress = 0; // de 0 a 1 en el tramo actual
    this.pixelSpeed = PACKET_PIXELS_PER_SECOND; // velocidad base en píxeles/segundo
    this.segmentDistance = MIN_SEGMENT_DISTANCE;

    // Ruta planificada por el Router (array de puntos de tile: {col,row,x,y,node})
    this.route = [];
    this.routeIndex = 0;

    // Presión de tiempo: cuánto lleva vivo el paquete (en búfer o en tránsito)
    this.totalLifetime = 0;

    // Una vez que el paquete cruza CUALQUIER tramo acelerado, conserva la velocidad extra
    // por el resto de su viaje (si no, el efecto de un solo tile de 44px es casi imperceptible)
    this.isBoosted = false;

    this.isDelivered = false;
    this.isDropped = false;

    // Congestión física: una sola casilla de cable por paquete a la vez. `hasClaimedTile`
    // indica si este paquete ya reservó actualmente `toPoint` en la RoadGrid.
    this.hasClaimedTile = false;

    // Paquete de un ataque DDoS (ver TrafficGenerator.triggerTargetedDDoS): se identifica en
    // rojo, y si pasa más de DDOS_PACKET_STATIONARY_DROP_TIME sin avanzar de posición (cable
    // cortado, congestión, o esperando en la puerta de un nodo bloqueado), se descarta sin
    // contar como paquete perdido. Para un paquete normal, este mismo `stationaryTimer` se usa
    // para detectar una línea saturada (ver update()): si lleva PACKET_STUCK_REROUTE_SECONDS
    // sin moverse de un tramo de cable (no en la puerta de un nodo, eso es otro problema), se
    // reencola para que el Router le busque otro camino.
    this.isDDoS = false;
    this.stationaryTimer = 0;
  }

  computeSegmentDistance() {
    if (!this.fromPoint || !this.toPoint) return MIN_SEGMENT_DISTANCE;
    return Math.max(MIN_SEGMENT_DISTANCE, Math.hypot(this.toPoint.x - this.fromPoint.x, this.toPoint.y - this.fromPoint.y));
  }

  // Posición actual en píxeles (mundo), en tránsito o esperando en un nodo. Se usa para saber
  // dónde mostrar la marca visual de "paquete perdido" cuando expira por tiempo límite.
  getCurrentPosition() {
    if (this.inTransit && this.fromPoint && this.toPoint) {
      return {
        x: this.fromPoint.x + (this.toPoint.x - this.fromPoint.x) * this.progress,
        y: this.fromPoint.y + (this.toPoint.y - this.fromPoint.y) * this.progress
      };
    }
    if (this.lastNodeVisited) return { x: this.lastNodeVisited.x, y: this.lastNodeVisited.y };
    if (this.originNode) return { x: this.originNode.x, y: this.originNode.y };
    return null;
  }

  startTransit(route) {
    if (!route || route.length < 2) return false;
    this.route = route;
    this.routeIndex = 0;
    this.fromPoint = route[0];
    this.toPoint = route[1];
    this.progress = 0;
    this.segmentDistance = this.computeSegmentDistance();
    this.inTransit = true;
    this.hasClaimedTile = false; // la casilla de destino se reserva en el próximo update()
    return true;
  }

  // Libera cualquier casilla que este paquete tuviera reservada (usado al reencolar o al
  // abandonar el tránsito por cualquier motivo)
  releaseClaim(roadGrid) {
    if (this.hasClaimedTile && this.toPoint) {
      roadGrid.releaseTile(this.toPoint.col, this.toPoint.row, this.id, 0);
    }
    this.hasClaimedTile = false;
  }

  // Punto de entrada por frame: delega el avance real en _advance() y, para paquetes DDoS,
  // controla el tiempo que llevan sin cambiar de posición (ver constructor). Superado
  // DDOS_PACKET_STATIONARY_DROP_TIME, el paquete se descarta sin contar como pérdida normal.
  update(dt, engine) {
    if (!this.inTransit) return null;

    const progressBefore = this.progress;
    const routeIndexBefore = this.routeIndex;

    const result = this._advance(dt, engine);
    if (result) return result;

    if (this.isDDoS && this.inTransit) {
      const moved = this.progress !== progressBefore || this.routeIndex !== routeIndexBefore;
      this.stationaryTimer = moved ? 0 : this.stationaryTimer + dt;
      if (this.stationaryTimer >= DDOS_PACKET_STATIONARY_DROP_TIME) {
        // Posición para la marca visual: se calcula ANTES de apagar inTransit, porque
        // getCurrentPosition() solo interpola fromPoint/toPoint mientras sigue en tránsito.
        const position = this.getCurrentPosition();
        this.releaseClaim(engine.roadGrid);
        this.inTransit = false;
        return { status: 'ddos_dropped', packet: this, position };
      }
    } else if (this.inTransit && !(this.toPoint && this.toPoint.node)) {
      // Paquete normal atascado en un tramo de cable (no en la puerta de un nodo: esperar el
      // cooldown de recepción es un problema de disponibilidad del destino, no de saturación
      // de la línea, y reencolarlo ahí no cambiaría nada). Si hay otro camino disponible, el
      // Router lo tomará solo al reintentar vía attemptRoutePacket (pondera por congestión, así
      // que evita naturalmente el mismo tramo saturado); si no lo hay, simplemente queda
      // esperando en el búfer del nodo como cualquier paquete sin ruta.
      const moved = this.progress !== progressBefore || this.routeIndex !== routeIndexBefore;
      this.stationaryTimer = moved ? 0 : this.stationaryTimer + dt;
      if (this.stationaryTimer >= PACKET_STUCK_REROUTE_SECONDS) {
        this.stationaryTimer = 0;
        this.releaseClaim(engine.roadGrid);
        this.inTransit = false;
        const bufferNode = this.lastNodeVisited || this.originNode;
        bufferNode.addPacket(this);
        return { status: 'reroute', packet: this, node: bufferNode };
      }
    }

    return null;
  }

  _advance(dt, engine) {
    if (!this.inTransit) return null;

    const roadGrid = engine.roadGrid;

    // Verificación en vivo del tile de destino del tramo actual: si fue borrado a mitad de
    // camino, el paquete se reencola; si solo está bloqueado por mantenimiento, espera.
    const liveCell = roadGrid.getCell(this.toPoint.col, this.toPoint.row);
    if (!liveCell) {
      this.releaseClaim(roadGrid);
      this.inTransit = false;
      const bufferNode = this.lastNodeVisited || this.originNode;
      bufferNode.addPacket(this);
      return { status: 'reroute', packet: this, node: bufferNode };
    }
    if (liveCell.isBlocked) {
      return null; // en pausa por mantenimiento hasta que el tile se reabra
    }

    if (this.progress < 1) {
      // Congestión física: cada casilla de cable admite como máximo 2 paquetes a la vez (así
      // dos que se cruzan en sentidos opuestos no generan un punto muerto). Si la casilla de
      // destino de este tramo ya está llena (o recién quedó vacía y aún "enfría"), el paquete
      // se detiene en el borde de su casilla actual y forma cola.
      if (!this.hasClaimedTile) {
        if (!roadGrid.claimTile(this.toPoint.col, this.toPoint.row, this.id)) {
          return null; // sigue esperando su turno
        }
        this.hasClaimedTile = true;
      }

      // Cuanto más alejado esté el siguiente tile, más tiempo tarda en cruzarlo. Si el tramo
      // está potenciado por el Acelerador de Protocolo, el paquete queda acelerado de forma
      // permanente por el resto de su viaje (no solo mientras cruza ese tile puntual).
      if (liveCell.isBoosted) this.isBoosted = true;
      const effectiveSpeed = this.pixelSpeed * (this.isBoosted ? PROTOCOL_ACCELERATOR_MULTIPLIER : 1.0);
      this.progress += (dt * effectiveSpeed) / this.segmentDistance;
    }

    if (this.progress < 1) return null; // aún cruzando el tramo actual

    // Llegamos físicamente al final del tramo actual (this.toPoint)
    const arrivedNode = this.toPoint.node;

    // ¿Es este nodo el RECEPTOR que satisface la forma solicitada? El flujo es unidireccional
    // (emisor -> receptor): un nodo emisor de la misma forma nunca acepta la entrega, aunque
    // esté de paso en la ruta.
    if (arrivedNode && arrivedNode.shape === this.targetShape && arrivedNode.role === 'receiver') {
      if (this.isDDoS) {
        // Un paquete DDoS siempre "impacta" al nodo, aunque esté en cooldown: no se queda
        // esperando en la puerta como el tráfico legítimo (si el jugador no lo detuvo antes,
        // cada impacto reinicia el bloqueo de recepción; ver Engine.onDDoSPacketHit).
        roadGrid.releaseTile(this.toPoint.col, this.toPoint.row, this.id, 0);
        this.hasClaimedTile = false;
        this.isDelivered = true;
        this.inTransit = false;
        return { status: 'ddos_hit', packet: this, node: arrivedNode };
      }

      // Cooldown de recepción: el nodo acaba de aceptar otro paquete hace poco y todavía no
      // puede recibir uno nuevo. Este paquete se queda "tocando la puerta", reteniendo la
      // casilla de entrada, hasta que el nodo vuelva a estar disponible.
      if (arrivedNode.receiveCooldownTimer > 0) {
        this.progress = 1;
        return null;
      }

      roadGrid.releaseTile(this.toPoint.col, this.toPoint.row, this.id, 0);
      this.hasClaimedTile = false;
      this.isDelivered = true;
      this.inTransit = false;
      return { status: 'delivered', packet: this, node: arrivedNode };
    }

    // No es el nodo de entrega: intentar avanzar al siguiente tramo de la ruta
    if (this.routeIndex < this.route.length - 1) {
      const nextPoint = this.route[this.routeIndex + 1];

      if (!roadGrid.claimTile(nextPoint.col, nextPoint.row, this.id)) {
        // El siguiente tramo sigue ocupado: este paquete se queda parado donde está (sigue
        // reteniendo su casilla actual) y vuelve a intentarlo el próximo frame.
        this.progress = 1;
        return null;
      }

      // Libera la casilla que acaba de cruzar, con un pequeño enfriamiento para que el
      // siguiente paquete en cola no entre pegado inmediatamente detrás.
      roadGrid.releaseTile(this.toPoint.col, this.toPoint.row, this.id, TILE_VACATE_COOLDOWN);

      this.fromPoint = this.toPoint;
      if (this.fromPoint.node) this.lastNodeVisited = this.fromPoint.node;
      this.routeIndex++;
      this.toPoint = nextPoint;
      this.progress = 0;
      this.segmentDistance = this.computeSegmentDistance();
      this.hasClaimedTile = true; // ya reservamos nextPoint arriba
    } else {
      // Fin de ruta sin haber completado la forma: se deposita en el último nodo para re-enrutar
      roadGrid.releaseTile(this.toPoint.col, this.toPoint.row, this.id, 0);
      this.hasClaimedTile = false;
      this.inTransit = false;
      const bufferNode = this.lastNodeVisited || this.originNode;
      bufferNode.addPacket(this);
      return { status: 'reroute', packet: this, node: bufferNode };
    }

    return null;
  }

  render(ctx) {
    if (!this.inTransit || !this.fromPoint || !this.toPoint) return;

    // Progreso visual: si ya llegó al final del tramo (progress >= 1) pero el destino es un
    // nodo, significa que sigue "tocando la puerta" esperando a que lo acepte (si ya hubiera
    // sido aceptado, this.inTransit sería false y no se llegaría a renderizar). Se frena un
    // margen antes del centro del nodo para no verse como si hubiera entrado bloqueado.
    let displayProgress = this.progress;
    if (displayProgress >= 1 && this.toPoint.node) {
      const marginFraction = Math.min(0.9, NODE_QUEUE_VISUAL_MARGIN_PX / this.segmentDistance);
      displayProgress = 1 - marginFraction;
    }

    // Interpolar coordenadas exactas en el tramo actual
    const px = this.fromPoint.x + (this.toPoint.x - this.fromPoint.x) * displayProgress;
    const py = this.fromPoint.y + (this.toPoint.y - this.fromPoint.y) * displayProgress;

    ctx.save();
    ctx.translate(px, py);

    ctx.fillStyle = this.color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 8;

    // Dibujar mini-forma viajera
    const r = 5;
    ctx.beginPath();
    switch (this.targetShape) {
      case NODE_SHAPES.CIRCLE:
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        break;
      case NODE_SHAPES.SQUARE:
        ctx.rect(-r, -r, r * 2, r * 2);
        break;
      case NODE_SHAPES.TRIANGLE:
        ctx.moveTo(0, -r * 1.2);
        ctx.lineTo(r, r);
        ctx.lineTo(-r, r);
        ctx.closePath();
        break;
      default:
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        break;
    }
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }
}
