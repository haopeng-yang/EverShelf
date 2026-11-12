import { Alert, Platform } from 'react-native';

// Alert.alert with buttons does nothing on web, so fall back to the browser's dialogs there.

/** Shows a message. Long text goes in the body: Android cuts alert titles short. */
export function showMessage(message: string, title = 'EverShelf'): void {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

/** The two ways to bring in a backup. */
export type ImportMode = 'merge' | 'replace';

/**
 * Asks whether to merge a backup in or replace everything with it. Resolves
 * null if they cancel. The browser has no three-button dialog, so on web it
 * asks about merging first, then about replacing.
 */
export function chooseImportMode(
  title: string,
  message: string,
  labels: { merge: string; replace: string; cancel: string; webMerge: string; webReplace: string },
): Promise<ImportMode | null> {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}\n\n${labels.webMerge}`)) return Promise.resolve('merge');
    return Promise.resolve(window.confirm(labels.webReplace) ? 'replace' : null);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: labels.cancel, style: 'cancel', onPress: () => resolve(null) },
      { text: labels.replace, style: 'destructive', onPress: () => resolve('replace') },
      { text: labels.merge, onPress: () => resolve('merge') },
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
}

/**
 * Asks the user to confirm a destructive action. Resolves true if they agree.
 * Button labels come from the caller so they can be translated.
 */
export function confirm(title: string, message: string, confirmLabel: string, cancelLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
