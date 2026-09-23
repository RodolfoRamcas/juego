/**
 * NETMETRO - SISTEMA DE EVENTOS Y CIBERSEGURIDAD
 * Simula ataques DDoS, cortes de fibra y eventos de congestión repentina.
 */

import {
  DDOS_WEIGHT_FROM_WEEK4, DDOS_FIREWALL_BLOCK_CHANCE, FIREWALL_FAIL_POWER_MULTIPLIER,
  DDOS_BASE_POWER_FROM_WEEK7, FIBER_CUT_TILE_COUNT, FIBER_CUT_HEAVY_TILE_COUNT,
  FIBER_CUT_DURATION_SECONDS, FIBER_CUT_HEAVY_DURATION_SECONDS, HARD_MODE_FROM_WEEK, FLASH_CROWD_HEAVY_FROM_WEEK,
  FLASH_CROWD_MIN_PER_WEEK, FLASH_CROWD_BURST_INTERVAL_MS, FLASH_CROWD_DURATION_SECONDS,
  FLASH_CROWD_HEAVY_SENDER_FRACTION,
  FLASH_CROWD_LIGHT_INTERVAL_MS, FLASH_CROWD_LIGHT_DURATION_SECONDS, TIME_CONFIG,
  EVENT_TYPE_NONE, EVENT_TYPE_DDOS, EVENT_TYPE_FIBER_CUT, EVENT_TYPE_FLASH_CROWD
} from '../config/constants.js';

export class EventSystem {
  constructor(engine) {
    this.engine = engine;
    this.timer = 0;
    this.flashCrowdTimer = 0;
    // Contador global de "qué evento está corriendo ahora" (ver EVENT_TYPE_* en constants.js):
    // EVENT_TYPE_NONE (0) cuando no hay ninguno, o el valor propio del evento activo. Solo
    // puede haber UN evento a la vez; `activeEventTimer` guarda cuánto le queda.
    this.activeEventType = EVENT_TYPE_NONE;
    this.activeEventTimer = 0;
  }

  reset() {
    this.timer = 0;
    this.flashCrowdTimer = 0;
    this.activeEventType = EVENT_TYPE_NONE;
    this.activeEventTimer = 0;
  }

  update(dt) {
    const config = this.engine.currentLevel;
    if (!config || !config.eventsEnabled) return;

    if (this.activeEventTimer > 0) {
      this.activeEventTimer -= dt;
      if (this.activeEventTimer <= 0) {
        this.activeEventTimer = 0;
        this.activeEventType = EVENT_TYPE_NONE;
      }
    }

    this.timer += dt;
    const threshold = config.eventFrequencyDays * TIME_CONFIG.SECONDS_PER_DAY;

    if (this.timer >= threshold) {
      this.timer = 0;
      this.triggerRandomEvent();
    }

    // Demanda Pico garantizada: solo desde FLASH_CROWD_HEAVY_FROM_WEEK se fuerza que ocurra al
    // menos FLASH_CROWD_MIN_PER_WEEK veces por semana virtual (repartida en intervalos parejos),
    // además de poder salir del sorteo de arriba en cualquier semana. Antes de esa semana la red
    // recién está creciendo, así que no se fuerza nada extra.
    if (this.engine.currentWeek >= FLASH_CROWD_HEAVY_FROM_WEEK) {
      this.flashCrowdTimer += dt;
      const weekSeconds = TIME_CONFIG.DAYS_PER_WEEK * TIME_CONFIG.SECONDS_PER_DAY;
      const flashCrowdThreshold = weekSeconds / FLASH_CROWD_MIN_PER_WEEK;

      // Si ya hay OTRO evento activo (el que sea), no se resetea el timer: sigue acumulado y
      // la Demanda Pico garantizada se dispara apenas termine, en vez de perderse ese ciclo.
      if (this.flashCrowdTimer >= flashCrowdThreshold && this.activeEventType === EVENT_TYPE_NONE) {
        this.flashCrowdTimer = 0;
        this.triggerFlashCrowd();
      }
    }
  }

