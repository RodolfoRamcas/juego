/**
 * NETMETRO - CONSTANTES Y CONFIGURACIÓN GLOBAL
 */

export const NODE_SHAPES = {
  CIRCLE: 'circle',       // Cliente / Terminal ISP
  SQUARE: 'square',       // Servidor Web / App
  TRIANGLE: 'triangle',   // Base de Datos Central
  HEXAGON: 'hexagon',     // CDN / Edge Storage
  STAR: 'star'            // Root DNS / Internet Exchange (IXP)
};

export const NODE_LABELS = {
  circle: 'Terminal Cliente',
  square: 'Servidor App',
  triangle: 'Base de Datos',
  hexagon: 'Nodo CDN Edge',
  star: 'Core Router IXP'
};

// Tamaño de cada celda de la cuadrícula de cableado, en píxeles
export const GRID_CELL_SIZE = 44;

// El mundo de la grilla es apenas más grande que la pantalla visible (viewport x este
// multiplicador en cada eje): deja un margen reducido pero real para desplazar la cámara,
// sin que el mapa se sienta mucho más grande que la pantalla.
export const WORLD_SIZE_MULTIPLIER = 1.12;

// Velocidad de desplazamiento de cámara con teclado (WASD / flechas), en píxeles/segundo
export const CAMERA_PAN_SPEED = 900;

// Segundos que hay que mantener presionada la tecla R para reiniciar la partida actual (con un
// layout de figuras nuevo y aleatorio). Se exige "mantener" en vez de una sola pulsación para
// que no se reinicie por accidente toda la red construida.
export const RESTART_HOLD_SECONDS = 1.2;

// Piezas de presupuesto que cuesta tender un tramo de cable
// (equivale a un costo por píxel, ya que cada tramo mide GRID_CELL_SIZE px fijos)
export const PIECE_COST_PER_TILE = 1;

// Velocidad base de los paquetes en píxeles/segundo (a mayor distancia, más tarda el viaje)
export const PACKET_PIXELS_PER_SECOND = 320;

// Multiplicador de velocidad al cruzar un tile potenciado por el Acelerador de Protocolo
export const PROTOCOL_ACCELERATOR_MULTIPLIER = 2.2;

// Tiempo máximo (segundos) que un paquete puede existir (en búfer o en tránsito)
// antes de darse por perdido. Es la fuente principal de dificultad real del juego.
export const MAX_PACKET_LIFETIME = 22;

// Paquetes perdidos por expiración que el jugador puede tolerar antes del Game Over
export const MAX_LOST_PACKETS = 8;

// Enrutamiento consciente de congestión: cada paquete despachado suma "carga" a los tiles
// de su ruta, la cual se disipa con el tiempo. El Router prefiere caminos con menos carga
// acumulada en vez de amontonar siempre todo el tráfico sobre el camino más corto.
export const CONGESTION_LOAD_PER_PACKET = 1;   // carga añadida a cada tile de la ruta al despachar un paquete
export const CONGESTION_DECAY_PER_SECOND = 0.4; // qué tan rápido se disipa la carga de un tile
export const CONGESTION_WEIGHT = 1.5;           // cuánto penaliza la carga el costo de una arista al enrutar

// Colores de renderizado del cable (red única compartida, sin colores por línea)
export const ROAD_COLOR = '#38bdf8';
export const ROAD_GLOW = 'rgba(56, 189, 248, 0.35)';
export const ROAD_BLOCKED_COLOR = '#f43f5e';

