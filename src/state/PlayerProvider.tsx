import {
  setAudioModeAsync,
  useAudioPlaylist,
  useAudioPlaylistStatus,
  type AudioPlaylist,
  type AudioPlaylistStatus,
} from 'expo-audio';
import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  artistOf,
  parseSavedQueue,
  resumeSeconds,
  shuffledFrom,
  withoutItems,
  type QueueEntry,
  type RepeatMode,
} from '@/models/queue';
import type { Id, Item, Track } from '@/models/types';
import { songUri } from '@/storage/bookFiles';
import {
  countPlay,
  loadPlaybackPosition,
  loadSettings,
  loadTracks,
  savePlaybackPosition,
  saveSetting,
  setTrackDuration,
} from '@/storage/database';

import { useShelfState } from './ShelfProvider';

/** Settings-table key for the queue, so it comes back after a restart. */
const SAVED_QUEUE_KEY = 'player.queue';
/** How often the position of the playing song is saved, in ms. */
const SAVE_EVERY = 5000;

interface PlayerContextValue {
  queue: QueueEntry[];
  /** Index of the current song in `queue`, or -1 when nothing is loaded. */
  current: number;
  status: AudioPlaylistStatus;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Replaces the queue with `entries` and plays from `start`. With shuffle, `start` plays first and the rest is mixed. */
  playQueue: (entries: QueueEntry[], start: number, options?: { shuffle?: boolean }) => void;
  togglePlay: () => void;
  next: () => void;
  previous: () => void;
  skipTo: (index: number) => void;
  seekTo: (seconds: number) => void;
  setShuffle: (on: boolean) => void;
  setRepeat: (mode: RepeatMode) => void;
  removeAt: (index: number) => void;
  /** Moves a song that isn't playing to another place in the queue. */
  move: (from: number, to: number) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

/** Builds queue entries for songs (items with a track); other items are left out. */
export function queueEntries(items: Item[], tracks: ReadonlyMap<Id, Track>): QueueEntry[] {
  return items.flatMap((item) => {
    const track = tracks.get(item.id);
    if (!track) return [];
    return [
      {
        itemId: item.id,
        uri: songUri(item.id, track.fileName),
        title: item.title,
        artist: artistOf(item),
        coverUri: item.coverUri,
        durationMs: track.durationMs,
      },
    ];
  });
}

const source = (entry: QueueEntry) => ({ uri: entry.uri, name: entry.title });

/** The playlist's own loop setting for a repeat mode. */
function applyRepeat(playlist: AudioPlaylist, mode: RepeatMode): void {
  playlist.loop = mode === 'one' ? 'single' : mode === 'all' ? 'all' : 'none';
}

/**
 * One audio playlist for the whole app, mounted above the screens so music
 * keeps playing while the user moves between shelves or opens a book. The
 * queue is kept here as well as in the playlist, since the playlist only
 * knows file URIs; the two are always changed together.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const state = useShelfState();
  const playlist = useAudioPlaylist({ updateInterval: 500 });
  const status = useAudioPlaylistStatus(playlist);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  // The queue in its own order, to go back to when shuffle is turned off.
  const ordered = useRef<QueueEntry[]>([]);
  const [shuffle, setShuffleState] = useState(false);
  const [repeat, setRepeatState] = useState<RepeatMode>('off');

  const current = queue.length === 0 ? -1 : Math.min(Math.max(status.currentIndex, 0), queue.length - 1);
  const entry = current >= 0 ? queue[current] : undefined;

  useEffect(() => {
    // Music pauses other apps' audio and plays with the ringer off. Background
    // playback comes with lock-screen controls (roadmap Phase 6).
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'doNotMix', shouldPlayInBackground: false }).catch(
      (error: unknown) => console.warn('Could not set the audio mode', error),
    );
  }, []);

  /** Loads `entries` into the playlist and starts at `index`; a long song resumes where it stopped. */
  const load = useCallback(
    async (entries: QueueEntry[], index: number, autoplay: boolean) => {
      const start = entries[index];
      const saved = start ? await loadPlaybackPosition(db, start.itemId).catch(() => null) : null;
      playlist.pause();
      playlist.clear();
      for (const e of entries) playlist.add(source(e));
      setQueue(entries);
      if (!start) return;
      if (index > 0) playlist.skipTo(index);
      const at = resumeSeconds(start.durationMs, saved);
      if (at > 0) await playlist.seekTo(at);
      if (autoplay) playlist.play();
      else playlist.pause();
    },
    [playlist, db],
  );

  const playQueue = useCallback(
    (entries: QueueEntry[], start: number, options?: { shuffle?: boolean }) => {
      const on = options?.shuffle ?? shuffle;
      ordered.current = entries;
      setShuffleState(on);
      void load(on ? shuffledFrom(entries, start) : entries, on ? 0 : start, true);
    },
    [load, shuffle],
  );

  /**
   * Puts `next` in the playlist around the song that's playing, at
   * `currentAt`, without stopping it: everything else is removed, then the new
   * songs before and after it are put in.
   */
  const rearrange = useCallback(
    (next: QueueEntry[], currentAt: number) => {
      for (let i = queue.length - 1; i >= 0; i--) if (i !== current) playlist.remove(i);
      next.slice(0, currentAt).forEach((e, i) => playlist.insert(source(e), i));
      for (const e of next.slice(currentAt + 1)) playlist.add(source(e));
      setQueue(next);
    },
    [playlist, queue.length, current],
  );

