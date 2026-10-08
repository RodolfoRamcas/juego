/**
 * NETMETRO - UTILIDADES DE GRILLA (GRID)
 * Conversión entre coordenadas de píxel y celdas de la cuadrícula de cableado.
 */

import { GRID_CELL_SIZE } from '../config/constants.js';

export function pixelToCell(x, y) {
  return {
    col: Math.floor(x / GRID_CELL_SIZE),
    row: Math.floor(y / GRID_CELL_SIZE)
  };
}

export function cellToPixelCenter(col, row) {
  return {
    x: col * GRID_CELL_SIZE + GRID_CELL_SIZE / 2,
    y: row * GRID_CELL_SIZE + GRID_CELL_SIZE / 2
  };
}

export function cellKey(col, row) {
  return `${col},${row}`;
}

// Vecinos ortogonales (no diagonales): así el trazado y el pathfinding son predecibles
export function orthogonalNeighbors(col, row) {
  return [
    { col: col + 1, row },
    { col: col - 1, row },
    { col, row: row + 1 },
    { col, row: row - 1 }
  ];
}

export function areAdjacentCells(colA, rowA, colB, rowB) {
  const dCol = Math.abs(colA - colB);
  const dRow = Math.abs(rowA - rowB);
  return (dCol + dRow) === 1;
}
