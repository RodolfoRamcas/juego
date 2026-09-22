/**
 * NETMETRO - CONFIGURACIÓN DEL MODO DE JUEGO
 * Modo único de Supervivencia Infinita (sin campaña de misiones): la red crece sin límite y
 * el objetivo es resistir la mayor cantidad de semanas y paquetes posible para el Leaderboard.
 */

import { NODE_SHAPES } from './constants.js';

export const GAME_CONFIG = {
  name: 'Supervivencia Infinita',
  subtitle: 'Modo Competitivo Global',
  description: 'La red crecerá sin límite. Resiste la mayor cantidad de semanas y paquetes posible para registrarte en el Leaderboard.',
  initialRoadBudget: 80,
  weeklyRoadPieces: 26,
  initialNodes: 6,  // 3 pares = solo 3 figuras distintas al arrancar la Semana 1
  maxNodes: 30,
  nodeSpawnIntervalDays: 2.8,
  packetSpawnRate: 1.3,
  // La generación procedural (ver TrafficGenerator.chooseNextShape) introduce las figuras
  // restantes de esta lista automáticamente a medida que avanza la partida
  allowedShapes: [NODE_SHAPES.CIRCLE, NODE_SHAPES.SQUARE, NODE_SHAPES.TRIANGLE, NODE_SHAPES.HEXAGON, NODE_SHAPES.STAR],
  eventsEnabled: true,
  eventFrequencyDays: 2.5,
  trafficMultiplierPerWeek: 1.22
};
