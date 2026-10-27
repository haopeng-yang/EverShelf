import { Alert, Platform } from 'react-native';

// Alert.alert with buttons does nothing on web, so fall back to the browser's dialogs there.

/** Shows a message. Long text goes in the body: Android cuts alert titles short. */
export function showMessage(message: string, title = 'EverShelf'): void {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

/** Asks the user to confirm a destructive action. Resolves true if they agree. */
export function confirm(title: string, message: string, confirmLabel = 'Delete'): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
