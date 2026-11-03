import { useEvent, useEventListener } from 'expo';
import { File } from 'expo-file-system';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView, type AudioTrack, type SubtitleTrack, type VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolutionLabel } from '@/books/video/readVideo';
import { Button } from '@/components/Button';
import { LockedScreen } from '@/components/LockedShelf';
import { NotFound } from '@/components/NotFound';
import { OptionSheet } from '@/components/OptionSheet';
import { useT } from '@/i18n/useT';
import { sortItems } from '@/models/query';
import { durationLabel } from '@/models/queue';
import { selectItemsOnShelf } from '@/models/shelfReducer';
import type { Id, Item, Video } from '@/models/types';
import {
  findTrack,
  nextVideo,
  PLAYBACK_SPEEDS,
  resumePosition,
  speedLabel,
  TRACK_OFF,
  trackKey,
  type TrackLike,
} from '@/models/videos';
import { usePlayer } from '@/state/PlayerProvider';
import { useSettings } from '@/state/SettingsProvider';
import { useShelfLocks } from '@/state/ShelfLockProvider';
import { useShelfState } from '@/state/ShelfProvider';
import { mediaUri } from '@/storage/bookFiles';
import {
  finishVideo,
  loadPlaybackPosition,
  loadVideo,
  loadVideoSummaries,
  saveTrackChoice,
  saveWatchPosition,
  setVideoDuration,
} from '@/storage/database';
import { fontSize, makeStyles, spacing } from '@/theme';

/** How often the position is saved while playing, in ms. */
const SAVE_EVERY = 5_000;
/** How far the skip buttons jump, in seconds. */
const SKIP_SECONDS = 10;
/** How long "Up next" waits before playing the next video, in seconds. */
const UP_NEXT_SECONDS = 5;

type Loaded =
  | { itemId: Id; video: Video; uri: string; startAt: number; videoIds: Set<Id> }
  | { itemId: Id; missing: true }
  | null;

/** Plays an imported video, starting where it was stopped last time. */
export default function WatchScreen() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const state = useShelfState();
  const db = useSQLiteContext();
  const { settings } = useSettings();
  const { isLocked } = useShelfLocks();
  const item = state.items.find((i) => i.id === itemId);
  const shelf = item && state.shelves.find((s) => s.id === item.shelfId);

  const [loaded, setLoaded] = useState<Loaded>(null);
  useEffect(() => {
    let current = true;
    Promise.all([loadVideo(db, itemId), loadPlaybackPosition(db, itemId), loadVideoSummaries(db)])
      .then(([video, position, videos]) => {
        if (!current) return;
        const uri = video ? mediaUri(itemId, video.fileName) : '';
        if (!video || !new File(uri).exists) return setLoaded({ itemId, missing: true });
        const startAt = resumePosition(position ?? 0, video.durationMs);
        setLoaded({ itemId, video, uri, startAt, videoIds: new Set(videos.keys()) });
      })
      .catch((error: unknown) => {
        console.warn('Could not load the video', error);
        if (current) setLoaded({ itemId, missing: true });
      });
    return () => {
      current = false;
    };
  }, [db, itemId]);

  // What plays after this one: the next video in the shelf's current order.
  const videoIds = loaded && 'video' in loaded ? loaded.videoIds : null;
  const next = useMemo(() => {
    if (!shelf || !videoIds) return null;
    return nextVideo(sortItems(selectItemsOnShelf(state, shelf.id), settings.sortOrder), videoIds, itemId);
  }, [state, shelf, videoIds, settings.sortOrder, itemId]);

  if (!item) return <NotFound what="item" />;
  if (shelf && isLocked(shelf)) return <LockedScreen shelf={shelf} />;
  // Until this video's own details are loaded (after Up next replaces the screen, the last one's are still here).
  if (loaded === null || loaded.itemId !== itemId) return <Message title={item.title} busy />;
  if ('missing' in loaded) return <Message title={item.title} textKey="watch.missing" />;
  return <Player key={itemId} item={item} video={loaded.video} uri={loaded.uri} startAt={loaded.startAt} next={next} />;
}

