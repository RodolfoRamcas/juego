/**
 * NETMETRO - SISTEMA DE MEJORAS SEMANALES (UPGRADE SYSTEM)
 * Otorga al jugador mejoras estratégicas cada Domingo a medianoche.
 */

import { UPGRADE_TYPES, CABLE_REINFORCEMENT_GRANT_AMOUNT } from '../config/constants.js';

export class UpgradeSystem {
  constructor(engine) {
    this.engine = engine;
    this.inventory = {
      loadBalancers: 0
    };
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
    // El Firewall solo puede tenerse de a uno, así que no se ofrece de nuevo si ya está activo.
    const pool = [
      UPGRADE_TYPES.LOAD_BALANCER,
      UPGRADE_TYPES.PROTOCOL_ACCELERATOR,
      ...(this.engine.hasFirewall ? [] : [UPGRADE_TYPES.FIREWALL]),
      UPGRADE_TYPES.NETWORK_SWITCH,
      UPGRADE_TYPES.CABLE_REINFORCEMENT,
      UPGRADE_TYPES.REQUEST_LIMITER
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
        this.engine.loadBalancers++;
        this.engine.updateRoadUI();
        break;

      case 'protocol_accelerator':
        this.engine.protocolAccelerators++;
        this.engine.updateRoadUI();
        break;

      case 'firewall':
        this.engine.hasFirewall = true;
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
    }
  }
}
