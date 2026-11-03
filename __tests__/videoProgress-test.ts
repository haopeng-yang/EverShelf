import type { Item, VideoSummary } from '../src/models/types';
import {
  continueWatching,
  findTrack,
  isInProgress,
  nextVideo,
  resumePosition,
  speedLabel,
  trackKey,
  watchedFraction,
} from '../src/models/videos';

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

describe('next video and track choices', () => {
  it('offers the next video in shelf order, skipping manual entries', () => {
    const items = ['e1', 'wish', 'e2', 'e3'].map(item);
    const videos = new Set(['e1', 'e2', 'e3']);
    expect(nextVideo(items, videos, 'e1')?.id).toBe('e2');
    expect(nextVideo(items, videos, 'e3')).toBeNull();
    expect(nextVideo(items, videos, 'gone')).toBeNull();
  });

  it('finds a remembered track by language and label', () => {
    const tracks = [
      { id: '1', language: 'en', label: 'English' },
      { id: '2', language: 'zh', label: '中文' },
    ];
    expect(findTrack(tracks, trackKey({ language: 'zh', label: '中文' }))?.id).toBe('2');
    expect(findTrack(tracks, 'fr|Français')).toBeUndefined();
    expect(findTrack(tracks, null)).toBeUndefined();
    expect(speedLabel(1.25)).toBe('1.25×');
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