function Message({ title, busy, textKey }: { title: string; busy?: boolean; textKey?: 'watch.missing' }) {
  const styles = useStyles();
  const t = useT();
  return (
    <View style={[styles.container, styles.center]}>
      <Header title={title} />
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.message}>{textKey && t(textKey)}</Text>}
    </View>
  );
}

function Header({ title }: { title: string }) {
  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerStyle: { backgroundColor: '#000' },
          headerTintColor: '#fff',
          headerTitleStyle: { color: '#fff' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: '#000' },
        }}
      />
      <StatusBar style="light" />
    </>
  );
}

// The player's settings are changed here, outside the component, the way
// expo-video expects: a property set on the shared player object.
function setSpeed(player: VideoPlayer, speed: number) {
  player.playbackRate = speed;
}
function setSubtitles(player: VideoPlayer, track: SubtitleTrack | null) {
  player.subtitleTrack = track;
}
function setAudio(player: VideoPlayer, track: AudioTrack) {
  player.audioTrack = track;
}

/** A track's name for the picker: its label, else its language, else its number. */
function trackName(track: TrackLike, index: number, t: ReturnType<typeof useT>): string {
  return track.label || track.language || t('watch.trackN', { n: index + 1 });
}

interface PlayerProps {
  item: Item;
  video: Video;
  uri: string;
  /** Where to start, in ms. */
  startAt: number;
  /** What to offer when this video ends, or null at the end of the shelf. */
  next: Item | null;
}

