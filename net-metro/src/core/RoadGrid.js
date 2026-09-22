/**
 * NETMETRO - RED DE CABLEADO EN GRILLA (ROAD GRID)
 * Cada celda de la cuadrícula puede estar vacía, ocupada por un nodo, o tendida con un
 * tramo de cable que los paquetes usan para viajar. Es una red única y compartida
 * (no hay "líneas" de colores separadas).
 */

import { cellKey, orthogonalNeighbors, cellToPixelCenter } from './Grid.js';
import {
  CONGESTION_LOAD_PER_PACKET, CONGESTION_DECAY_PER_SECOND, TILE_MAX_OCCUPANTS,
  CABLE_REINFORCEMENT_CUT_WEIGHT
} from '../config/constants.js';

const CELL_TYPES = {
  EMPTY: 'empty',
  NODE: 'node',
  ROAD: 'road'
};

export class RoadGrid {
  constructor() {
    this.cols = 0;
    this.rows = 0;
    this.cells = new Map(); // cellKey -> { type, node, isBlocked, blockTimer, isBoosted, load }
  }

  configure(cols, rows) {
    this.cols = cols;
    this.rows = rows;
  }

  reset() {
    this.cells.clear();
  }

  isInBounds(col, row) {
    return col >= 0 && row >= 0 && col < this.cols && row < this.rows;
  }

  getCell(col, row) {
    return this.cells.get(cellKey(col, row)) || null;
  }

  // ¿La celda está libre para colocar ahí un nodo o un tramo de cable nuevo?
  isOccupiable(col, row) {
    if (!this.isInBounds(col, row)) return false;
    const cell = this.getCell(col, row);
    return !cell || cell.type === CELL_TYPES.EMPTY;
  }

  placeNode(col, row, node) {
    if (!this.isOccupiable(col, row)) return false;
    this.cells.set(cellKey(col, row), {
      type: CELL_TYPES.NODE, node, isBlocked: false, blockTimer: 0, isBoosted: false,
      isReinforced: false, load: 0, occupants: [], vacateCooldown: 0
    });
    node.col = col;
    node.row = row;
    const center = cellToPixelCenter(col, row);
    node.x = center.x;
    node.y = center.y;
    return true;
  }

  placeRoad(col, row) {
    if (!this.isOccupiable(col, row)) return false;
    this.cells.set(cellKey(col, row), {
      type: CELL_TYPES.ROAD, node: null, isBlocked: false, blockTimer: 0, isBoosted: false,
      isReinforced: false, load: 0, occupants: [], vacateCooldown: 0
    });
    return true;
  }

  // No se puede retirar un tramo mientras tenga algún paquete encima (cell.occupants): permitirlo
  // dejaba "resolver" congestión, colas o incluso paquetes DDoS con solo borrar y reconstruir el
  // tramo, en vez de planificar el cableado o cortar la alimentación con anticipación.
  removeRoad(col, row) {
    const cell = this.getCell(col, row);
    if (!cell || cell.type !== CELL_TYPES.ROAD) return false;
    if (cell.occupants && cell.occupants.length > 0) return false;
    this.cells.delete(cellKey(col, row));
    return true;
  }

  // Deshace la colocación de un nodo (usado únicamente cuando no se pudo completar su par)
  removeNode(col, row) {
    const cell = this.getCell(col, row);
    if (!cell || cell.type !== CELL_TYPES.NODE) return false;
    this.cells.delete(cellKey(col, row));
    return true;
  }

  // ¿Se puede circular por esta celda? (nodo, o cable no bloqueado por mantenimiento)
  isTraversable(col, row) {
    const cell = this.getCell(col, row);
    if (!cell) return false;
    if (cell.type === CELL_TYPES.NODE) return true;
    if (cell.type === CELL_TYPES.ROAD) return !cell.isBlocked;
    return false;
  }

  // Vecinos ortogonales transitables, con su estado de celda incluido
  neighbors(col, row) {
    const result = [];
    for (const n of orthogonalNeighbors(col, row)) {
      if (!this.isInBounds(n.col, n.row)) continue;
      if (!this.isTraversable(n.col, n.row)) continue;
      result.push({ col: n.col, row: n.row, cell: this.getCell(n.col, n.row) });
    }
    return result;
  }

  getAllRoadCells() {
    const roads = [];
    for (const [key, cell] of this.cells) {
      if (cell.type === CELL_TYPES.ROAD) {
        const [col, row] = key.split(',').map(Number);
        roads.push({ col, row, cell });
      }
    }
    return roads;
  }

