/**
 * NETMETRO - ENTIDAD NODO (ESTACIÓN DE RED)
 * Representa servidores, clientes, bases de datos y gateways en la topología.
 */

import {
  NODE_SHAPES,
  NODE_LABELS,
  DEFAULT_NODE_BUFFER_CAPACITY,
  SWITCH_BURST_CAPACITY,
  DDOS_RECEIVER_LOCKOUT_SECONDS,
  TIME_CONFIG
} from '../config/constants.js';

export class Node {
  constructor(id, x, y, shape, role = null) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.col = null; // coordenadas de celda en la grilla de cableado (asignadas por RoadGrid.placeNode)
    this.row = null;
    this.radius = 16;
    this.shape = shape || NODE_SHAPES.CIRCLE;
    this.label = NODE_LABELS[this.shape] || 'Nodo';

    // Rol de tráfico dentro de su forma: 'sender' solo ORIGINA paquetes, 'receiver' es el
    // único que los ACEPTA. Así el flujo entre un par de la misma forma es unidireccional
    // (uno solicita/envía, el otro responde) en vez de que ambos se manden tráfico entre sí.
    this.role = role;

    // Capacidad de cola y búfer
    this.hasLoadBalancer = false;
    this.hasSwitch = false; // Switch de Red Gigabit instalado
    // Limitador de Requests: si este nodo (emisor) se ve arrastrado a generar tráfico de un
    // ataque DDoS por ser emisor de la forma atacada, produce muchos menos paquetes rojos (ver
    // TrafficGenerator.pickDDoSOriginSender).
    this.hasRequestLimiter = false;
    this.bufferCapacity = DEFAULT_NODE_BUFFER_CAPACITY;
    this.buffer = []; // Paquetes esperando encolados

    // Temporizador de saturación crítica (Buffer Overflow)
    this.overflowTime = 0; // Segundos acumulados al 100% de capacidad
    this.isCritical = false;

    // Cooldown de recepción: tras aceptar la entrega de un paquete, el nodo queda "enfriándose"
    // este tiempo antes de poder recibir el siguiente (ver Engine.onPacketDelivered)
    this.receiveCooldownTimer = 0;

    // Con Switch instalado, cuenta las entregas seguidas aceptadas sin cooldown dentro de la
    // ráfaga actual (hasta SWITCH_BURST_CAPACITY); se reinicia al completar la ráfaga (ver
    // Engine.onPacketDelivered)
    this.switchBurstCount = 0;

    // Segundos restantes de un ataque DDoS activo dirigido a este nodo (ver EventSystem)
    this.attackTimer = 0;

    // Segundos restantes de bloqueo de recepción causado por un impacto DDoS (ver
    // Engine.onDDoSPacketHit): controla el anillo semitransparente en sentido contrahorario
    // que distingue este bloqueo del enfriamiento normal de recepción.
    this.ddosLockoutTimer = 0;

