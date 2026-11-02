import { Text, View } from 'react-native';

import { useT } from '@/i18n/useT';
import { makeStyles, spacing } from '@/theme';

/** A "!" in the corner of a cover whose item doesn't fit on its shelf, e.g. a comic on a novel shelf. */
export function MisplacedMark() {
  const styles = useStyles();
  const t = useT();
  return (
    <View style={styles.mark} accessibilityLabel={t('home.misplacedLabel')} pointerEvents="none">
      <Text style={styles.text}>!</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  mark: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: c.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
}));
