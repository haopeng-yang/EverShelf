import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';

import { saveCover } from '../../storage/covers';

// Takes a frame from an imported video to use as its cover, and finds out its
// length when the file didn't say. The player is only loaded, never played.

/** How long to wait for the phone to open the video before giving up on a cover. */
const LOAD_TIMEOUT = 15_000;
/** Covers are at most this wide; the shelf never shows them bigger. */
const COVER_WIDTH = 640;

/** Resolves true once the player has loaded the video, false if it can't or takes too long. */
function whenLoaded(player: VideoPlayer): Promise<boolean> {
  if (player.status === 'readyToPlay') return Promise.resolve(true);
  return new Promise((resolve) => {
    const subscription = player.addListener('statusChange', ({ status }) => {
      if (status !== 'readyToPlay' && status !== 'error') return;
      clearTimeout(timer);
      subscription.remove();
      resolve(status === 'readyToPlay');
    });
    const timer = setTimeout(() => {
      subscription.remove();
      resolve(false);
    }, LOAD_TIMEOUT);
  });
}

/** Where to take the cover from: a tenth of the way in (past opening black frames), but no later than 30 s. */
export function coverTime(durationMs: number | null): number {
  if (!durationMs || durationMs <= 0) return 1;
  return Math.min(30, durationMs / 1000 / 10);
}

/**
 * Saves a frame of the video at `uri` as a cover, and returns its URI with
 * the length the player found. Either is null if the phone can't open the
 * video; the import goes on without them.
 */
export async function videoCoverAndLength(
  uri: string,
  knownDurationMs: number | null,
): Promise<{ coverUri: string | null; durationMs: number | null }> {
  const player = createVideoPlayer(null);
  player.muted = true;
  try {
    await player.replaceAsync({ uri });
    if (!(await whenLoaded(player))) return { coverUri: null, durationMs: null };
    const durationMs = player.duration > 0 ? Math.round(player.duration * 1000) : null;
    const [thumbnail] = await player.generateThumbnailsAsync(coverTime(knownDurationMs ?? durationMs), {
      maxWidth: COVER_WIDTH,
    });
    if (!thumbnail) return { coverUri: null, durationMs };
    const image = await ImageManipulator.manipulate(thumbnail).renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
    // saveAsync writes to the cache, which the system may clear; covers live in the documents folder.
    const coverUri = await saveCover(saved.uri);
    try {
      new File(saved.uri).delete();
    } catch (error) {
      console.warn('Could not delete a thumbnail copy', saved.uri, error);
    }
    return { coverUri, durationMs };
  } catch (error) {
    console.warn('Could not make a video cover', uri, error);
    return { coverUri: null, durationMs: null };
  } finally {
    player.release();
  }
}
