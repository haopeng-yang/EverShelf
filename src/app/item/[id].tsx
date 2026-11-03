import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';

import { percentLabel } from '@/books/progress';
import { resolutionLabel } from '@/books/video/readVideo';
import { Button } from '@/components/Button';
import { Cover } from '@/components/Cover';
import { LockedScreen } from '@/components/LockedShelf';
import { NotFound } from '@/components/NotFound';
import { useT } from '@/i18n/useT';
import { durationLabel } from '@/models/queue';
import type { VideoSummary } from '@/models/types';
import { resumePosition } from '@/models/videos';
import { useShelfLocks } from '@/state/ShelfLockProvider';
import { useShelfState } from '@/state/ShelfProvider';
import { loadChapters, loadProgress, loadVideoSummaries, setVideoFinished } from '@/storage/database';
import { fontSize, makeStyles, spacing } from '@/theme';

/** Wider than this, the cover sits beside the details (as in the sketch); narrower, above them. */
const SIDE_BY_SIDE_MIN_WIDTH = 600;

export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useShelfState();
  const styles = useStyles();
  const t = useT();
  const { width } = useWindowDimensions();
  const db = useSQLiteContext();
  const [book, setBook] = useState<{
    chapterCount: number;
    continueAt: string | null;
    /** "42% read" or "Finished"; null if never opened. */
    status: string | null;
  }>({ chapterCount: 0, continueAt: null, status: null });
  const [video, setVideo] = useState<VideoSummary | null>(null);
  // Reload whenever the screen comes back into view, e.g. after reading or watching.
  useFocusEffect(
    useCallback(() => {
      let current = true;
      Promise.all([loadChapters(db, id), loadProgress(db, id), loadVideoSummaries(db)])
        .then(([chapters, progress, videos]) => {
          if (!current) return;
          setVideo(videos.get(id) ?? null);
          const at = progress && chapters.find((c) => c.id === progress.chapterId);
          const status = !progress
            ? null
            : progress.finishedAt !== null
              ? t('book.finished')
              : t('book.percentRead', { percent: percentLabel(progress.percent) });
          setBook({ chapterCount: chapters.length, continueAt: at ? at.title : null, status });
        })
        .catch((error: unknown) => console.warn('Could not load chapters', error));
      return () => {
        current = false;
      };
    }, [db, id, t]),
  );
  const { isLocked } = useShelfLocks();
  const item = state.items.find((i) => i.id === id);
  if (!item) return <NotFound what="item" />;
  const itemShelf = state.shelves.find((s) => s.id === item.shelfId);
  if (itemShelf && isLocked(itemShelf)) return <LockedScreen shelf={itemShelf} />;

  const shelf = state.shelves.find((s) => s.id === item.shelfId);
  const sideBySide = width >= SIDE_BY_SIDE_MIN_WIDTH;
  const resumeAt = video ? resumePosition(video.positionMs, video.durationMs) : 0;

  async function toggleWatched() {
    if (!video) return;
    const finished = !video.finished;
    try {
      await setVideoFinished(db, video.itemId, finished);
      // Marking it watched moves it back to the start, as finishing it does.
      setVideo({ ...video, finished, positionMs: finished ? 0 : video.positionMs });
    } catch (error) {
      console.warn('Could not mark the video', error);
    }
  }
  const videoDetails = video
    ? [
        video.durationMs !== null ? durationLabel(video.durationMs) : '',
        resolutionLabel(video.width, video.height),
        video.finished ? t('video.watched') : '',
      ].filter(Boolean)
    : [];

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: shelf?.name ?? t('item.fallbackTitle') }} />

      <View style={sideBySide ? styles.row : styles.column}>
        <Cover
          uri={item.coverUri}
          title={item.title}
          style={sideBySide ? styles.coverSide : [styles.coverTop, { width: Math.min(width * 0.6, 260) }]}
        />
        <View style={[styles.fields, sideBySide && styles.fieldsSide]}>
          <Field name={t('tag.title')} value={item.title} />
          {item.tags.map((tag) => (
            <Field key={tag.id} name={tag.name} value={tag.value} />
          ))}
          {book.chapterCount > 0 && (
            <Text style={styles.chapters}>
              {[t('item.chapters', { count: book.chapterCount }), book.status].filter(Boolean).join(' · ')}
            </Text>
          )}
          {videoDetails.length > 0 && <Text style={styles.chapters}>{videoDetails.join(' · ')}</Text>}
          {video && (
            <Button
              title={video.finished ? t('item.markUnwatched') : t('item.markWatched')}
              variant="text"
              compact
              style={styles.alignStart}
              onPress={() => void toggleWatched()}
            />
          )}
        </View>
      </View>

      <View style={styles.footer}>
        {video && (
          <View style={styles.readButton}>
            <Button
              title={resumeAt > 0 ? t('item.resume') : t('item.play')}
              variant="primary"
              onPress={() => router.push({ pathname: '/watch/[itemId]', params: { itemId: item.id } })}
            />
            {resumeAt > 0 && (
              <Text style={styles.chapters} numberOfLines={1}>
                {t('item.resumeAt', { time: durationLabel(resumeAt) })}
              </Text>
            )}
          </View>
        )}
        {book.chapterCount > 0 && (
          <View style={styles.readButton}>
            <Button
              title={book.continueAt ? t('item.continueReading') : t('item.read')}
              variant="primary"
              onPress={() => router.push({ pathname: '/read/[itemId]', params: { itemId: item.id } })}
            />
            {book.continueAt && (
              <Text style={styles.chapters} numberOfLines={1}>
                {book.continueAt}
              </Text>
            )}
          </View>
        )}
        <Button
          title={t('common.edit')}
          variant="primary"
          onPress={() => router.push({ pathname: '/item/edit', params: { id: item.id } })}
        />
      </View>
    </ScrollView>
  );
}

function Field({ name, value }: { name: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.field}>
      <Text style={styles.fieldName}>{name}:</Text>
      <Text style={[styles.fieldValue, !value && styles.fieldEmpty]} selectable>
        {value || '—'}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  content: { padding: spacing.xl, gap: spacing.xl },
  row: { flexDirection: 'row', gap: spacing.xl, alignItems: 'flex-start' },
  column: { gap: spacing.xl },
  coverSide: { width: 200 },
  coverTop: { alignSelf: 'center' },
  alignStart: { alignSelf: 'flex-start' },
  fields: { gap: spacing.lg },
  fieldsSide: { flex: 1 },
  field: { gap: spacing.xs },
  fieldName: { fontSize: fontSize.small, color: c.textMuted, fontWeight: '600' },
  fieldValue: { fontSize: fontSize.body, color: c.text, lineHeight: 22 },
  fieldEmpty: { color: c.textMuted },
  chapters: { fontSize: fontSize.small, color: c.textMuted },
  footer: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'flex-end', gap: spacing.md },
  readButton: { flex: 1, gap: spacing.xs },
}));
