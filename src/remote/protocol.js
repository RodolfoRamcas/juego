/**
 * NETMETRO - PROTOCOLO DEL MANDO MÓVIL
 * Constantes compartidas entre el juego (PC) y la página del mando (controller.html).
 * La comunicación viaja por un canal "broadcast" de Supabase Realtime: no necesita tablas ni
 * servidor propio, solo la misma URL/anon key que ya usa el Leaderboard.
 *
 * Mensajes del teléfono → PC:
 *   hello  { id }                         se une a la sala (se repite hasta recibir 'state')
 *   input  { id, x, y, put, erase }       foto completa del stick (-1..1) y botones sostenidos
 *   action { id, type, tool?, index? }    acciones puntuales (mejora, pausa, elegir recompensa...)
 *   bye    { id }                         el teléfono cerró la página
 * Mensajes de la PC → teléfono:
 *   state    { to, phase, paused, week, budget, counts, upgrades }
 *   feedback { to, ok, message }          resultado de una acción (p. ej. "apunta a un nodo")
 *   bye      {}                           la PC cerró la sala
 */

const PAD_CHANNEL_PREFIX = 'netmetro-pad-';
const ROOM_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // sin 0/o, 1/l/i para leerlo a mano
const ROOM_CODE_LENGTH = 8;

export const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

// Sin mensajes del otro lado por este tiempo, se da la conexión por perdida
export const PAD_TIMEOUT_MS = 5000;

// Mejoras que se colocan a mano sobre el mapa (las demás, Firewall y Balanceador, son pasivas)
export const PAD_TOOLS = [
  { id: 'accelerator', icon: '⚡', name: 'Acelerador', target: 'road' },
  { id: 'reinforcement', icon: '🔩', name: 'Refuerzo', target: 'road' },
  { id: 'switch', icon: '🔀', name: 'Switch', target: 'node' },
  { id: 'limiter', icon: '🚦', name: 'Limitador', target: 'node' },
  { id: 'hammer', icon: '🔨', name: 'Martillo', target: 'node' }
];

export function channelNameForRoom(room) {
  return `${PAD_CHANNEL_PREFIX}${room}`;
}

export function generateRoomCode() {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]).join('');
}