export const UPGRADE_TYPES = {
  LOAD_BALANCER: {
    id: 'load_balancer',
    name: 'Balanceador de Carga',
    icon: '⚖️',
    desc: 'Se activa solo: mientras dure un ataque DDoS, reduce a la mitad el bloqueo de recepción de los nodos que sean golpeados por paquetes maliciosos. Solo puedes tener uno a la vez.',
    isDraggable: false
  },
  PROTOCOL_ACCELERATOR: {
    id: 'protocol_accelerator',
    name: 'Acelerador de Protocolo',
    icon: '⚡',
    desc: 'Duplica la velocidad de los paquetes que cruzan un tramo de cable que elijas.',
    isDraggable: false
  },
  FIREWALL: {
    id: 'firewall',
    name: 'Firewall / Anti-DDoS',
    icon: '🛡️',
    desc: 'Ante un ataque DDoS, tiene 50% de probabilidad de bloquearlo por completo. Si falla, el ataque duplica su potencia. Solo puedes tener uno a la vez.',
    isDraggable: false
  },
  NETWORK_SWITCH: {
    id: 'network_switch',
    name: 'Switch de Red Gigabit',
    icon: '🔀',
    desc: 'Instálalo en el nodo que elijas: le permite aceptar hasta 5 entregas seguidas sin cooldown entre ellas (como varios puertos a la vez), reduce a 0.5s su cooldown normal, y suma capacidad extra de búfer.',
    isDraggable: true
  },
  CABLE_REINFORCEMENT: {
    id: 'cable_reinforcement',
    name: 'Refuerzo de Cable',
    icon: '🔩',
    desc: 'Te da 6 Piezas de Refuerzo: instálalas sobre tramos de cable que elijas para reducir en 75% la probabilidad de que ese tramo sea cortado por mantenimiento.',
    isDraggable: false
  },
  REQUEST_LIMITER: {
    id: 'request_limiter',
    name: 'Limitador de Requests',
    icon: '🚦',
    desc: 'Instálalo en un nodo emisor: si un ataque DDoS lo arrastra a generar tráfico malicioso (por ser emisor de la forma atacada), producirá muchos menos paquetes rojos.',
    isDraggable: true
  }
};

export const GAME_SPEEDS = {
  PAUSE: 0,
  NORMAL: 1,
  FAST: 2.2
};

export const TIME_CONFIG = {
  SECONDS_PER_DAY: 8,           // 8 segundos reales = 1 día virtual en 1x
  DAYS_PER_WEEK: 7,             // Lunes a Domingo
  CRITICAL_OVERFLOW_TIME: 6.0   // 6 segundos en saturación 100% causan Game Over
};

export const DEFAULT_NODE_BUFFER_CAPACITY = 6;

// Tiempo (segundos) que un nodo queda "enfriándose" justo después de aceptar la entrega de un
// paquete: mientras dura, no puede recibir otro y los que lleguen esperan su turno afuera, en
// la casilla de entrada (así se forman colas visibles en vez de entregas instantáneas).
// Aplica desde el arranque de la partida (no depende de la semana).
export const NODE_RECEIVE_COOLDOWN = 1.0;

// Cooldown de recepción reducido que otorga el Switch de Red Gigabit al nodo donde se instala
// (antes era exclusivo del Balanceador de Carga, que ahora es un objeto pasivo distinto):
// reemplaza a NODE_RECEIVE_COOLDOWN en ese nodo específico (ver Engine.onPacketDelivered).
export const LOAD_BALANCER_RECEIVE_COOLDOWN = 0.5;

// El Switch de Red Gigabit conmuta varios puertos a la vez: el nodo donde se instala puede
// aceptar esta cantidad de entregas seguidas sin ningún cooldown entre ellas (como si tuviera
// varios puertos recibiendo en simultáneo). Recién al completar la ráfaga entra en el cooldown
// normal de recepción (ver Engine.onPacketDelivered), y la cuenta arranca de nuevo desde cero.
export const SWITCH_BURST_CAPACITY = 5;

// Cada casilla de cable admite como máximo esta cantidad de paquetes a la vez. Con 1 sola
// plaza, dos paquetes que se cruzan en sentidos opuestos por el mismo tramo generan un punto
// muerto (cada uno espera la casilla que ocupa el otro) y detienen toda la línea. Con 2, ambos
// caben un instante y pueden cruzarse sin trabar el resto de la red.
export const TILE_MAX_OCCUPANTS = 2;

// Si un paquete NORMAL (no DDoS) pasa esta cantidad de segundos sin cambiar de posición en un
// tramo de cable (línea saturada por congestión o corte), se reencola en el último nodo
// visitado para que el Router le busque otro camino, en vez de quedarse esperando ahí
// indefinidamente. Solo aplica mientras está sobre un tramo de cable: si ya llegó a la puerta
// de un nodo y espera su cooldown de recepción, ese es un problema distinto (disponibilidad
// del destino, no de la ruta) y no dispara este reencolado (ver Packet.update).
export const PACKET_STUCK_REROUTE_SECONDS = 3.0;

