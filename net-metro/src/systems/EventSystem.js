/**
 * NETMETRO - SISTEMA DE EVENTOS Y CIBERSEGURIDAD
 * Simula ataques DDoS, cortes de fibra y eventos de congestión repentina.
 */

import {
  DDOS_WEIGHT_FROM_WEEK4, DDOS_FIREWALL_BLOCK_CHANCE, FIREWALL_FAIL_POWER_MULTIPLIER,
  DDOS_BASE_POWER_FROM_WEEK7, FIBER_CUT_TILE_COUNT, FIBER_CUT_HEAVY_TILE_COUNT,
  HARD_MODE_FROM_WEEK, FLASH_CROWD_HEAVY_FROM_WEEK,
  FLASH_CROWD_MIN_PER_WEEK, FLASH_CROWD_BURST_INTERVAL_MS, FLASH_CROWD_DURATION_SECONDS,
  FLASH_CROWD_LIGHT_INTERVAL_MS, FLASH_CROWD_LIGHT_DURATION_SECONDS, TIME_CONFIG
} from '../config/constants.js';

export class EventSystem {
  constructor(engine) {
    this.engine = engine;
    this.timer = 0;
    this.flashCrowdTimer = 0;
    // Un DDoS y una Demanda Pico nunca están activos a la vez (combinados podrían generar una
    // pérdida prácticamente automática e injusta): `activeEvent` guarda cuál de los dos está
    // corriendo ('DDOS' | 'FLASH_CROWD' | null) y `activeEventTimer` cuánto le queda.
    this.activeEvent = null;
    this.activeEventTimer = 0;
  }

  reset() {
    this.timer = 0;
    this.flashCrowdTimer = 0;
    this.activeEvent = null;
    this.activeEventTimer = 0;
  }

  update(dt) {
    const config = this.engine.currentLevel;
    if (!config || !config.eventsEnabled) return;

    if (this.activeEventTimer > 0) {
      this.activeEventTimer -= dt;
      if (this.activeEventTimer <= 0) {
        this.activeEventTimer = 0;
        this.activeEvent = null;
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

      // Si hay un DDoS activo, no se resetea el timer: sigue acumulado y la Demanda Pico
      // garantizada se dispara apenas termine, en vez de perderse ese ciclo.
      if (this.flashCrowdTimer >= flashCrowdThreshold && this.activeEvent !== 'DDOS') {
        this.flashCrowdTimer = 0;
        this.triggerFlashCrowd();
      }
    }
  }

  triggerRandomEvent() {
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

    // Un DDoS y una Demanda Pico nunca coexisten (ver triggerDDoS / triggerFlashCrowd): se
    // descarta del sorteo el tipo que entraría en conflicto con el evento activo.
    weightedEvents = weightedEvents.filter(e => {
      if (e.type === 'DDOS' && this.activeEvent === 'FLASH_CROWD') return false;
      if (e.type === 'FLASH_CROWD' && this.activeEvent === 'DDOS') return false;
      return true;
    });
    if (weightedEvents.length === 0) return;

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
    // Nunca coexiste con una Demanda Pico activa (resguardo extra: triggerRandomEvent ya lo
    // excluye del sorteo, pero esto cubre cualquier otra vía de llamada futura).
    if (this.activeEvent === 'FLASH_CROWD') return;

    const week = this.engine.currentWeek;
    // Desde la Semana 7, los ataques DDoS tienen más potencia base (más paquetes por segundo),
    // tenga el jugador Firewall o no.
    let powerMultiplier = week >= 7 ? DDOS_BASE_POWER_FROM_WEEK7 : 1;

    // Firewall Anti-DDoS: ya no bloquea garantizado. Tiene DDOS_FIREWALL_BLOCK_CHANCE (50%) de
    // probabilidad de detener el ataque por completo (en ese caso no llega a pasar nada, así
    // que no hace falta ninguna alerta). Si falla esa probabilidad, el ataque prosigue de
    // todas formas y además duplica su potencia (se combina con el boost de semana 7).
    if (this.engine.hasFirewall) {
      if (Math.random() < DDOS_FIREWALL_BLOCK_CHANCE) {
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

    if (!target) return;

    const duration = 7;
    // Marca el nodo como objetivo del ataque (anillo rojo pulsante en el render): así el
    // jugador sabe exactamente qué tramo de cable cortar para frenar la inundación
    target.attackTimer = duration;
    this.activeEvent = 'DDOS';
    this.activeEventTimer = duration;

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
    const tileCount = this.engine.currentWeek >= HARD_MODE_FROM_WEEK ? FIBER_CUT_HEAVY_TILE_COUNT : FIBER_CUT_TILE_COUNT;
    const blocked = this.engine.roadGrid.blockRandomRoadTiles(tileCount, 9); // Inhabilitados por 9 segundos
    if (blocked.length === 0) return;

    this.engine.soundManager.playWarningAlarm();
  }

  triggerFlashCrowd() {
    // Nunca coexiste con un DDoS activo (resguardo extra: triggerRandomEvent ya lo excluye del
    // sorteo y update() no resetea flashCrowdTimer mientras haya un DDoS en curso).
    if (this.activeEvent === 'DDOS') return;

    const heavy = this.engine.currentWeek >= FLASH_CROWD_HEAVY_FROM_WEEK;
    const duration = heavy ? FLASH_CROWD_DURATION_SECONDS : FLASH_CROWD_LIGHT_DURATION_SECONDS;
    this.activeEvent = 'FLASH_CROWD';
    this.activeEventTimer = duration;

    this.engine.showEventBanner('Demanda Pico', 'info');

    if (heavy) {
      this.engine.trafficGenerator.triggerDemandSpike(FLASH_CROWD_DURATION_SECONDS, FLASH_CROWD_BURST_INTERVAL_MS);
    } else {
      this.engine.trafficGenerator.triggerLightDemandSpike(FLASH_CROWD_LIGHT_DURATION_SECONDS, FLASH_CROWD_LIGHT_INTERVAL_MS);
    }
  }
}
