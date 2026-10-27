import * as DocumentPicker from 'expo-document-picker';

// Web version of backupFiles.ts: export downloads the file, import uses the browser's file picker.

export async function shareBackupFile(fileName: string, json: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function pickBackupFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  if (asset.file) return asset.file.text();
  return (await fetch(asset.uri)).text();
}
