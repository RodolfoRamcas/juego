/**
 * NETMETRO - SISTEMA DE MEJORAS SEMANALES (UPGRADE SYSTEM)
 * Otorga al jugador mejoras estratégicas cada Domingo a medianoche.
 */

import {
  UPGRADE_TYPES, CABLE_REINFORCEMENT_GRANT_AMOUNT, FIREWALL_MAX_CHARGES, LOAD_BALANCER_MAX_CHARGES,
  NODE_HAMMER_MIN_WEEK
} from '../config/constants.js';

export class UpgradeSystem {
  constructor(engine) {
    this.engine = engine;
  }

  reset() {
    // El estado de inventario ahora se gestiona directamente en Engine
  }

  showWeeklyRewardModal() {
    this.engine.setSpeed(0); // Pausar simulación
    this.engine.soundManager.playWeekComplete();

    // Recompensa automática de cada domingo: piezas de cable adicionales
    this.grantAutomaticRoadPieces();

    const container = document.getElementById('upgrade-options-container');
    container.innerHTML = '';

    // Seleccionar 2 mejoras distintas aleatorias (aparte de las piezas, que ya se otorgaron).
    // El Firewall y el Balanceador de Carga tienen usos limitados: mientras les queden cargas
    // (> 0), no se vuelven a ofrecer.
    const pool = [
      ...(this.engine.loadBalancerCharges > 0 ? [] : [UPGRADE_TYPES.LOAD_BALANCER]),
      UPGRADE_TYPES.PROTOCOL_ACCELERATOR,
      ...(this.engine.firewallCharges > 0 ? [] : [UPGRADE_TYPES.FIREWALL]),
      UPGRADE_TYPES.NETWORK_SWITCH,
      UPGRADE_TYPES.CABLE_REINFORCEMENT,
      UPGRADE_TYPES.REQUEST_LIMITER,
      ...(this.engine.currentWeek >= NODE_HAMMER_MIN_WEEK ? [UPGRADE_TYPES.NODE_HAMMER] : [])
    ];

    // Barajar pool
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const options = shuffled.slice(0, 2);

    options.forEach(upgrade => {
      const card = document.createElement('div');
      card.className = 'upgrade-card-item';
      card.innerHTML = `
        <div class="upgrade-icon">${upgrade.icon}</div>
        <div class="upgrade-name">${upgrade.name}</div>
        <div class="upgrade-desc">${upgrade.desc}</div>
        <button class="btn-primary btn-sm" style="margin-top: 14px; width: 100%;">Seleccionar</button>
      `;

      card.addEventListener('click', () => {
        this.applyUpgrade(upgrade);
        document.getElementById('modal-upgrade').classList.add('hidden');
        this.engine.setSpeed(1); // Reanudar
      });

      container.appendChild(card);
    });

    document.getElementById('modal-upgrade').classList.remove('hidden');
  }

  grantAutomaticRoadPieces() {
    const amount = (this.engine.currentLevel && this.engine.currentLevel.weeklyRoadPieces) || 15;
    this.engine.roadBudget += amount;
    this.engine.updateRoadUI();
  }

  applyUpgrade(upgrade) {
    switch (upgrade.id) {
      case 'load_balancer':
        this.engine.loadBalancerCharges = LOAD_BALANCER_MAX_CHARGES;
        this.engine.updateBalancerBadge();
        break;

      case 'protocol_accelerator':
        this.engine.protocolAccelerators++;
        this.engine.updateRoadUI();
        break;

      case 'firewall':
        this.engine.firewallCharges = FIREWALL_MAX_CHARGES;
        this.engine.updateFirewallBadge();
        break;

      case 'network_switch':
        this.engine.networkSwitches++;
        this.engine.updateRoadUI();
        break;

      case 'cable_reinforcement':
        this.engine.cableReinforcements += CABLE_REINFORCEMENT_GRANT_AMOUNT;
        this.engine.updateRoadUI();
        break;

      case 'request_limiter':
        this.engine.requestLimiters++;
        this.engine.updateRoadUI();
        break;

      case 'node_hammer':
        this.engine.hammers++;
        this.engine.updateRoadUI();
        break;
    }
  }
}
