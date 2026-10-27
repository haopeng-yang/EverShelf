import { Image, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { coverAspectRatio, fontSize, makeStyles, radius } from '@/theme';

interface CoverProps {
  uri: string | null;
  /** Used for the placeholder letter when there is no image. */
  title: string;
  style?: StyleProp<ViewStyle>;
}

/** An item's cover at a 2:3 ratio, or a grey box with the title's first letter. */
export function Cover({ uri, title, style }: CoverProps) {
  const styles = useStyles();
  return (
    <View style={[styles.frame, style]}>
      {uri ? (
        <Image source={{ uri }} style={styles.image} resizeMode="cover" accessibilityLabel={`Cover of ${title}`} />
      ) : (
        <Text style={styles.letter}>{title.trim().charAt(0).toUpperCase()}</Text>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  frame: {
    aspectRatio: coverAspectRatio,
    backgroundColor: c.coverPlaceholder,
    borderRadius: radius.sm,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  letter: { fontSize: fontSize.heading * 1.5, color: c.coverLetter, fontWeight: '700' },
}));