  // Evento de mantenimiento: bloquea temporalmente varios tramos de cable aleatorios y
  // distintos entre sí (hasta `count`, o menos si no hay tantos tramos disponibles). Los tramos
  // reforzados (Refuerzo de Cable) pesan CABLE_REINFORCEMENT_CUT_WEIGHT en el sorteo en vez de
  // 1: mucha menos probabilidad relativa de salir elegidos, pero nunca quedan 100% a salvo.
  blockRandomRoadTiles(count = 1, duration = 9) {
    const pool = this.getAllRoadCells()
      .filter(r => !r.cell.isBlocked)
      .map(r => ({ ref: r, weight: r.cell.isReinforced ? CABLE_REINFORCEMENT_CUT_WEIGHT : 1 }));
    if (pool.length === 0) return [];

    const chosen = [];
    while (chosen.length < count && pool.length > 0) {
      const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
      let roll = Math.random() * totalWeight;
      let pickIndex = pool.length - 1;
      for (let i = 0; i < pool.length; i++) {
        if (roll < pool[i].weight) { pickIndex = i; break; }
        roll -= pool[i].weight;
      }
      chosen.push(pool.splice(pickIndex, 1)[0].ref);
    }

    for (const c of chosen) {
      c.cell.isBlocked = true;
      c.cell.blockTimer = duration;
    }
    return chosen;
  }

  // Marca cada tile de una ruta recién despachada como "usado", para que el Router
  // prefiera caminos menos cargados en futuras decisiones de enrutamiento
  markRouteLoad(route) {
    for (const point of route) {
      const cell = this.getCell(point.col, point.row);
      if (cell) cell.load = (cell.load || 0) + CONGESTION_LOAD_PER_PACKET;
    }
  }

  // Cada casilla admite hasta TILE_MAX_OCCUPANTS paquetes a la vez (2 por defecto): así dos
  // paquetes que se cruzan en sentidos opuestos por el mismo tramo pueden coexistir un instante
  // en vez de generar un punto muerto que detenga toda la línea. Devuelve true si `packetId`
  // logra reservar un lugar (ya era suyo, o había hueco libre y sin enfriamiento pendiente).
  claimTile(col, row, packetId) {
    const cell = this.getCell(col, row);
    if (!cell) return false;
    if (cell.isBlocked) return false; // corte de fibra: no se puede avanzar hasta que reabra
    if (!cell.occupants) cell.occupants = [];
    if (cell.occupants.includes(packetId)) return true; // ya era suyo
    if (cell.occupants.length >= TILE_MAX_OCCUPANTS) return false;
    if (cell.vacateCooldown > 0) return false; // la casilla acaba de quedar vacía, aún enfriando
    cell.occupants.push(packetId);
    return true;
  }

  // Libera el lugar que ocupaba `packetId` en la casilla (si aún era suyo). Si la deja
  // completamente vacía, arranca un pequeño enfriamiento antes de aceptar un nuevo ocupante,
  // para que el relevo no se sienta instantáneo.
  releaseTile(col, row, packetId, cooldown = 0) {
    const cell = this.getCell(col, row);
    if (!cell || !cell.occupants) return;
    const idx = cell.occupants.indexOf(packetId);
    if (idx === -1) return;
    cell.occupants.splice(idx, 1);
    if (cell.occupants.length === 0 && cooldown > 0) {
      cell.vacateCooldown = cooldown;
    }
  }

  // Devuelve true si algún tramo bloqueado por mantenimiento se reabrió en este tick, para que
  // Engine pueda reintentar de inmediato el enrutamiento de los paquetes que quedaron en espera
  // (así el tráfico retoma su ritmo normal en vez de quedar detenido indefinidamente).
  update(dt) {
    let anyTileReopened = false;

    for (const cell of this.cells.values()) {
      if (cell.isBlocked) {
        cell.blockTimer -= dt;
        if (cell.blockTimer <= 0) {
          cell.isBlocked = false;
          anyTileReopened = true;
        }
      }
      if (cell.load > 0) {
        cell.load = Math.max(0, cell.load - CONGESTION_DECAY_PER_SECOND * dt);
      }
      if (cell.vacateCooldown > 0) {
        cell.vacateCooldown = Math.max(0, cell.vacateCooldown - dt);
      }
    }

    return anyTileReopened;
  }
}