// Peso relativo del ataque DDoS al elegir un evento aleatorio (ver EventSystem). Antes de la
// Semana 4 todos los eventos disponibles pesan 1 (igual probabilidad); desde la Semana 4 el
// DDoS pesa esto, haciéndolo mucho más frecuente que un corte de cable o un flash crowd.
export const DDOS_WEIGHT_FROM_WEEK4 = 3;

// Cuando una casilla queda completamente vacía tras estar llena, se "enfría" este tiempo antes
// de aceptar un nuevo ocupante, para que el relevo se sienta como un paso de turno y no instantáneo.
export const TILE_VACATE_COOLDOWN = 0.18;

// Desde la Semana 4, la generación de paquetes y de nuevas figuras se acelera: estos
// multiplicadores se aplican encima del escalado semanal normal (trafficMultiplierPerWeek).
export const PACKET_RATE_BOOST_FROM_WEEK4 = 1.4;      // multiplica la frecuencia de paquetes
export const NODE_SPAWN_INTERVAL_MULTIPLIER_FROM_WEEK4 = 0.7; // reduce el intervalo entre pares de nodos nuevos (más figuras, más seguido)

// Desde HARD_MODE_FROM_WEEK, la generación de paquetes se acelera todavía más (encima del boost
// de la Semana 4) y además deja de tener un intervalo perfectamente regular: cada ciclo varía al
// azar hasta un ±PACKET_RATE_JITTER_FROM_WEEK5 respecto al promedio, para que el tráfico no se
// sienta artificialmente sincronizado entre nodos (ver TrafficGenerator.update).
export const PACKET_RATE_BOOST_FROM_WEEK5 = 1.3;
export const PACKET_RATE_JITTER_FROM_WEEK5 = 0.45;

// Probabilidad de que el Firewall Anti-DDoS bloquee por completo un ataque (antes era 100%
// garantizado). Si falla, el ataque no se detiene y además duplica su potencia.
export const DDOS_FIREWALL_BLOCK_CHANCE = 0.5;
export const FIREWALL_FAIL_POWER_MULTIPLIER = 2;

// Desde la Semana 7, los ataques DDoS tienen más potencia base (más paquetes por segundo),
// independientemente de si el jugador tiene Firewall o no. Se combina multiplicativamente con
// FIREWALL_FAIL_POWER_MULTIPLIER si el firewall estaba presente y falló en bloquear el ataque.
export const DDOS_BASE_POWER_FROM_WEEK7 = 1.5;

// A partir de esta semana se activa el "modo difícil": los cortes de fibra inhabilitan más
// tramos a la vez (ver FIBER_CUT_HEAVY_TILE_COUNT) y el tráfico base se genera más rápido y de
// forma errática (ver TrafficGenerator.update). Antes de esta semana la red recién está
// creciendo, así que se mantiene el ritmo original.
export const HARD_MODE_FROM_WEEK = 5;

// Cantidad de tramos de cable que corta simultáneamente el evento de Corte de Fibra: el valor
// base aplica hasta HARD_MODE_FROM_WEEK, y desde ahí sube a FIBER_CUT_HEAVY_TILE_COUNT.
export const FIBER_CUT_TILE_COUNT = 6;
export const FIBER_CUT_HEAVY_TILE_COUNT = 10;

// A partir de esta semana, la Demanda Pico se garantiza un mínimo de FLASH_CROWD_MIN_PER_WEEK
// veces por semana y dispara tráfico desde TODOS los nodos emisores en cada ráfaga. Antes de
// esta semana, la red recién está creciendo (pocos nodos, presupuesto ajustado) así que se
// mantiene la versión liviana original para no hacerla injugable desde el arranque.
export const FLASH_CROWD_HEAVY_FROM_WEEK = 5;

// Cuántas veces como mínimo debe dispararse el evento de Demanda Pico (Flash Crowd) en el
// transcurso de una semana virtual desde FLASH_CROWD_HEAVY_FROM_WEEK, sin importar lo que
// decida el sorteo aleatorio de eventos (ver EventSystem.update): se reparte uniformemente a
// lo largo de la semana. Bajado a 1: con la intensidad de la versión "pesada", 3 veces por
// semana saturaba la red y provocaba una pérdida casi automática.
export const FLASH_CROWD_MIN_PER_WEEK = 1;

