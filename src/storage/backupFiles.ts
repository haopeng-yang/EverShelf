import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

// Getting a backup file out of and into the app on phones: export writes the
// JSON to the cache and opens the share sheet (save to Files, Drive, email...);
// import opens the file picker. backupFiles.web.ts does the same in a browser.

export async function shareBackupFile(fileName: string, json: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  await file.write(json);
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    UTI: 'public.json',
    dialogTitle: 'Save EverShelf backup',
  });
}

/** Lets the user pick a backup file and returns its text, or null if they cancel. */
export async function pickBackupFile(): Promise<string | null> {
  // Some Android file managers don't label .json files, so allow any file and validate the contents.
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  try {
    return await new File(asset.uri).text();
  } catch (fileError) {
    // Some pickers return URIs (e.g. names with spaces or brackets) the File API won't open; fetch can.
    console.warn('File API could not read the backup, trying fetch', asset.uri, fileError);
    try {
      const response = await fetch(asset.uri);
      return await response.text();
    } catch {
      throw new Error(`Could not read the file "${asset.name}". ${errorMessage(fileError)}`);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
