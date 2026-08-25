import type { Building } from '../core/types.ts';

/**
 * The grounds. A 44x32 tile plot: the Inn at the head, the Inn Keeper's house
 * beside it, and each house manager's building arranged around a central
 * fountain.
 *
 * Coordinates are TILES, not pixels. The client multiplies by its tile size,
 * so the map survives an art change without touching this file.
 */
export const TILE = 32;
export const MAP_W = 44;
export const MAP_H = 32;
export const FOUNTAIN = { x: 22, y: 15 };

export const HOUSES: Building[] = [
  // --- civic ---
  { id: 'the-inn',         name: 'The Inn',         department: 'civic',     x: 18, y: 2,  w: 8, h: 5, doorX: 22, doorY: 7 },
  { id: 'the-house',       name: "The Keeper's House", department: 'civic',  x: 2,  y: 3,  w: 6, h: 4, doorX: 5,  doorY: 7 },

  // --- departments, clockwise from the north-west ---
  { id: 'the-vault',       name: 'The Vault',       department: 'money',     x: 34, y: 4,  w: 7, h: 5, doorX: 37, doorY: 9 },
  { id: 'the-observatory', name: 'The Observatory', department: 'analytics', x: 35, y: 12, w: 6, h: 5, doorX: 38, doorY: 17 },
  { id: 'the-market',      name: 'The Market',      department: 'product',   x: 34, y: 21, w: 7, h: 5, doorX: 37, doorY: 26 },
  { id: 'the-workshop',    name: 'The Workshop',    department: 'craft',     x: 24, y: 24, w: 7, h: 5, doorX: 27, doorY: 24 },
  { id: 'the-study',       name: 'The Study',       department: 'research',  x: 15, y: 24, w: 7, h: 5, doorX: 18, doorY: 24 },
  { id: 'the-studio',      name: 'The Studio',      department: 'studio',    x: 4,  y: 22, w: 8, h: 6, doorX: 8,  doorY: 22 },
  { id: 'the-parlour',     name: 'The Parlour',     department: 'outreach',  x: 3,  y: 14, w: 7, h: 5, doorX: 6,  doorY: 19 },
  { id: 'the-post',        name: 'The Post House',  department: 'inbox',     x: 3,  y: 8,  w: 6, h: 4, doorX: 6,  doorY: 12 },
  { id: 'the-nursery',     name: 'The Nursery',     department: 'family',    x: 11, y: 6,  w: 6, h: 4, doorX: 14, doorY: 10 },
  { id: 'the-larder',      name: 'The Larder',      department: 'household', x: 27, y: 7,  w: 6, h: 4, doorX: 30, doorY: 11 },
];

export const houseById = (id: string): Building | undefined => HOUSES.find((h) => h.id === id);