  triggerRandomEvent() {
    // Solo puede haber un evento a la vez: si ya hay uno corriendo, este ciclo del sorteo se
    // descarta por completo (antes se filtraba tipo por tipo; ahora, con el contador
    // compartido, ningún evento nuevo puede empezar mientras otro siga activo).
    if (this.activeEventType !== EVENT_TYPE_NONE) return;

    const week = this.engine.currentWeek;

    // La Semana 1 es un período de gracia: nunca hay ataques DDoS mientras el jugador todavía
    // está aprendiendo la red con solo 3 figuras iniciales. Desde la Semana 4, el DDoS pesa
    // mucho más que los demás eventos (mucho más frecuente); entre semana, peso parejo.
    let weightedEvents;
    if (week <= 1) {
      weightedEvents = [
        { type: 'FIBER_CUT', weight: 1 },
        { type: 'FLASH_CROWD', weight: 1 }
      ];
    } else {
      const ddosWeight = week >= 4 ? DDOS_WEIGHT_FROM_WEEK4 : 1;
      weightedEvents = [
        { type: 'DDOS', weight: ddosWeight },
        { type: 'FIBER_CUT', weight: 1 },
        { type: 'FLASH_CROWD', weight: 1 }
      ];
    }

    const chosen = this.pickWeighted(weightedEvents);

    switch (chosen) {
      case 'DDOS':
        this.triggerDDoS();
        break;
      case 'FIBER_CUT':
        this.triggerFiberCut();
        break;
      case 'FLASH_CROWD':
        this.triggerFlashCrowd();
        break;
    }
  }

