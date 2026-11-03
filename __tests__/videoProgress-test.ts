import type { Item, VideoSummary } from '../src/models/types';
import { continueWatching, isInProgress, resumePosition, watchedFraction } from '../src/models/videos';

const summary = (itemId: string, over: Partial<VideoSummary> = {}): VideoSummary => ({
  itemId,
  durationMs: 600_000,
  width: 1920,
  height: 1080,
  positionMs: 0,
  lastWatchedAt: null,
  finished: false,
  ...over,
});
const item = (id: string): Item => ({ id, shelfId: 'videos', title: id, coverUri: null, tags: [], createdAt: 0, updatedAt: 0 });

describe('resumePosition', () => {
  it('resumes from where the video was stopped', () => {
    expect(resumePosition(125_000, 600_000)).toBe(125_000);
    expect(resumePosition(125_000, null)).toBe(125_000);
  });

  it('starts from the beginning when stopped near the start or the end', () => {
    expect(resumePosition(4_000, 600_000)).toBe(0);
    expect(resumePosition(595_000, 600_000)).toBe(0);
  });
});

describe('watching progress', () => {
  it('shows how far through a video is, and full once watched', () => {
    expect(watchedFraction(summary('a', { positionMs: 150_000 }))).toBe(0.25);
    expect(watchedFraction(summary('a', { finished: true }))).toBe(1);
    expect(watchedFraction(summary('a', { durationMs: null, positionMs: 150_000 }))).toBe(0);
    expect(watchedFraction(summary('a', { positionMs: 900_000 }))).toBe(1);
  });

  it('lists started, unfinished videos, most recently watched first', () => {
    const videos = new Map([
      ['old', summary('old', { positionMs: 60_000, lastWatchedAt: 1 })],
      ['new', summary('new', { positionMs: 60_000, lastWatchedAt: 5 })],
      ['done', summary('done', { finished: true, lastWatchedAt: 9 })],
      ['barely', summary('barely', { positionMs: 3_000, lastWatchedAt: 8 })],
      ['never', summary('never')],
    ]);
    const items = ['old', 'new', 'done', 'barely', 'never', 'manual'].map(item);
    expect(continueWatching(items, videos, 10).map((v) => v.item.id)).toEqual(['new', 'old']);
    expect(continueWatching(items, videos, 1).map((v) => v.item.id)).toEqual(['new']);
    expect(isInProgress(videos.get('barely')!)).toBe(false);
  });
});
