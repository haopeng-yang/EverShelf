import { CryptoDigestAlgorithm, digestStringAsync, getRandomBytes } from 'expo-crypto';

import type { ShelfLock } from '../models/types';

// Shelf passwords are never stored. A lock keeps a random salt and the
// SHA-256 of salt + password; checking a password hashes it the same way and
// compares. This keeps a shelf private from other people using the phone. It
// does not encrypt the shelf: its items are still in the app's database and
// in backups.

/** Shortest password accepted. */
export const MIN_PASSWORD_LENGTH = 4;

type Digest = (text: string) => Promise<string>;

const sha256: Digest = (text) => digestStringAsync(CryptoDigestAlgorithm.SHA256, text);

/** Makes a new lock for a password, with a fresh random salt. */
export async function createLock(password: string, digest: Digest = sha256, salt = randomSalt()): Promise<ShelfLock> {
  return { salt, hash: await digest(salt + password) };
}

export async function checkPassword(lock: ShelfLock, password: string, digest: Digest = sha256): Promise<boolean> {
  return (await digest(lock.salt + password)) === lock.hash;
}

function randomSalt(): string {
  return Array.from(getRandomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
}
