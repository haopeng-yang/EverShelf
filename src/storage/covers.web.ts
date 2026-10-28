import type { ShelfState } from '../models/types';

// Web version of covers.ts: browsers have no app documents folder, so covers
// are kept as the picker's data URIs and stored as-is.

export async function saveCover(pickedUri: string): Promise<string> {
  return pickedUri;
}

export function deleteCover(_uri: string | null): void {}

export async function readCoverAsDataUri(uri: string): Promise<string | null> {
  if (uri.startsWith('data:')) return uri;
  try {
    const blob = await (await fetch(uri)).blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function writeCoverFromDataUri(dataUri: string): Promise<string> {
  return dataUri;
}

export async function writeCoverBytes(bytes: Uint8Array, extension: string): Promise<string> {
  const mime = extension === 'jpg' ? 'jpeg' : extension;
  return URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: `image/${mime}` }));
}

export function pruneCovers(_state: ShelfState): void {}
