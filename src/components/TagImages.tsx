import { useState } from 'react';
import { FlatList, Image, Modal, Pressable, StatusBar, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n/useT';
import { fontSize, makeStyles, radius, spacing } from '@/theme';

const THUMBNAIL_SIZE = 88;

interface TagImagesProps {
  images: string[];
  /** The tag's name, for screen readers and the viewer's title. */
  name: string;
  /** When set, each thumbnail gets a ✕ that removes it (used while editing). */
  onRemove?: (index: number) => void;
}

/** A tag's images as a row of thumbnails. Tapping one opens it full screen, where the rest can be swiped through. */
export function TagImages({ images, name, onRemove }: TagImagesProps) {
  const styles = useStyles();
  const t = useT();
  const [openAt, setOpenAt] = useState<number | null>(null);
  if (images.length === 0) return null;

  return (
    <View style={styles.row}>
      {images.map((uri, index) => (
        <View key={`${uri}-${index}`}>
          <Pressable
            onPress={() => setOpenAt(index)}
            accessibilityRole="imagebutton"
            accessibilityLabel={t('tagImages.open', { name, n: index + 1, count: images.length })}
          >
            <Image source={{ uri }} style={styles.thumbnail} resizeMode="cover" />
          </Pressable>
          {onRemove && (
            <Pressable
              onPress={() => onRemove(index)}
              style={styles.remove}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('tagImages.remove', { name, n: index + 1 })}
            >
              <Text style={styles.removeText}>✕</Text>
            </Pressable>
          )}
        </View>
      ))}
      {openAt !== null && <ImageViewer images={images} name={name} start={openAt} onClose={() => setOpenAt(null)} />}
    </View>
  );
}

/** Full-screen images on black, swiped left and right. Tap ✕ or go back to close. */
function ImageViewer({ images, name, start, onClose }: { images: string[]; name: string; start: number; onClose: () => void }) {
  const styles = useStyles();
  const t = useT();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(start);

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <StatusBar barStyle="light-content" />
      <View style={styles.viewer}>
        <FlatList
          data={images}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={start}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(uri, i) => `${uri}-${i}`}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item }) => (
            <Image source={{ uri: item }} style={{ width, height }} resizeMode="contain" accessibilityLabel={name} />
          )}
        />
        <View style={[styles.viewerBar, { paddingTop: insets.top + spacing.sm }]}>
          <Text style={styles.viewerTitle} numberOfLines={1}>
            {images.length > 1 ? `${name} · ${index + 1}/${images.length}` : name}
          </Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.close')}>
            <Text style={styles.viewerClose}>✕</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumbnail: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    borderRadius: radius.sm,
    backgroundColor: c.coverPlaceholder,
  },
  remove: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { color: '#FFFFFF', fontSize: fontSize.small, fontWeight: '700' },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  viewerTitle: { flex: 1, color: '#FFFFFF', fontSize: fontSize.body, fontWeight: '600' },
  viewerClose: { color: '#FFFFFF', fontSize: fontSize.heading, fontWeight: '700' },
}));