// Intervalo (ms) entre cada ráfaga de paquetes durante una Demanda Pico "pesada" (desde
// FLASH_CROWD_HEAVY_FROM_WEEK), y cuántos segundos dura el evento. En cada ráfaga se genera un
// paquete desde una FRACCIÓN de los nodos emisores disponibles (ver
// FLASH_CROWD_HEAVY_SENDER_FRACTION), así que la presión total sigue escalando con el tamaño
// de la red sin llegar a golpear a todos los emisores a la vez en cada ráfaga.
export const FLASH_CROWD_BURST_INTERVAL_MS = 700;
export const FLASH_CROWD_DURATION_SECONDS = 5;

// Fracción de los nodos emisores elegibles que disparan un paquete en cada ráfaga de la
// Demanda Pico "pesada" (1 = todos, como antes; 0.5 = la mitad, elegidos al azar en cada
// ráfaga). Se bajó de 1 a esto para que la versión pesada siga mandando más paquetes que la
// versión liviana previa a la Semana 5, pero notablemente menos que antes de este ajuste.
export const FLASH_CROWD_HEAVY_SENDER_FRACTION = 0.5;

// Versión liviana de la Demanda Pico (antes de FLASH_CROWD_HEAVY_FROM_WEEK): un solo paquete
// aleatorio por ráfaga, igual que el comportamiento original del evento.
export const FLASH_CROWD_LIGHT_INTERVAL_MS = 400;
export const FLASH_CROWD_LIGHT_DURATION_SECONDS = 6;

// Un ataque DDoS y una Demanda Pico nunca están activos al mismo tiempo: combinados podrían
// saturar al jugador con una pérdida prácticamente automática e injusta. Si el sorteo o la
// garantía semanal caen mientras el otro evento sigue activo, ese disparo se descarta (ver
// EventSystem.triggerDDoS / triggerFlashCrowd).

// Cuántas "Piezas de Refuerzo" otorga cada Refuerzo de Cable que el jugador elige como mejora
// semanal.
export const CABLE_REINFORCEMENT_GRANT_AMOUNT = 6;

// Peso relativo (respecto a 1 de un tramo normal) que tiene un tramo reforzado al sortear cuál
// tramo cortar en un evento de Corte de Fibra: 0.25 significa 75% menos probabilidad relativa
// de ser el elegido (nunca queda 100% a salvo, ver RoadGrid.blockRandomRoadTiles).
export const CABLE_REINFORCEMENT_CUT_WEIGHT = 0.25;

// Los paquetes de un ataque DDoS se identifican en este color (en vez del azul normal), y la
// única forma de neutralizarlos es evitar que avancen: si pasan más de
// DDOS_PACKET_STATIONARY_DROP_TIME segundos sin moverse de su casilla actual (cable cortado o
// congestión bloqueando el paso), se descartan SIN contar como paquete perdido (ver
// Packet.update / Engine.onDDoSPacketDropped).
export const DDOS_PACKET_COLOR = '#f43f5e';
export const DDOS_PACKET_STATIONARY_DROP_TIME = 0.5;

// Si en cambio un paquete DDoS logra llegar al nodo receptor, lo deja sin poder recibir NINGÚN
// paquete durante esta cantidad de segundos. Cada impacto reinicia el bloqueo desde cero (ver
// Engine.onDDoSPacketHit), así que el conteo real solo empieza a correr tras el último paquete
// DDoS que llegue, no desde el primero.
export const DDOS_RECEIVER_LOCKOUT_SECONDS = 10;

// El Balanceador de Carga ahora es un objeto pasivo de un solo uso (como el Firewall, no se
// puede tener más de uno ni instalarlo en un nodo): mientras esté activo, cualquier nodo
// bloqueado por un impacto DDoS (ver Engine.onDDoSPacketHit) recibe solo esta fracción del
// bloqueo normal (0.5 = la mitad de DDOS_RECEIVER_LOCKOUT_SECONDS) durante la duración del
// ataque.
export const LOAD_BALANCER_DDOS_LOCKOUT_MULTIPLIER = 0.5;

// Peso relativo (respecto a 1 de un emisor normal) que tiene un nodo con Limitador de Requests
// instalado al sortear qué emisor origina cada paquete de un ataque DDoS dirigido a su forma:
// 0.25 significa 75% menos probabilidad relativa de ser el elegido (ver
// TrafficGenerator.pickDDoSOriginSender). Nunca queda en 0: si TODOS los emisores de esa forma
// tienen el limitador, igual generan tráfico, solo que mucho menos.
export const REQUEST_LIMITER_DDOS_WEIGHT = 0.25;
