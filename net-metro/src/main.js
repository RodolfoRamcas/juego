/**
 * NETMETRO - ENTRADA PRINCIPAL Y CONTROLADOR DE INTERFAZ (MAIN)
 */

import { Engine } from './core/Engine.js';
import { GAME_SPEEDS } from './config/constants.js';
import { supabaseService } from './services/SupabaseService.js';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('gameCanvas');
  const engine = new Engine(canvas);
  engine.start();

  // ==================== VINCULACIÓN DE BOTONES Y MODALES ====================

  // 1. Pantalla de Inicio
  const screenStart = document.getElementById('screen-start');
  const modalInstructions = document.getElementById('modal-instructions');
  const modalLeaderboard = document.getElementById('modal-leaderboard');
  const modalGameOver = document.getElementById('modal-gameover');

  document.getElementById('btn-play-game').addEventListener('click', () => {
    screenStart.classList.remove('active');
    screenStart.classList.add('hidden');
    engine.startGame();
  });

  document.getElementById('btn-open-instructions').addEventListener('click', () => {
    modalInstructions.classList.remove('hidden');
  });

  document.getElementById('btn-close-instructions').addEventListener('click', () => {
    modalInstructions.classList.add('hidden');
  });

  document.getElementById('btn-open-leaderboard').addEventListener('click', () => {
    loadAndShowLeaderboard();
  });

  document.getElementById('btn-close-leaderboard').addEventListener('click', () => {
    modalLeaderboard.classList.add('hidden');
  });

  document.getElementById('btn-refresh-leaderboard').addEventListener('click', () => {
    loadAndShowLeaderboard();
  });

  // ==================== REGISTRO DE PUNTUACIONES ====================
  document.getElementById('btn-submit-score').addEventListener('click', async () => {
    const nickInput = document.getElementById('player-nickname');
    const statusMsg = document.getElementById('submit-status');
    const name = nickInput.value.trim();

    if (!name) {
      statusMsg.textContent = 'Por favor escribe tu nombre o alias.';
      statusMsg.className = 'status-msg error';
      return;
    }

    statusMsg.textContent = 'Guardando récord...';
    statusMsg.className = 'status-msg';

    const result = await supabaseService.saveScore({
      playerName: name,
      scorePackets: engine.packetsDelivered,
      weeksSurvived: engine.currentWeek,
      levelName: engine.currentLevel ? engine.currentLevel.name : 'Modo Libre'
    });

    if (result.success) {
      statusMsg.textContent = '✅ ¡Récord guardado exitosamente en el ranking global!';
      document.getElementById('btn-submit-score').disabled = true;
    } else {
      statusMsg.textContent = result.error
        ? `❌ ${result.error}`
        : 'Error al registrar la puntuación.';
      statusMsg.className = 'status-msg error';
    }
  });

  // ==================== ACCIONES DE FIN DE PARTIDA ====================
  document.getElementById('btn-retry').addEventListener('click', () => {
    modalGameOver.classList.add('hidden');
    document.getElementById('btn-return-to-summary').classList.add('hidden');
    document.getElementById('btn-submit-score').disabled = false;
    document.getElementById('submit-status').textContent = '';
    engine.startGame();
  });

  document.getElementById('btn-view-board').addEventListener('click', () => {
    // Solo oculta el modal para dejar ver la red tal como quedó en el momento de la derrota
    // (el juego ya está en estado GAMEOVER, así que nada sigue simulándose de fondo).
    modalGameOver.classList.add('hidden');
    document.getElementById('btn-return-to-summary').classList.remove('hidden');
  });

  document.getElementById('btn-return-to-summary').addEventListener('click', () => {
    modalGameOver.classList.remove('hidden');
    document.getElementById('btn-return-to-summary').classList.add('hidden');
  });

  document.getElementById('btn-go-menu').addEventListener('click', () => {
    document.getElementById('btn-return-to-summary').classList.add('hidden');
    modalGameOver.classList.add('hidden');
    document.getElementById('btn-submit-score').disabled = false;
    document.getElementById('submit-status').textContent = '';
    document.getElementById('game-hud').classList.add('hidden');
    document.getElementById('road-tray').classList.add('hidden');
    document.getElementById('btn-toggle-top-hud').classList.add('hidden');
    document.getElementById('btn-toggle-bottom-hud').classList.add('hidden');
    screenStart.classList.remove('hidden');
    screenStart.classList.add('active');
    engine.state = 'MENU';
  });

  // ==================== CONTROLES DE TIEMPO Y HUD ====================
  document.getElementById('btn-speed-pause').addEventListener('click', () => {
    engine.setSpeed(engine.speed === GAME_SPEEDS.PAUSE ? GAME_SPEEDS.NORMAL : GAME_SPEEDS.PAUSE);
  });

  document.getElementById('btn-speed-1x').addEventListener('click', () => {
    engine.setSpeed(GAME_SPEEDS.NORMAL);
  });

  document.getElementById('btn-speed-2x').addEventListener('click', () => {
    engine.setSpeed(GAME_SPEEDS.FAST);
  });

  document.getElementById('btn-center-camera').addEventListener('click', () => {
    engine.centerCameraOnNodes();
  });

  document.getElementById('btn-toggle-sound').addEventListener('click', (e) => {
    const isAudioOn = engine.soundManager.toggleMute();
    e.currentTarget.textContent = isAudioOn ? '🔊' : '🔇';
  });

  document.getElementById('btn-in-game-menu').addEventListener('click', () => {
    engine.setSpeed(0);
    modalInstructions.classList.remove('hidden');
  });

  // ==================== OCULTAR/MOSTRAR PANELES (VISIBILIDAD DEL MAPA) ====================
  // El jugador puede esconder el panel superior y/o inferior para despejar la vista del mapa.
  // Es independiente del estado dentro/fuera de partida (clase "hidden"): usa su propia
  // clase "hud-collapsed" y recuerda la preferencia entre sesiones con localStorage.
  let topHudCollapsed = false;
  let bottomHudCollapsed = false;

  function applyTopHudCollapse(collapsed) {
    topHudCollapsed = collapsed;
    document.getElementById('game-hud').classList.toggle('hud-collapsed', collapsed);
    const tab = document.getElementById('btn-toggle-top-hud');
    tab.textContent = collapsed ? '▼' : '▲';
    tab.title = collapsed ? 'Mostrar panel superior (H)' : 'Ocultar panel superior (H)';
    try { localStorage.setItem('netmetro_top_hud_collapsed', collapsed ? '1' : '0'); } catch (e) { /* almacenamiento no disponible */ }
  }

  function applyBottomHudCollapse(collapsed) {
    bottomHudCollapsed = collapsed;
    document.getElementById('road-tray').classList.toggle('hud-collapsed', collapsed);
    const tab = document.getElementById('btn-toggle-bottom-hud');
    tab.textContent = collapsed ? '▲' : '▼';
    tab.title = collapsed ? 'Mostrar panel inferior (H)' : 'Ocultar panel inferior (H)';
    try { localStorage.setItem('netmetro_bottom_hud_collapsed', collapsed ? '1' : '0'); } catch (e) { /* almacenamiento no disponible */ }
  }

  try {
    applyTopHudCollapse(localStorage.getItem('netmetro_top_hud_collapsed') === '1');
    applyBottomHudCollapse(localStorage.getItem('netmetro_bottom_hud_collapsed') === '1');
  } catch (e) {
    applyTopHudCollapse(false);
    applyBottomHudCollapse(false);
  }

  document.getElementById('btn-toggle-top-hud').addEventListener('click', () => applyTopHudCollapse(!topHudCollapsed));
  document.getElementById('btn-toggle-bottom-hud').addEventListener('click', () => applyBottomHudCollapse(!bottomHudCollapsed));

  // ==================== HERRAMIENTAS DE BANDEJA ====================
  const toolRoadEl = document.getElementById('tool-road');
  if (toolRoadEl) {
    toolRoadEl.addEventListener('click', () => {
      engine.activeTool = 'road';
      engine.updateRoadUI();
    });
  }

  const toolAcceleratorEl = document.getElementById('tool-accelerator');
  if (toolAcceleratorEl) {
    toolAcceleratorEl.addEventListener('click', () => {
      if (engine.protocolAccelerators > 0) {
        engine.activeTool = engine.activeTool === 'accelerator' ? 'road' : 'accelerator';
        engine.updateRoadUI();
      }
    });
  }

  const toolSwitchEl = document.getElementById('tool-switch');
  if (toolSwitchEl) {
    toolSwitchEl.addEventListener('click', () => {
      if (engine.networkSwitches > 0) {
        engine.activeTool = engine.activeTool === 'switch' ? 'road' : 'switch';
        engine.updateRoadUI();
      }
    });
  }

  const toolReinforcementEl = document.getElementById('tool-reinforcement');
  if (toolReinforcementEl) {
    toolReinforcementEl.addEventListener('click', () => {
      if (engine.cableReinforcements > 0) {
        engine.activeTool = engine.activeTool === 'reinforcement' ? 'road' : 'reinforcement';
        engine.updateRoadUI();
      }
    });
  }

  const toolLimiterEl = document.getElementById('tool-limiter');
  if (toolLimiterEl) {
    toolLimiterEl.addEventListener('click', () => {
      if (engine.requestLimiters > 0) {
        engine.activeTool = engine.activeTool === 'limiter' ? 'road' : 'limiter';
        engine.updateRoadUI();
      }
    });
  }

  // Atajos de teclado
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;

    if (e.code === 'Space') {
      e.preventDefault();
      engine.setSpeed(engine.speed === GAME_SPEEDS.PAUSE ? GAME_SPEEDS.NORMAL : GAME_SPEEDS.PAUSE);
    } else if (e.code === 'Digit1') {
      engine.setSpeed(GAME_SPEEDS.NORMAL);
    } else if (e.code === 'Digit2') {
      engine.setSpeed(GAME_SPEEDS.FAST);
    } else if (e.code === 'KeyH') {
      // Oculta/muestra ambos paneles a la vez para despejar la vista del mapa
      const shouldCollapse = !(topHudCollapsed && bottomHudCollapsed);
      applyTopHudCollapse(shouldCollapse);
      applyBottomHudCollapse(shouldCollapse);
    } else if (e.code === 'KeyR' && !e.repeat) {
      // Mantener R reinicia la partida (ver Engine.update): e.repeat evita reiniciar el
      // conteo en cada evento de auto-repetición del sistema operativo mientras sigue abajo.
      engine.setRestartKeyHeld(true);
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyR') {
      engine.setRestartKeyHeld(false);
    }
  });

  // Si la ventana pierde el foco (alt+tab, cambiar de app) con R presionada, el keyup nunca
  // llega: sin esto, la barra de reinicio quedaría "pegada" a medio llenar.
  window.addEventListener('blur', () => {
    engine.setRestartKeyHeld(false);
  });

  // ==================== FUNCIONES AUXILIARES ====================
  async function loadAndShowLeaderboard() {
    modalLeaderboard.classList.remove('hidden');
    const tbody = document.getElementById('leaderboard-body');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px;">Consultando base de datos...</td></tr>';

    updateSupabaseStatusIndicator();

    const { scores, source } = await supabaseService.getTopScores(10);
    tbody.innerHTML = '';

    if (!scores || scores.length === 0) {
      // Distingue "no hay cliente de Supabase creado" (config ausente/vacía) de "hay cliente
      // pero la consulta falló" (RLS, tabla inexistente, clave inválida, etc.): son causas muy
      // distintas y conviene poder diferenciarlas al depurar.
      if (source === 'cloud') {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px;">Aún no hay puntuaciones registradas. ¡Sé el primero!</td></tr>';
      } else if (source === 'error') {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px;">⚠️ Hay conexión, pero la consulta a la base de datos falló (revisa la consola).</td></tr>';
      } else {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px;">⚠️ Sin conexión a la base de datos: el ranking global no está disponible ahora.</td></tr>';
      }
      return;
    }

    scores.forEach((entry, idx) => {
      const row = document.createElement('tr');
      const dateStr = entry.created_at ? new Date(entry.created_at).toLocaleDateString() : 'Hoy';

      row.innerHTML = `
        <td style="font-weight: 800; color: ${idx === 0 ? 'var(--accent-amber)' : 'var(--text-muted)'};">#${idx + 1}</td>
        <td style="font-weight: 600;">${escapeHtml(entry.player_name)}</td>
        <td><span class="badge">${escapeHtml(entry.level_name || 'Modo Libre')}</span></td>
        <td style="font-family: var(--font-mono); font-weight: 700; color: var(--accent-cyan);">${entry.score_packets}</td>
        <td style="font-family: var(--font-mono);">${entry.weeks_survived} sem</td>
        <td style="color: var(--text-muted); font-size: 0.8rem;">${dateStr}</td>
      `;
      tbody.appendChild(row);
    });
  }

  function updateSupabaseStatusIndicator() {
    const dot = document.getElementById('supabase-status-dot');
    const text = document.getElementById('supabase-status-text');
    if (supabaseService.client) {
      dot.className = 'dot-indicator dot-online';
      text.textContent = 'Servidor Central: En línea (Global)';
    } else {
      dot.className = 'dot-indicator dot-offline';
      text.textContent = 'Servidor Local (Modo Desconectado)';
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Comprobar estado inicial de Supabase
  updateSupabaseStatusIndicator();
});