    // Animación de aparición
    this.spawnProgress = 0; // de 0 a 1
    this.pulseAnim = 0;
  }

  installLoadBalancer() {
    this.hasLoadBalancer = true;
  }

  installSwitch() {
    this.hasSwitch = true;
    this.bufferCapacity += 6; // Mayor capacidad de almacenamiento temporal
  }

  installRequestLimiter() {
    this.hasRequestLimiter = true;
  }

  addPacket(packet) {
    if (this.buffer.length < this.bufferCapacity) {
      this.buffer.push(packet);
      return true;
    }
    return false; // Búfer lleno (paquete descartado)
  }

  removePacket(packetId) {
    const idx = this.buffer.findIndex(p => p.id === packetId);
    if (idx !== -1) {
      return this.buffer.splice(idx, 1)[0];
    }
    return null;
  }

  update(dt) {
    // Animación inicial de spawn
    if (this.spawnProgress < 1) {
      this.spawnProgress = Math.min(1, this.spawnProgress + dt * 3);
    }

    this.pulseAnim += dt * 2;

    if (this.receiveCooldownTimer > 0) {
      this.receiveCooldownTimer = Math.max(0, this.receiveCooldownTimer - dt);
    }
    if (this.attackTimer > 0) {
      this.attackTimer = Math.max(0, this.attackTimer - dt);
    }
    if (this.ddosLockoutTimer > 0) {
      this.ddosLockoutTimer = Math.max(0, this.ddosLockoutTimer - dt);
    }

    // Lógica de alerta por congestión
    const isFull = this.buffer.length >= this.bufferCapacity;
    this.isCritical = isFull;

    if (isFull) {
      this.overflowTime += dt;
      if (this.overflowTime >= TIME_CONFIG.CRITICAL_OVERFLOW_TIME) {
        return { isOverflowed: true, causeNode: this };
      }
    } else {
      // Recuperación gradual del temporizador si se desahoga el tráfico
      this.overflowTime = Math.max(0, this.overflowTime - dt * 1.5);
    }

    return { isOverflowed: false };
  }

  render(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);

    const scale = this.spawnProgress;
    ctx.scale(scale, scale);

    // 0.a Anillo de alerta DDoS: aparece durante todo el ataque, incluso antes de saturar el
    // búfer, para avisar al jugador de qué nodo cortar la alimentación de cable
    if (this.attackTimer > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.012);
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + 12, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(244, 63, 94, ${(0.3 + pulse * 0.35).toFixed(2)})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 0.b Anillo de enfriamiento de recepción: mientras esté activo, el nodo no puede aceptar
    // otro paquete y los que lleguen esperan su turno afuera, en la casilla de entrada. Si el
    // bloqueo es por un impacto DDoS, se reemplaza por el sector contrahorario de abajo.
    if (this.receiveCooldownTimer > 0 && this.ddosLockoutTimer <= 0) {
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + 6, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 0.c Sector semitransparente en sentido CONTRAHORARIO: el nodo fue impactado por un
    // paquete DDoS y no puede recibir NADA hasta que se agote. Se va achicando desde un
    // círculo completo hasta desaparecer, y gira en sentido opuesto al sector de saturación
    // (que es horario) para distinguir claramente un bloqueo del otro.
    if (this.ddosLockoutTimer > 0) {
      const lockRatio = Math.min(1, this.ddosLockoutTimer / DDOS_RECEIVER_LOCKOUT_SECONDS);
      const outerR = this.radius + 10;
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle - lockRatio * (Math.PI * 2);

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, outerR, startAngle, endAngle, true);
      ctx.closePath();
      ctx.fillStyle = 'rgba(244, 63, 94, 0.32)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(0, 0, outerR, startAngle, endAngle, true);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#f43f5e';
      ctx.shadowColor = 'rgba(244, 63, 94, 0.85)';
      ctx.shadowBlur = 9;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // 1. Círculo rojo semitransparente en sentido horario (Saturación / Buffer Overflow)
    if (this.overflowTime > 0) {
      const dangerRatio = Math.min(1, this.overflowTime / TIME_CONFIG.CRITICAL_OVERFLOW_TIME);
      const outerR = this.radius + 18;
      const startAngle = -Math.PI / 2; // Arriba (12 en punto)
      const endAngle = startAngle + dangerRatio * (Math.PI * 2);

      // Guía circular tenue de fondo (para ver el 100%)
      ctx.beginPath();
      ctx.arc(0, 0, outerR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Sector circular rojo semitransparente en sentido del reloj
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, outerR, startAngle, endAngle, false);
      ctx.closePath();
      ctx.fillStyle = 'rgba(244, 63, 94, 0.45)'; // Rojo semitransparente solicitado
      ctx.fill();

      // Borde del sector que avanza
      ctx.beginPath();
      ctx.arc(0, 0, outerR, startAngle, endAngle, false);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#f43f5e';
      ctx.shadowColor = 'rgba(244, 63, 94, 0.9)';
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // 1.5. Chasis de Switch de Red Gigabit (si está instalado)
    if (this.hasSwitch) {
      ctx.save();
      const swW = (this.radius + 7) * 2;
      const swH = (this.radius + 5) * 2;
      ctx.fillStyle = '#090d16';
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 1.8;
      ctx.fillRect(-swW / 2, -swH / 2, swW, swH);
      ctx.strokeRect(-swW / 2, -swH / 2, swW, swH);

      // LEDs de puertos: uno por cada entrega ya aceptada en la ráfaga actual (encendido en
      // verde), así se ve de un vistazo cuántos "puertos" quedan libres antes del cooldown
      for (let i = 0; i < SWITCH_BURST_CAPACITY; i++) {
        ctx.fillStyle = i < this.switchBurstCount ? '#10b981' : '#0d3b30';
        ctx.fillRect(-this.radius + 1 + i * 6.5, this.radius + 1, 3.5, 3.5);
      }
      ctx.restore();
    }

    // 2. Fondo del nodo
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 3;

    if (this.isCritical) {
      ctx.strokeStyle = '#f43f5e';
    } else if (this.hasSwitch) {
      ctx.strokeStyle = '#06b6d4'; // Cyan brillante para Switch
    } else if (this.hasLoadBalancer) {
      ctx.strokeStyle = '#f59e0b'; // Dorado para nodo con balanceador
    } else if (this.hasRequestLimiter) {
      ctx.strokeStyle = '#22c55e'; // Verde para Limitador de Requests
    }

    // 3. Dibujo de la forma geométrica característica
    this.drawShape(ctx, this.shape, this.radius);

    // 4. Indicadores de mejoras instaladas (Balanceador, Switch o Limitador de Requests)
    if (this.hasSwitch) {
      ctx.fillStyle = '#06b6d4';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔀', 0, -this.radius - 9);
    } else if (this.hasLoadBalancer) {
      ctx.fillStyle = '#f59e0b';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚖️', 0, -this.radius - 8);
    } else if (this.hasRequestLimiter) {
      ctx.fillStyle = '#22c55e';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🚦', 0, -this.radius - 9);
    }

    // 5. Dibujar los paquetes en espera (estilo Mini Metro)
    this.renderWaitingPackets(ctx);

    // 6. Rol de tráfico (emisor/receptor): ayuda a leer de un vistazo hacia dónde fluyen
    // los paquetes entre un par de nodos de la misma forma
    if (this.role === 'sender' || this.role === 'receiver') {
      ctx.font = '700 8px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.role === 'sender' ? 'rgba(56, 189, 248, 0.9)' : 'rgba(52, 211, 153, 0.9)';
      ctx.fillText(this.role === 'sender' ? '▲ TX' : '▼ RX', 0, this.radius + 15);
    }

    ctx.restore();
  }

  drawShape(ctx, shape, r) {
    ctx.beginPath();
    switch (shape) {
      case NODE_SHAPES.CIRCLE:
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        break;

      case NODE_SHAPES.SQUARE:
        ctx.rect(-r, -r, r * 2, r * 2);
        break;

      case NODE_SHAPES.TRIANGLE:
        ctx.moveTo(0, -r * 1.2);
        ctx.lineTo(r * 1.1, r * 0.8);
        ctx.lineTo(-r * 1.1, r * 0.8);
        ctx.closePath();
        break;

      case NODE_SHAPES.HEXAGON:
        for (let i = 0; i < 6; i++) {
          const angle = (i * Math.PI) / 3;
          const px = r * 1.15 * Math.cos(angle);
          const py = r * 1.15 * Math.sin(angle);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        break;

      case NODE_SHAPES.STAR:
        for (let i = 0; i < 10; i++) {
          const rad = (i * Math.PI) / 5;
          const len = i % 2 === 0 ? r * 1.3 : r * 0.6;
          const px = len * Math.sin(rad);
          const py = -len * Math.cos(rad);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        break;
    }
    ctx.fill();
    ctx.stroke();
  }

  renderWaitingPackets(ctx) {
    const spacing = 11;
    const startX = this.radius + 6;
    const startY = -this.radius + 2;

    this.buffer.forEach((packet, idx) => {
      const col = idx % 4;
      const row = Math.floor(idx / 4);
      const px = startX + col * spacing;
      const py = startY + row * spacing;

      ctx.save();
      ctx.translate(px, py);
      ctx.fillStyle = packet.color || '#94a3b8';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1;

      // Miniatura de la forma del paquete
      this.drawMiniShape(ctx, packet.targetShape, 4.5);
      ctx.restore();
    });
  }

  drawMiniShape(ctx, shape, r) {
    ctx.beginPath();
    switch (shape) {
      case NODE_SHAPES.CIRCLE:
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        break;
      case NODE_SHAPES.SQUARE:
        ctx.rect(-r, -r, r * 2, r * 2);
        break;
      case NODE_SHAPES.TRIANGLE:
        ctx.moveTo(0, -r);
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
  }
}
