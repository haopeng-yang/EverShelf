import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import type { Id, Shelf } from '@/models/types';

// Which locked shelves have been opened with their password. Kept in memory
// only, so every locked shelf locks again when the app is closed or goes to
// the background.

interface ShelfLockContextValue {
  /** True if the shelf has a password and hasn't been unlocked yet. */
  isLocked: (shelf: Shelf | undefined) => boolean;
  unlock: (shelfId: Id) => void;
  lock: (shelfId: Id) => void;
}

const ShelfLockContext = createContext<ShelfLockContextValue | null>(null);

export function ShelfLockProvider({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState<ReadonlySet<Id>>(new Set());

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') setUnlocked(new Set());
    });
    return () => subscription.remove();
  }, []);

  const isLocked = useCallback((shelf: Shelf | undefined) => !!shelf?.lock && !unlocked.has(shelf.id), [unlocked]);
  const unlock = useCallback((shelfId: Id) => setUnlocked((set) => new Set(set).add(shelfId)), []);
  const lock = useCallback(
    (shelfId: Id) =>
      setUnlocked((set) => {
        const next = new Set(set);
        next.delete(shelfId);
        return next;
      }),
    [],
  );

  const value = useMemo(() => ({ isLocked, unlock, lock }), [isLocked, unlock, lock]);
  return <ShelfLockContext.Provider value={value}>{children}</ShelfLockContext.Provider>;
}

export function useShelfLocks(): ShelfLockContextValue {
  const value = useContext(ShelfLockContext);
  if (!value) throw new Error('useShelfLocks must be used inside <ShelfLockProvider>');
  return value;
}
