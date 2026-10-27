import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';

import { createDefaultState } from '../models/defaults';
import { shelfReducer, type ShelfAction } from '../models/shelfReducer';
import type { ShelfState } from '../models/types';

// Holds the shelf data for the whole app. Data lives in memory for now;
// Phase 2 saves it to SQLite on the device.
const ShelfStateContext = createContext<ShelfState | null>(null);
const ShelfDispatchContext = createContext<Dispatch<ShelfAction> | null>(null);

export function ShelfProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(shelfReducer, undefined, createDefaultState);
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

export function useShelfDispatch(): Dispatch<ShelfAction> {
  const dispatch = useContext(ShelfDispatchContext);
  if (!dispatch) throw new Error('useShelfDispatch must be used inside <ShelfProvider>');
  return dispatch;
}