  // Elige un elemento al azar de `[{ type, weight }]` proporcional a su peso relativo
  pickWeighted(items) {
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const item of items) {
      if (roll < item.weight) return item.type;
      roll -= item.weight;
    }
    return items[items.length - 1].type;
  }

  triggerDDoS() {
    // Solo puede iniciar si no hay otro evento activo (triggerRandomEvent ya lo filtra, pero
    // esto cubre cualquier otra vía de llamada futura).
    if (this.activeEventType !== EVENT_TYPE_NONE) return;

    // Declarar el evento ANTES de resolver Firewall/Balanceador: así ambos pueden verificar de
    // forma EXPLÍCITA, contra este contador compartido, que hay un ataque DDoS real en curso
    // antes de gastar uno de sus usos limitados.
    this.activeEventType = EVENT_TYPE_DDOS;

    const week = this.engine.currentWeek;
    // Desde la Semana 7, los ataques DDoS tienen más potencia base (más paquetes por segundo),
    // tenga el jugador Firewall o no.
    let powerMultiplier = week >= 7 ? DDOS_BASE_POWER_FROM_WEEK7 : 1;

    // Firewall Anti-DDoS: gasta 1 de sus usos limitados (FIREWALL_MAX_CHARGES) SOLO si el
    // contador de eventos confirma que esto es un ataque DDoS real. Se gasta bloquee o no; al
    // agotar sus usos se pierde (vuelve a poder salir en las recompensas). Tiene
    // DDOS_FIREWALL_BLOCK_CHANCE (60%) de probabilidad de bloquear por completo (nada pasa, sin
    // alerta); si falla, el ataque prosigue de todas formas y además duplica su potencia.
    if (this.engine.firewallCharges > 0 && this.activeEventType === EVENT_TYPE_DDOS) {
      this.engine.firewallCharges--;
      this.engine.updateFirewallBadge();
      if (Math.random() < DDOS_FIREWALL_BLOCK_CHANCE) {
        this.activeEventType = EVENT_TYPE_NONE; // el ataque nunca llegó a manifestarse
        return;
      }
      powerMultiplier *= FIREWALL_FAIL_POWER_MULTIPLIER;
    }

    // Buscar servidores (cuadrados o triángulos) que sean RECEPTORES: son los que realmente
    // aceptan y responden solicitudes, así el ataque tiene sentido con el flujo unidireccional
    const servers = this.engine.nodes.filter(n => (n.shape === 'square' || n.shape === 'triangle') && n.role === 'receiver');
    const anyReceiver = this.engine.nodes.filter(n => n.role === 'receiver');
    const target = servers.length > 0
      ? servers[Math.floor(Math.random() * servers.length)]
      : (anyReceiver.length > 0 ? anyReceiver[Math.floor(Math.random() * anyReceiver.length)] : this.engine.nodes[0]);

    if (!target) {
      this.activeEventType = EVENT_TYPE_NONE; // no había a quién atacar: el evento no llega a ocurrir
      return;
    }

    const duration = 7;
    // Marca el nodo como objetivo del ataque (anillo rojo pulsante en el render): así el
    // jugador sabe exactamente qué tramo de cable cortar para frenar la inundación
    target.attackTimer = duration;
    this.activeEventTimer = duration;

    // Balanceador de Carga: gasta 1 de sus usos limitados (LOAD_BALANCER_MAX_CHARGES) SOLO si
    // el contador de eventos confirma un ataque DDoS real y el Firewall no lo bloqueó (si no
    // hubo ataque, no hay nada que defender). Mientras esté activo PARA ESTE ataque, cualquier
    // nodo golpeado por un paquete DDoS recibe la mitad del bloqueo de recepción (ver
    // Engine.onDDoSPacketHit). Al agotar sus usos se pierde (vuelve a poder salir en las
    // recompensas).
    this.engine.loadBalancerActiveForAttack = false;
    if (this.engine.loadBalancerCharges > 0 && this.activeEventType === EVENT_TYPE_DDOS) {
      this.engine.loadBalancerCharges--;
      this.engine.loadBalancerActiveForAttack = true;
      this.engine.updateBalancerBadge();
    }

    this.engine.showEventBanner('Ataque DDoS', 'danger');
    this.engine.soundManager.playWarningAlarm();

    // Inundar específicamente la forma del nodo atacado (no tráfico genérico): la avalancha
    // se concentra sobre el mismo cableado, así que cortarlo es la respuesta táctica directa.
    // La potencia multiplica la frecuencia de la ráfaga (intervalo más corto = más paquetes).
    const baseIntervalMs = 380;
    const effectiveIntervalMs = Math.max(80, Math.round(baseIntervalMs / powerMultiplier));
    this.engine.trafficGenerator.triggerTargetedDDoS(target, duration, effectiveIntervalMs);
  }

  // Sin alerta: los tramos bloqueados ya se ven en el mapa (rayado rojo) y suena la alarma;
  // no hace falta un mensaje aparte para "quitar cables".
  triggerFiberCut() {
    if (this.activeEventType !== EVENT_TYPE_NONE) return;

    const isHardMode = this.engine.currentWeek >= HARD_MODE_FROM_WEEK;
    const tileCount = isHardMode ? FIBER_CUT_HEAVY_TILE_COUNT : FIBER_CUT_TILE_COUNT;
    const duration = isHardMode ? FIBER_CUT_HEAVY_DURATION_SECONDS : FIBER_CUT_DURATION_SECONDS;
    const blocked = this.engine.roadGrid.blockRandomRoadTiles(tileCount, duration);
    if (blocked.length === 0) return;

    this.activeEventType = EVENT_TYPE_FIBER_CUT;
    this.activeEventTimer = duration;

    this.engine.soundManager.playWarningAlarm();
  }

  triggerFlashCrowd() {
    if (this.activeEventType !== EVENT_TYPE_NONE) return;

    const heavy = this.engine.currentWeek >= FLASH_CROWD_HEAVY_FROM_WEEK;
    const duration = heavy ? FLASH_CROWD_DURATION_SECONDS : FLASH_CROWD_LIGHT_DURATION_SECONDS;
    this.activeEventType = EVENT_TYPE_FLASH_CROWD;
    this.activeEventTimer = duration;

    this.engine.showEventBanner('Demanda Pico', 'info');

    if (heavy) {
      this.engine.trafficGenerator.triggerDemandSpike(FLASH_CROWD_DURATION_SECONDS, FLASH_CROWD_BURST_INTERVAL_MS, FLASH_CROWD_HEAVY_SENDER_FRACTION);
    } else {
      this.engine.trafficGenerator.triggerLightDemandSpike(FLASH_CROWD_LIGHT_DURATION_SECONDS, FLASH_CROWD_LIGHT_INTERVAL_MS);
    }
  }
}
