'use client';

import { useSyncExternalStore } from 'react';

// < 720 px — мобильная раскладка (как в прототипе).
const QUERY = '(max-width: 719.98px)';

export function useNarrow(): boolean {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(QUERY); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); },
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}
