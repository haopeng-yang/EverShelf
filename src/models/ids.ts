import type { Id } from './types';

let counter = 0;

/** Unique enough for local data: time + counter + random suffix. */
export function newId(): Id {
  counter = (counter + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
