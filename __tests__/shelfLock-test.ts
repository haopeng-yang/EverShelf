/// <reference types="node" />
import { createHash } from 'node:crypto';

import { checkPassword, createLock } from '../src/security/shelfLock';

// expo-crypto's digest runs natively, so these tests use Node's SHA-256 instead.
const sha256 = async (text: string) => createHash('sha256').update(text).digest('hex');

describe('shelf locks', () => {
  it('stores a salted hash, never the password', async () => {
    const lock = await createLock('open sesame', sha256, 'a1b2');
    expect(lock).toEqual({ salt: 'a1b2', hash: await sha256('a1b2open sesame') });
    expect(JSON.stringify(lock)).not.toContain('open sesame');
  });

  it('accepts only the right password', async () => {
    const lock = await createLock('1234', sha256, 'ff');
    expect(await checkPassword(lock, '1234', sha256)).toBe(true);
    expect(await checkPassword(lock, '12345', sha256)).toBe(false);
    expect(await checkPassword(lock, '', sha256)).toBe(false);
  });

  it('gives the same password a different hash on each shelf', async () => {
    const a = await createLock('same', sha256, '01');
    const b = await createLock('same', sha256, '02');
    expect(a.hash).not.toBe(b.hash);
  });
});