  const setShuffle = useCallback(
    (on: boolean) => {
      setShuffleState(on);
      if (!entry) return;
      if (on) rearrange(shuffledFrom(queue, current), 0);
      else {
        const back = ordered.current.filter((e) => queue.some((q) => q.itemId === e.itemId));
        rearrange(back, Math.max(0, back.findIndex((e) => e.itemId === entry.itemId)));
      }
    },
    [entry, queue, current, rearrange],
  );

  const setRepeat = useCallback(
    (mode: RepeatMode) => {
      setRepeatState(mode);
      applyRepeat(playlist, mode);
    },
    [playlist],
  );

  const removeAt = useCallback(
    (index: number) => {
      if (index < 0 || index >= queue.length) return;
      if (queue.length === 1) {
        playlist.pause();
        playlist.clear();
        setQueue([]);
        return;
      }
      playlist.remove(index);
      setQueue(queue.filter((_, i) => i !== index));
    },
    [playlist, queue],
  );

  const move = useCallback(
    (from: number, to: number) => {
      if (from === current || to < 0 || to >= queue.length || from === to) return;
      const next = [...queue];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      playlist.remove(from);
      playlist.insert(source(moved), to);
      setQueue(next);
    },
    [playlist, queue, current],
  );

  // Deleted songs leave the queue too.
  useEffect(() => {
    if (queue.length === 0) return;
    const exists = new Set(state.items.map((i) => i.id));
    const removed = new Set(queue.filter((e) => !exists.has(e.itemId)).map((e) => e.itemId));
    if (removed.size === 0) return;
    const after = withoutItems(queue, current, removed);
    ordered.current = ordered.current.filter((e) => !removed.has(e.itemId));
    const keepPlaying = status.playing && !removed.has(queue[current]?.itemId ?? '');
    // After this render, not during it: reloading the playlist updates the queue.
    void Promise.resolve().then(() => load(after.queue, Math.max(0, after.current), keepPlaying));
  }, [state.items, queue, current, load, status.playing]);

  // Bring back the last queue, paused. (The shelf has loaded: ShelfProvider renders nothing before.)
  const restoreStarted = useRef(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    (async () => {
      const saved = parseSavedQueue((await loadSettings(db))[SAVED_QUEUE_KEY]);
      if (!saved) return;
      const byId = new Map(state.items.map((i) => [i.id, i]));
      const items = saved.itemIds.flatMap((id) => byId.get(id) ?? []);
      const entries = queueEntries(items, await loadTracks(db));
      if (entries.length === 0) return;
      const index = Math.max(0, entries.findIndex((e) => e.itemId === saved.itemIds[saved.index]));
      ordered.current = entries;
      await load(entries, index, false);
    })()
      .catch((error: unknown) => console.warn('Could not restore the music queue', error))
      .finally(() => setReady(true));
  }, [db, state.items, load]);

  // Save the queue whenever it or the current song changes, once the saved one has been read.
  useEffect(() => {
    if (!ready) return;
    const value = JSON.stringify({ itemIds: queue.map((e) => e.itemId), index: Math.max(0, current) });
    saveSetting(db, SAVED_QUEUE_KEY, value).catch((error: unknown) => console.warn('Could not save the queue', error));
  }, [db, ready, queue, current]);

  // Count a play when a song starts, and save lengths the file didn't give (the screens show the player's own).
  const counted = useRef<string | null>(null);
  useEffect(() => {
    if (!entry || !status.playing || counted.current === `${entry.itemId}:${current}`) return;
    counted.current = `${entry.itemId}:${current}`;
    void countPlay(db, entry.itemId).catch(() => {});
  }, [db, entry, current, status.playing]);
  useEffect(() => {
    if (!entry || entry.durationMs !== null || !status.isLoaded || !(status.duration > 0)) return;
    void setTrackDuration(db, entry.itemId, status.duration * 1000).catch(() => {});
  }, [db, entry, status.isLoaded, status.duration]);

  // Save the position every few seconds while playing, and as soon as it pauses.
  const lastSave = useRef(0);
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (!entry || !status.isLoaded) return;
    const paused = wasPlaying.current && !status.playing;
    wasPlaying.current = status.playing;
    const now = Date.now();
    if (!paused && (!status.playing || now - lastSave.current < SAVE_EVERY)) return;
    lastSave.current = now;
    void savePlaybackPosition(db, entry.itemId, status.currentTime * 1000).catch(() => {});
  }, [db, entry, status.isLoaded, status.playing, status.currentTime]);

  const value = useMemo<PlayerContextValue>(
    () => ({
      queue,
      current,
      status,
      shuffle,
      repeat,
      playQueue,
      togglePlay: () => (status.playing ? playlist.pause() : playlist.play()),
      next: () => playlist.next(),
      // Like most players: past the first few seconds, "previous" goes back to the start of the song.
      previous: () => (status.currentTime > 3 || current <= 0 ? void playlist.seekTo(0) : playlist.previous()),
      skipTo: (index: number) => {
        playlist.skipTo(index);
        playlist.play();
      },
      seekTo: (seconds: number) => void playlist.seekTo(seconds),
      setShuffle,
      setRepeat,
      removeAt,
      move,
    }),
    [queue, current, status, shuffle, repeat, playQueue, playlist, setShuffle, setRepeat, removeAt, move],
  );
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerContextValue {
  const value = useContext(PlayerContext);
  if (!value) throw new Error('usePlayer must be used inside PlayerProvider');
  return value;
}
