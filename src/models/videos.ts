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
