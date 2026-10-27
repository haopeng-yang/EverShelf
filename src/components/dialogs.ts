import { Alert, Platform } from 'react-native';

// Alert.alert with buttons does nothing on web, so fall back to the browser's dialogs there.

export function showMessage(message: string): void {
  if (Platform.OS === 'web') window.alert(message);
  else Alert.alert(message);
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
