import { Pressable, Text, View } from 'react-native';

import { useT } from '@/i18n/useT';
import { durationLabel } from '@/models/queue';
import type { Item, VideoSummary } from '@/models/types';
import { watchedFraction } from '@/models/videos';
import { fontSize, makeStyles, radius, raisedShadow, spacing } from '@/theme';

import { Cover } from '../Cover';
import { MisplacedMark } from '../MisplacedMark';
import { SelectionMark } from '../SelectionMark';

export const VIDEO_ASPECT_RATIO = 16 / 9;

interface VideoThumbProps {
  item: Item;
  video?: VideoSummary;
  selected?: boolean;
  misplaced?: boolean;
  /** Small thumbnails (list rows) leave the length to the text beside them. */
  showLength?: boolean;
}

/** A 16:9 frame with the video's length, a ✓ once watched, and a bar showing how far it has been watched. */
export function VideoThumb({ item, video, selected, misplaced, showLength = true }: VideoThumbProps) {
  const styles = useStyles();
  const fraction = video ? watchedFraction(video) : 0;
  return (
    <View>
      <Cover uri={item.coverUri} title={item.title} style={styles.frame} />
      {showLength && video?.durationMs != null && (
        <Text style={[styles.badge, styles.length]}>{durationLabel(video.durationMs)}</Text>
      )}
      {video?.finished && <Text style={[styles.badge, styles.watched]}>✓</Text>}
      {fraction > 0 && !video?.finished && (
        <View style={styles.track}>
          <View style={[styles.bar, { width: `${fraction * 100}%` }]} />
        </View>
      )}
      {misplaced && <MisplacedMark />}
      {selected !== undefined && <SelectionMark selected={selected} />}
    </View>
  );
}

interface VideoCardProps extends VideoThumbProps {
  width: number;
  onPress: () => void;
  onLongPress?: () => void;
  /** Grid cards stack the title under the frame; list rows put it beside a small one. */
  row?: boolean;
}

/** One video on the shelf: its frame and title, in a grid or as a list row. */
export function VideoCard({ item, video, selected, misplaced, width, row, onPress, onLongPress }: VideoCardProps) {
  const styles = useStyles();
  const t = useT();
  const length = video?.durationMs != null ? durationLabel(video.durationMs) : '';
  const left =
    video && !video.finished && video.durationMs && video.positionMs > 0
      ? t('video.left', { time: durationLabel(video.durationMs - video.positionMs) })
      : '';
  const status = video?.finished ? t('video.watched') : left;
  const meta = (row ? [length, status] : [status]).filter(Boolean).join(' · ');
  return (
    <Pressable
      accessibilityRole={selected === undefined ? 'button' : 'checkbox'}
      accessibilityState={selected === undefined ? undefined : { checked: selected }}
      accessibilityLabel={[length ? t('video.label', { title: item.title, length }) : item.title, status].filter(Boolean).join(', ')}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [row ? styles.row : [styles.card, { width }], pressed && styles.pressed]}>
      <View style={row ? styles.rowThumb : undefined}>
        <VideoThumb item={item} video={video} selected={selected} misplaced={misplaced} showLength={!row} />
      </View>
      <View style={row ? styles.rowText : undefined}>
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        {meta !== '' && (
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((c, look) => ({
  frame: { aspectRatio: VIDEO_ASPECT_RATIO },
  // The raised look puts each video on a white card, like the other shelves.
  card: look.raised
    ? { padding: spacing.xs, paddingBottom: spacing.sm, borderRadius: radius.md, backgroundColor: c.card, ...raisedShadow(c, look) }
    : {},
  badge: {
    position: 'absolute',
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.7)',
    color: '#fff',
    fontSize: fontSize.small - 1,
    fontVariant: ['tabular-nums'],
  },
  length: { right: spacing.xs, bottom: spacing.xs + 3 },
  watched: { left: spacing.xs, bottom: spacing.xs + 3, fontWeight: '700' },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  bar: { height: 3, backgroundColor: c.primary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    ...(look.raised && { padding: spacing.sm, borderRadius: radius.lg, backgroundColor: c.card, ...raisedShadow(c, look) }),
  },
  rowThumb: { width: 128 },
  rowText: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  title: { marginTop: spacing.xs, fontSize: fontSize.small, color: c.text, fontWeight: '500' },
  meta: { fontSize: fontSize.small, color: c.textMuted, fontVariant: ['tabular-nums'] },
}));
