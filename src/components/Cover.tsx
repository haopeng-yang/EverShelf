import { useEffect, useState } from 'react';
import { Image, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useT } from '@/i18n/useT';
import { coverAspectRatio, fontSize, makeStyles, radius } from '@/theme';

/** In "whole" mode, shapes beyond these are letterboxed rather than made extremely tall or flat. */
const MIN_WHOLE_RATIO = 0.4;
const MAX_WHOLE_RATIO = 2.5;

interface CoverProps {
  uri: string | null;
  /** Used for the placeholder letter when there is no image. */
  title: string;
  style?: StyleProp<ViewStyle>;
  /**
   * "crop" (default) fills a 2:3 box, cutting off what doesn't fit, so grids line up.
   * "whole" shapes the box to the image itself, so nothing is cut off.
   */
  fit?: 'crop' | 'whole';
}

/** An item's cover, or a grey box with the title's first letter. */
export function Cover({ uri, title, style, fit = 'crop' }: CoverProps) {
  const styles = useStyles();
  const t = useT();
  const ratio = useImageRatio(fit === 'whole' ? uri : null);
  const aspectRatio = ratio ? Math.min(Math.max(ratio, MIN_WHOLE_RATIO), MAX_WHOLE_RATIO) : coverAspectRatio;
  return (
    <View style={[styles.frame, { aspectRatio }, style]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={styles.image}
          resizeMode={fit === 'whole' ? 'contain' : 'cover'}
          accessibilityLabel={t('common.coverOf', { title })}
        />
      ) : (
        <Text style={styles.letter}>{title.trim().charAt(0).toUpperCase()}</Text>
      )}
    </View>
  );
}

/** The image's width ÷ height once known, or null (also when no uri is given). */
function useImageRatio(uri: string | null): number | null {
  const [ratio, setRatio] = useState<{ uri: string; value: number } | null>(null);
  useEffect(() => {
    if (!uri) return;
    let live = true;
    Image.getSize(
      uri,
      (width, height) => {
        if (live && width > 0 && height > 0) setRatio({ uri, value: width / height });
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [uri]);
  return ratio && ratio.uri === uri ? ratio.value : null;
}

const useStyles = makeStyles((c) => ({
  frame: {
    backgroundColor: c.coverPlaceholder,
    borderRadius: radius.sm,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  letter: { fontSize: fontSize.heading * 1.5, color: c.coverLetter, fontWeight: '700' },
}));