function Player({ item, video, uri, startAt, next }: PlayerProps) {
  const styles = useStyles();
  const t = useT();
  const insets = useSafeAreaInsets();
  const db = useSQLiteContext();
  const music = usePlayer();
  const { settings } = useSettings();

  const player = useVideoPlayer({ uri, metadata: { title: item.title } }, (p) => {
    p.timeUpdateEventInterval = 1;
    p.play();
  });
  const { status, error } = useEvent(player, 'statusChange', { status: player.status });
  const { subtitleTrack } = useEvent(player, 'subtitleTrackChange', { subtitleTrack: player.subtitleTrack });
  const { audioTrack } = useEvent(player, 'audioTrackChange', { audioTrack: player.audioTrack });
  const { playbackRate } = useEvent(player, 'playbackRateChange', { playbackRate: player.playbackRate });

  // Video and music never play together: starting a video pauses the songs.
  const pauseMusic = useEffectEvent(() => {
    if (music.status.playing) music.togglePlay();
  });
  useEffect(() => pauseMusic(), []);

  // Jump to the saved place once the video has loaded (seeking before that isn't reliable on iOS).
  const seeked = useRef(startAt === 0);
  useEffect(() => {
    if (status !== 'readyToPlay' || seeked.current) return;
    seeked.current = true;
    player.seekBy(startAt / 1000 - player.currentTime);
  }, [status, player, startAt]);

  // Saving: the latest position is kept in a ref, since the player is released before this screen's cleanup runs.
  const position = useRef(startAt);
  const lastSave = useRef(0);
  const finished = useRef(false);
  const durationMs = useRef(video.durationMs);
  const [lengthMs, setLengthMs] = useState(video.durationMs);
  const save = useCallback(() => {
    if (finished.current || !seeked.current) return;
    lastSave.current = Date.now();
    saveWatchPosition(db, item.id, position.current).catch((e: unknown) => console.warn('Could not save the position', e));
  }, [db, item.id]);

  // "Up next" after the end: counting down when autoplay is on (seconds), or waiting for a tap (null).
  const [upNext, setUpNext] = useState<{ seconds: number | null } | null>(null);
  const playNext = useCallback(() => {
    if (next) router.replace({ pathname: '/watch/[itemId]', params: { itemId: next.id } });
  }, [next]);
  useEffect(() => {
    if (upNext?.seconds == null) return;
    if (upNext.seconds <= 0) {
      playNext();
      return;
    }
    const timer = setTimeout(() => setUpNext({ seconds: upNext.seconds! - 1 }), 1000);
    return () => clearTimeout(timer);
  }, [upNext, playNext]);

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    position.current = currentTime * 1000;
    // Watching again after the end makes it a normal, unfinished video again.
    if (finished.current && resumePosition(position.current, durationMs.current) > 0) finished.current = false;
    if (player.playing && Date.now() - lastSave.current >= SAVE_EVERY) save();
  });
  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    if (!isPlaying) save();
    // Playing again (e.g. Start over) cancels Up next.
    else setUpNext(null);
  });
  useEventListener(player, 'playToEnd', () => {
    finished.current = true;
    position.current = 0;
    finishVideo(db, item.id).catch((e: unknown) => console.warn('Could not mark the video watched', e));
    if (next) setUpNext({ seconds: settings.autoplayNextVideo ? UP_NEXT_SECONDS : null });
  });

  // The file's own subtitle and audio tracks, with the ones picked last time put back.
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  useEventListener(player, 'sourceLoad', (loaded) => {
    // Matroska files may not say how long they are; the player knows once it has loaded.
    if (video.durationMs === null && loaded.duration > 0) {
      durationMs.current = loaded.duration * 1000;
      setLengthMs(durationMs.current);
      setVideoDuration(db, item.id, durationMs.current).catch((e: unknown) => console.warn('Could not save the length', e));
    }
    setSubtitleTracks(loaded.availableSubtitleTracks);
    setAudioTracks(loaded.availableAudioTracks);
    if (video.subtitleChoice === TRACK_OFF) setSubtitles(player, null);
    else {
      const subtitles = findTrack(loaded.availableSubtitleTracks, video.subtitleChoice);
      if (subtitles) setSubtitles(player, subtitles);
    }
    const audio = findTrack(loaded.availableAudioTracks, video.audioChoice);
    if (audio) setAudio(player, audio);
  });
  useEffect(() => () => save(), [save]);

  const [sheet, setSheet] = useState<'speed' | 'subtitles' | 'audio' | null>(null);
  const pickSubtitles = (key: string) => {
    setSubtitles(player, key === TRACK_OFF ? null : (findTrack(subtitleTracks, key) ?? null));
    saveTrackChoice(db, item.id, 'subtitle', key).catch((e: unknown) => console.warn('Could not save subtitles', e));
  };
  const pickAudio = (key: string) => {
    const track = findTrack(audioTracks, key);
    if (!track) return;
    setAudio(player, track);
    saveTrackChoice(db, item.id, 'audio', key).catch((e: unknown) => console.warn('Could not save the audio track', e));
  };

  const details = [lengthMs !== null ? durationLabel(lengthMs) : '', resolutionLabel(video.width, video.height)].filter(Boolean);
  const playing = status !== 'error';

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <Header title={item.title} />
      <View style={styles.stage}>
        {status === 'error' ? (
          <Text style={styles.message} accessibilityLiveRegion="polite">
            {t('watch.cantPlay')}
            {error?.message ? `\n\n${error.message}` : ''}
          </Text>
        ) : (
          <>
            <VideoView
              player={player}
              style={styles.video}
              nativeControls
              contentFit="contain"
              fullscreenOptions={{ enable: true, orientation: 'landscape' }}
            />
            {status === 'loading' && <ActivityIndicator color="#fff" style={styles.spinner} />}
          </>
        )}
      </View>

      {upNext && next && (
        <View style={styles.upNext} accessibilityLiveRegion="polite">
          <View style={styles.upNextText}>
            <Text style={styles.details}>{t('watch.upNext')}</Text>
            <Text style={styles.title} numberOfLines={1}>
              {next.title}
            </Text>
            {upNext.seconds !== null && <Text style={styles.details}>{t('watch.playingIn', { seconds: upNext.seconds })}</Text>}
          </View>
          <Button title={t('common.cancel')} compact onPress={() => setUpNext(null)} />
          <Button title={t('watch.playNow')} variant="primary" compact onPress={playNext} />
        </View>
      )}

      {playing && (
        <View style={styles.controls}>
          <Button
            title={`⟲ ${SKIP_SECONDS}`}
            compact
            accessibilityLabel={t('watch.back10')}
            onPress={() => player.seekBy(-SKIP_SECONDS)}
            style={styles.control}
          />
          <Button
            title={speedLabel(playbackRate)}
            compact
            accessibilityLabel={t('watch.speedButton', { speed: speedLabel(playbackRate) })}
            onPress={() => setSheet('speed')}
            style={styles.control}
          />
          <Button
            title={`${SKIP_SECONDS} ⟳`}
            compact
            accessibilityLabel={t('watch.forward10')}
            onPress={() => player.seekBy(SKIP_SECONDS)}
            style={styles.control}
          />
          {subtitleTracks.length > 0 && (
            <Button
              title="CC"
              compact
              variant={subtitleTrack ? 'primary' : 'secondary'}
              accessibilityLabel={t('watch.subtitles')}
              onPress={() => setSheet('subtitles')}
              style={styles.control}
            />
          )}
          {audioTracks.length > 1 && (
            <Button
              title="♪"
              compact
              accessibilityLabel={t('watch.audio')}
              onPress={() => setSheet('audio')}
              style={styles.control}
            />
          )}
        </View>
      )}

      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        {details.length > 0 && <Text style={styles.details}>{details.join(' · ')}</Text>}
        {startAt > 0 && playing && (
          <View style={styles.resumeRow}>
            <Text style={styles.details}>{t('watch.resumedAt', { time: durationLabel(startAt) })}</Text>
            <Button title={t('watch.startOver')} compact onPress={() => player.replay()} />
          </View>
        )}
      </View>

      <OptionSheet
        visible={sheet === 'speed'}
        title={t('watch.speed')}
        options={PLAYBACK_SPEEDS.map((speed) => ({ value: String(speed), label: speedLabel(speed) }))}
        selected={String(playbackRate)}
        onSelect={(value) => setSpeed(player, Number(value))}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === 'subtitles'}
        title={t('watch.subtitles')}
        options={[
          { value: TRACK_OFF, label: t('watch.subtitlesOff') },
          ...subtitleTracks.map((track, i) => ({ value: trackKey(track), label: trackName(track, i, t) })),
        ]}
        selected={subtitleTrack ? trackKey(subtitleTrack) : TRACK_OFF}
        onSelect={pickSubtitles}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === 'audio'}
        title={t('watch.audio')}
        options={audioTracks.map((track, i) => ({ value: trackKey(track), label: trackName(track, i, t) }))}
        selected={audioTrack ? trackKey(audioTrack) : ''}
        onSelect={pickAudio}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}

// The player is always dark, whatever the app theme, like other video players.
const useStyles = makeStyles(() => ({
  container: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  stage: { flex: 1, justifyContent: 'center' },
  video: { width: '100%', height: '100%' },
  spinner: { position: 'absolute', alignSelf: 'center' },
  message: { color: '#fff', fontSize: fontSize.body, textAlign: 'center', padding: spacing.xl },
  upNext: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 8,
    backgroundColor: '#1c1c1e',
  },
  upNextText: { flex: 1, minWidth: 0 },
  controls: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  control: { flex: 1, paddingHorizontal: spacing.xs },
  info: { padding: spacing.lg, gap: spacing.xs },
  title: { color: '#fff', fontSize: fontSize.body + 1, fontWeight: '600' },
  details: { color: '#bbb', fontSize: fontSize.small, fontVariant: ['tabular-nums'] },
  resumeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
}));
