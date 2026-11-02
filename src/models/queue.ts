import { translate } from '../i18n';
import type { Id, Item } from './types';

// The music player's queue, kept as plain data so the rules (shuffle, resume,
// what happens when a queued song is deleted) can be tested without audio.

/** One song in the queue, with what the player and the mini player show. */
export interface QueueEntry {
  itemId: Id;
  uri: string;
  title: string;
  artist: string;
  coverUri: string | null;
  durationMs: number | null;
}

export type RepeatMode = 'off' | 'all' | 'one';

export const REPEAT_MODES: RepeatMode[] = ['off', 'all', 'one'];

/** Songs at least this long (audiobooks, mixes) resume where they stopped; shorter ones start over. */
export const LONG_TRACK_MS = 20 * 60 * 1000;

/**
 * Where to start a song, in seconds: the saved position for a long one, unless
 * it was nearly finished; otherwise the beginning.
 */
export function resumeSeconds(durationMs: number | null, savedMs: number | null): number {
  if (durationMs === null || savedMs === null || durationMs < LONG_TRACK_MS) return 0;
  return savedMs < durationMs - 10_000 ? savedMs / 1000 : 0;
}

/** `list` with the element at `first` moved to the front and the rest in random order. */
export function shuffledFrom<T>(list: T[], first: number, random: () => number = Math.random): T[] {
  const rest = list.filter((_, i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return first >= 0 && first < list.length ? [list[first], ...rest] : rest;
}

/**
 * The queue without the songs in `removed` (deleted or moved off their shelf),
 * and where the current song is now. If the current song itself is removed,
 * the one after it becomes current; -1 means the queue is empty.
 */
export function withoutItems(queue: QueueEntry[], current: number, removed: Set<Id>): { queue: QueueEntry[]; current: number } {
  const kept = queue.filter((e) => !removed.has(e.itemId));
  if (kept.length === 0) return { queue: kept, current: -1 };
  const before = queue.slice(0, Math.max(0, current)).filter((e) => !removed.has(e.itemId)).length;
  return { queue: kept, current: Math.min(before, kept.length - 1) };
}

/** What's saved so the app can bring the queue back after a restart. */
export interface SavedQueue {
  itemIds: Id[];
  index: number;
}

export function parseSavedQueue(json: string | undefined): SavedQueue | null {
  if (!json) return null;
  try {
    const value: unknown = JSON.parse(json);
    if (typeof value !== 'object' || value === null) return null;
    const { itemIds, index } = value as Record<string, unknown>;
    if (!Array.isArray(itemIds) || typeof index !== 'number') return null;
    const ids = itemIds.filter((id): id is string => typeof id === 'string');
    return ids.length > 0 ? { itemIds: ids, index: Math.max(0, Math.min(Math.floor(index), ids.length - 1)) } : null;
  } catch {
    return null;
  }
}

/**
 * A song's artist, from its Artist tag. Tags are named in the language that
 * was set when the song was imported, so both languages' names are checked.
 */
export function artistOf(item: Item): string {
  const names = new Set([translate('en', 'tag.artist'), translate('zh', 'tag.artist')]);
  return item.tags.find((tag) => names.has(tag.name) && tag.value.trim())?.value.trim() ?? '';
}

/** "3:05", or "1:02:09" for an hour or more. */
export function durationLabel(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const [h, m, s] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
