import { addItem, addTag } from '../src/models/actions';
import { createDefaultState } from '../src/models/defaults';
import {
  LONG_TRACK_MS,
  albumOf,
  artistOf,
  durationLabel,
  parseSavedQueue,
  resumeSeconds,
  shuffledFrom,
  withoutItems,
  type QueueEntry,
} from '../src/models/queue';
import { shelfReducer } from '../src/models/shelfReducer';

const entry = (itemId: string): QueueEntry => ({
  itemId,
  uri: `file:///${itemId}`,
  title: itemId,
  artist: '',
  album: '',
  coverUri: null,
  durationMs: 1000,
});
const ids = (queue: QueueEntry[]) => queue.map((e) => e.itemId);

describe('queue', () => {
  it('shuffles with the chosen song first and every song kept', () => {
    const list = ['a', 'b', 'c', 'd', 'e'];
    let seed = 0.3;
    const random = () => (seed = (seed * 9301 + 0.49297) % 1);
    const mixed = shuffledFrom(list, 2, random);
    expect(mixed[0]).toBe('c');
    expect([...mixed].sort()).toEqual(list);
    expect(shuffledFrom([], 0)).toEqual([]);
  });

  it('drops deleted songs and keeps playing from the right place', () => {
    const queue = ['a', 'b', 'c', 'd'].map(entry);
    // A song before the current one goes: the current one moves up.
    expect(withoutItems(queue, 2, new Set(['a']))).toMatchObject({ current: 1 });
    // The current one goes: the next one takes its place.
    const after = withoutItems(queue, 1, new Set(['b']));
    expect(ids(after.queue)).toEqual(['a', 'c', 'd']);
    expect(after.current).toBe(1);
    // The last one, while current: the new last one.
    expect(withoutItems(queue, 3, new Set(['d']))).toMatchObject({ current: 2 });
    expect(withoutItems(queue, 0, new Set(['a', 'b', 'c', 'd']))).toEqual({ queue: [], current: -1 });
  });

  it('resumes only long songs, and not when they were nearly done', () => {
    expect(resumeSeconds(3 * 60_000, 60_000)).toBe(0);
    expect(resumeSeconds(LONG_TRACK_MS, 600_000)).toBe(600);
    expect(resumeSeconds(LONG_TRACK_MS, LONG_TRACK_MS - 5000)).toBe(0);
    expect(resumeSeconds(null, 600_000)).toBe(0);
    expect(resumeSeconds(LONG_TRACK_MS, null)).toBe(0);
  });

  it('reads a saved queue, and ignores damaged ones', () => {
    expect(parseSavedQueue('{"itemIds":["a","b"],"index":1}')).toEqual({ itemIds: ['a', 'b'], index: 1 });
    expect(parseSavedQueue('{"itemIds":["a"],"index":9}')).toEqual({ itemIds: ['a'], index: 0 });
    expect(parseSavedQueue('{"itemIds":[],"index":0}')).toBeNull();
    expect(parseSavedQueue('not json')).toBeNull();
    expect(parseSavedQueue(undefined)).toBeNull();
  });

  it('finds the artist tag in either language', () => {
    let state = createDefaultState();
    state = shelfReducer(state, addItem(state.shelves[4], 'Song'));
    const [song] = state.items;
    expect(artistOf(song)).toBe('');
    state = shelfReducer(state, addTag(song.id, 'Artist', 'The Band'));
    expect(artistOf(state.items[0])).toBe('The Band');
    const chinese = { ...song, tags: [{ id: 't', name: '艺术家', value: '乐队' }] };
    expect(artistOf(chinese)).toBe('乐队');
    expect(albumOf({ ...song, tags: [{ id: 'a', name: 'Album', value: ' Roads ' }] })).toBe('Roads');
  });

  it('formats lengths', () => {
    expect(durationLabel(0)).toBe('0:00');
    expect(durationLabel(185_000)).toBe('3:05');
    expect(durationLabel(3_729_000)).toBe('1:02:09');
  });
});
