import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Text, View } from 'react-native';

import { useT } from '@/i18n/useT';
import { makeStyles } from '@/theme';

import { shelfReducer, type ShelfAction } from '../models/shelfReducer';
import type { ShelfState } from '../models/types';
import { loadState, runStatements } from '../storage/database';
import { statementsForAction } from '../storage/statements';

// Holds the shelf data for the whole app. The in-memory state is what screens
// read; every change is also written to SQLite in the background, in order.
// Must be rendered inside expo-sqlite's <SQLiteProvider>.
const ShelfStateContext = createContext<ShelfState | null>(null);
const ShelfDispatchContext = createContext<((action: ShelfAction) => void) | null>(null);

export function ShelfProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [state, setState] = useState<ShelfState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Latest state, readable synchronously so back-to-back dispatches build on each other.
  const stateRef = useRef<ShelfState | null>(null);
  // Chain of pending writes, so saves happen in the same order as the changes.
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const t = useT();

  useEffect(() => {
    loadState(db)
      .then((loaded) => {
        stateRef.current = loaded;
        setState(loaded);
      })
      .catch((error: unknown) => setLoadError(String(error)));
  }, [db]);

  const dispatch = useCallback(
    (action: ShelfAction) => {
      const prev = stateRef.current;
      if (!prev) return;
      const next = shelfReducer(prev, action);
      if (next === prev) return;
      stateRef.current = next;
      setState(next);

      const statements = statementsForAction(action, next);
      saveQueue.current = saveQueue.current
        .then(() => runStatements(db, statements))
        .catch((error: unknown) => console.error('Failed to save change', action.type, error));
    },
    [db],
  );

  if (loadError) return <Message text={t('common.loadFailed', { error: loadError })} />;
  if (!state) return <Message text={t('common.loading')} />;

  return (
    <ShelfStateContext.Provider value={state}>
      <ShelfDispatchContext.Provider value={dispatch}>{children}</ShelfDispatchContext.Provider>
    </ShelfStateContext.Provider>
  );
}

export function useShelfState(): ShelfState {
  const state = useContext(ShelfStateContext);
  if (!state) throw new Error('useShelfState must be used inside <ShelfProvider>');
  return state;
}

export function useShelfDispatch(): (action: ShelfAction) => void {
  const dispatch = useContext(ShelfDispatchContext);
  if (!dispatch) throw new Error('useShelfDispatch must be used inside <ShelfProvider>');
  return dispatch;
}

function Message({ text }: { text: string }) {
  const styles = useStyles();
  return (
    <View style={styles.center}>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: c.background },
  text: { color: c.text },
}));
