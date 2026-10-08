/**
 * NETMETRO - ENRUTADOR DE RED (ROUTER / SHORTEST PATH FINDER)
 * Dijkstra ponderado por congestión sobre la grilla de cableado. En vez de amontonar
 * siempre todo el tráfico sobre el camino más corto, el costo de cruzar un tile sube con
 * su carga reciente (ver RoadGrid.markRouteLoad), así que el enrutador reparte el tráfico
 * entre las rutas disponibles cuando existe más de un camino posible.
 */

import { CONGESTION_WEIGHT } from '../config/constants.js';
import { cellToPixelCenter } from './Grid.js';

export class Router {
  /**
   * Encuentra la ruta de menor costo (tile a tile) desde el nodo origen hasta el nodo
   * transitable más cercano que posea la forma requerida. El costo
   * de cada tramo es 1 + penalización por congestión, así que la ruta elegida es la más
   * corta ENTRE LAS MENOS CONGESTIONADAS, no necesariamente la de menos saltos.
   * @param {Node} startNode - Nodo donde se origina o se encuentra el paquete
   * @param {string} targetShape - Forma requerida (circle, square, etc.)
   * @param {RoadGrid} roadGrid - Grilla de cableado activa
   * @returns {{ route: Array<{col:number,row:number,x:number,y:number,node:Node|null}> } | null}
   */
  static findShortestPathToShape(startNode, targetShape, roadGrid) {
    if (!startNode || !targetShape || !roadGrid) return null;

    const startKey = `${startNode.col},${startNode.row}`;
    const startCell = roadGrid.getCell(startNode.col, startNode.row);

    const dist = new Map([[startKey, 0]]);
    const prevKey = new Map();
    const stepOf = new Map([[startKey, { col: startNode.col, row: startNode.row, cell: startCell }]]);
    const visited = new Set();

    while (true) {
      // Elegir, entre las celdas no visitadas, la de menor costo acumulado (Dijkstra simple:
      // la grilla es pequeña, así que una búsqueda lineal del mínimo es más que suficiente)
      let currentKey = null;
      let currentDist = Infinity;
      for (const [key, d] of dist) {
        if (!visited.has(key) && d < currentDist) {
          currentDist = d;
          currentKey = key;
        }
      }
      if (currentKey === null) break; // no quedan celdas alcanzables sin visitar

      visited.add(currentKey);
      const current = stepOf.get(currentKey);
      const currentNode = current.cell ? current.cell.node : null;

      // ¿Es este nodo un destino válido? (y no es el nodo inicial del salto)
      // Solo el nodo RECEPTOR de la forma buscada puede aceptar la entrega (el flujo es
      // unidireccional emisor -> receptor).
      if (currentNode && currentNode !== startNode &&
        currentNode.shape === targetShape && currentNode.role === 'receiver') {
        const path = [];
        let k = currentKey;
        while (k !== undefined) {
          path.unshift(Router.stepToPoint(stepOf.get(k)));
          k = prevKey.get(k);
        }
        return { route: path };
      }

      for (const neighbor of roadGrid.neighbors(current.col, current.row)) {
        const key = `${neighbor.col},${neighbor.row}`;
        if (visited.has(key)) continue;

        const edgeCost = 1 + CONGESTION_WEIGHT * (neighbor.cell.load || 0);
        const newDist = currentDist + edgeCost;
        if (newDist < (dist.has(key) ? dist.get(key) : Infinity)) {
          dist.set(key, newDist);
          prevKey.set(key, currentKey);
          stepOf.set(key, neighbor);
        }
      }
    }

    // No existe ruta disponible a ningún nodo con esa forma
    return null;
  }

  static stepToPoint(step) {
    const node = step.cell ? step.cell.node : null;
    const center = node ? { x: node.x, y: node.y } : cellToPixelCenter(step.col, step.row);
    // cell se conserva para que Packet pueda consultar isBlocked/isBoosted en vivo
    return { col: step.col, row: step.row, x: center.x, y: center.y, node, cell: step.cell };
  }

  /**
   * ¿Existe ALGÚN camino (por tramos de cable transitables, sin importar congestión) desde
   * `startNode` hasta algún nodo con la forma y el rol indicados? Es una simple búsqueda de
   * alcanzabilidad (BFS), más liviana que findShortestPathToShape porque no hace falta la
   * ruta más corta, solo saber si hay conexión real. Se usa para verificar que un nodo
   * RECEPTOR esté de verdad conectado a al menos un EMISOR de su misma forma (y no solo
   * "tocado" por un tramo de cable suelto que no lleva a ningún lado, ver Engine.update).
   * @param {Node} startNode
   * @param {string} targetShape
   * @param {'sender'|'receiver'} targetRole
   * @param {RoadGrid} roadGrid
   * @returns {boolean}
   */
  static isConnectedToRole(startNode, targetShape, targetRole, roadGrid) {
    if (!startNode || !targetShape || !roadGrid) return false;

    const startKey = `${startNode.col},${startNode.row}`;
    const visited = new Set([startKey]);
    const queue = [{ col: startNode.col, row: startNode.row }];

    while (queue.length > 0) {
      const current = queue.shift();
      const cell = roadGrid.getCell(current.col, current.row);
      const currentNode = cell ? cell.node : null;

      if (currentNode && currentNode !== startNode &&
        currentNode.shape === targetShape && currentNode.role === targetRole) {
        return true;
      }

      for (const neighbor of roadGrid.neighbors(current.col, current.row)) {
        const key = `${neighbor.col},${neighbor.row}`;
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push({ col: neighbor.col, row: neighbor.row });
      }
    }

    return false;
  }
}
