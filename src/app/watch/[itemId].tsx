import { useEvent, useEventListener } from 'expo';
import { File } from 'expo-file-system';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolutionLabel } from '@/books/video/readVideo';
import { Button } from '@/components/Button';
import { LockedScreen } from '@/components/LockedShelf';
import { NotFound } from '@/components/NotFound';
import { useT } from '@/i18n/useT';
import { durationLabel } from '@/models/queue';
import type { Item, Video } from '@/models/types';
import { resumePosition } from '@/models/videos';
import { usePlayer } from '@/state/PlayerProvider';
import { useShelfLocks } from '@/state/ShelfLockProvider';
import { useShelfState } from '@/state/ShelfProvider';
import { mediaUri } from '@/storage/bookFiles';
import { finishVideo, loadPlaybackPosition, loadVideo, saveWatchPosition, setVideoDuration } from '@/storage/database';
import { fontSize, makeStyles, spacing } from '@/theme';

/** How often the position is saved while playing, in ms. */
const SAVE_EVERY = 5_000;

type Loaded = { video: Video; uri: string; startAt: number } | 'missing' | null;

/** Plays an imported video, starting where it was stopped last time. */
export default function WatchScreen() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const state = useShelfState();
  const db = useSQLiteContext();
  const { isLocked } = useShelfLocks();
  const item = state.items.find((i) => i.id === itemId);
  const shelf = item && state.shelves.find((s) => s.id === item.shelfId);

  const [loaded, setLoaded] = useState<Loaded>(null);
  useEffect(() => {
    let current = true;
    Promise.all([loadVideo(db, itemId), loadPlaybackPosition(db, itemId)])
      .then(([video, position]) => {
        if (!current) return;
        if (!video) return setLoaded('missing');
        const uri = mediaUri(itemId, video.fileName);
        if (!new File(uri).exists) return setLoaded('missing');
        setLoaded({ video, uri, startAt: resumePosition(position ?? 0, video.durationMs) });
      })
      .catch((error: unknown) => {
        console.warn('Could not load the video', error);
        if (current) setLoaded('missing');
      });
    return () => {
      current = false;
    };
  }, [db, itemId]);

  if (!item) return <NotFound what="item" />;
  if (shelf && isLocked(shelf)) return <LockedScreen shelf={shelf} />;
  if (loaded === null) return <Message title={item.title} busy />;
  if (loaded === 'missing') return <Message title={item.title} textKey="watch.missing" />;
  return <Player item={item} {...loaded} />;
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

interface PlayerProps {
  item: Item;
  video: Video;
  uri: string;
  /** Where to start, in ms. */
  startAt: number;
}

function Player({ item, video, uri, startAt }: PlayerProps) {
  const styles = useStyles();
  const t = useT();
  const insets = useSafeAreaInsets();
  const db = useSQLiteContext();
  const music = usePlayer();

  const player = useVideoPlayer({ uri, metadata: { title: item.title } }, (p) => {
    p.timeUpdateEventInterval = 1;
    p.play();
  });
  const { status, error } = useEvent(player, 'statusChange', { status: player.status });

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

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    position.current = currentTime * 1000;
    // Watching again after the end makes it a normal, unfinished video again.
    if (finished.current && resumePosition(position.current, durationMs.current) > 0) finished.current = false;
    if (player.playing && Date.now() - lastSave.current >= SAVE_EVERY) save();
  });
  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    if (!isPlaying) save();
  });
  useEventListener(player, 'playToEnd', () => {
    finished.current = true;
    position.current = 0;
    finishVideo(db, item.id).catch((e: unknown) => console.warn('Could not mark the video watched', e));
  });
  useEventListener(player, 'sourceLoad', ({ duration }) => {
    // Matroska files don't say how long they are; the player knows once it has loaded.
    if (video.durationMs === null && duration > 0) {
      durationMs.current = duration * 1000;
      setLengthMs(durationMs.current);
      setVideoDuration(db, item.id, durationMs.current).catch((e: unknown) => console.warn('Could not save the length', e));
    }
  });
  useEffect(() => () => save(), [save]);

  const details = [
    lengthMs !== null ? durationLabel(lengthMs) : '',
    resolutionLabel(video.width, video.height),
  ].filter(Boolean);

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
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        {details.length > 0 && <Text style={styles.details}>{details.join(' · ')}</Text>}
        {startAt > 0 && status !== 'error' && (
          <View style={styles.resumeRow}>
            <Text style={styles.details}>{t('watch.resumedAt', { time: durationLabel(startAt) })}</Text>
            <Button
              title={t('watch.startOver')}
              compact
              onPress={() => player.replay()}
            />
          </View>
        )}
      </View>
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
  info: { padding: spacing.lg, gap: spacing.xs },
  title: { color: '#fff', fontSize: fontSize.body + 1, fontWeight: '600' },
  details: { color: '#bbb', fontSize: fontSize.small, fontVariant: ['tabular-nums'] },
  resumeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
}));
