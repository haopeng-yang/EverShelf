import type { Id, Item, VideoSummary } from './types';

// Watching progress rules, shared by the video shelf, the details screen and the player.

/** Stopping closer than this to the start or the end isn't worth resuming from. */
const RESUME_MARGIN_MS = 10_000;

/** Where to start playing a video stopped at `positionMs`: there, or the beginning if it was near either end. */
export function resumePosition(positionMs: number, durationMs: number | null): number {
  if (positionMs < RESUME_MARGIN_MS) return 0;
  if (durationMs !== null && positionMs > durationMs - RESUME_MARGIN_MS) return 0;
  return positionMs;
}

/** How far through the video, 0–1, for the bar under its cover. 0 when its length isn't known. */
export function watchedFraction(video: VideoSummary): number {
  if (video.finished) return 1;
  if (!video.durationMs || video.durationMs <= 0) return 0;
  return Math.min(1, Math.max(0, video.positionMs / video.durationMs));
}

/** Whether the video has a place worth resuming from. */
export function isInProgress(video: VideoSummary): boolean {
  return !video.finished && resumePosition(video.positionMs, video.durationMs) > 0;
}

/** Speeds the player offers, slowest first. */
export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** "1×", "1.25×" */
export function speedLabel(speed: number): string {
  return `${speed}×`;
}

/** What the player knows about a subtitle or audio track. */
export interface TrackLike {
  language: string;
  label: string;
}

/** The saved choice that means "no subtitles". */
export const TRACK_OFF = 'off';

/**
 * A track's key for remembering the choice. The player's track ids aren't
 * kept between loads, so the language and label stand for the track.
 */
export function trackKey(track: TrackLike): string {
  return `${track.language}|${track.label}`;
}

/** The track a saved choice means, if the file still has it. */
export function findTrack<T extends TrackLike>(tracks: T[], key: string | null): T | undefined {
  return key === null ? undefined : tracks.find((track) => trackKey(track) === key);
}

/**
 * The video to offer after `currentId` ends: the next one in the shelf's
 * order that has a file. Null at the end of the shelf.
 */
export function nextVideo(shelfItems: Item[], videoIds: ReadonlySet<Id>, currentId: Id): Item | null {
  const at = shelfItems.findIndex((item) => item.id === currentId);
  if (at === -1) return null;
  return shelfItems.slice(at + 1).find((item) => videoIds.has(item.id)) ?? null;
}

/** Videos started but not finished, most recently watched first. */
export function continueWatching(
  items: Item[],
  videos: ReadonlyMap<Id, VideoSummary>,
  max: number,
): { item: Item; video: VideoSummary }[] {
  return items
    .flatMap((item) => {
      const video = videos.get(item.id);
      return video && isInProgress(video) ? [{ item, video }] : [];
    })
    .sort((a, b) => (b.video.lastWatchedAt ?? 0) - (a.video.lastWatchedAt ?? 0))
    .slice(0, max);
}
