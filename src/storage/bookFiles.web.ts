import type { Id } from '../models/types';

// Web version of bookFiles.ts: browsers have no app documents folder, so
// importing books is not supported on web yet. Reading finds no chapters.

export function chapterFileName(position: number): string {
  return `${position}.txt`;
}

export function comicChapterFolder(position: number): string {
  return String(position);
}

export function pageFileName(chapterPosition: number, pagePosition: number, extension: string): string {
  return `${comicChapterFolder(chapterPosition)}/${pagePosition}.${extension.toLowerCase()}`;
}

export function pageUri(_itemId: Id, _fileName: string): string | null {
  return null;
}

export async function writePageBytes(_itemId: Id, _fileName: string, _bytes: Uint8Array): Promise<void> {
  throw new Error('Comics are not supported on web yet');
}

export function songFileName(extension: string): string {
  return `song.${extension.toLowerCase()}`;
}

export async function storeSongFile(_itemId: Id, _fileName: string, _from: unknown, _temporary: boolean): Promise<void> {
  throw new Error('Songs are not supported on web yet');
}

export function songUri(_itemId: Id, _fileName: string): string {
  return '';
}

export async function writeChapterText(_itemId: Id, _fileName: string, _text: string): Promise<void> {
  throw new Error('Books are not supported on web yet');
}

export async function readChapterText(_itemId: Id, _fileName: string): Promise<string | null> {
  return null;
}

export function deleteBookFiles(_itemId: Id): void {}

export function pruneBooks(_bookItemIds: Set<Id>): void {}
