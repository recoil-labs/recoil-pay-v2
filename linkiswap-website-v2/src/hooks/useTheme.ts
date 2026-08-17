import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'linkiswap-theme';

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  // No saved preference — follow the OS, same as the v1 site.
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  // Matches --app-bg for each theme.
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f0f4f8' : '#070436');
}

/**
 * Single module-level store so every mounted toggle (desktop + mobile drawer)
 * reads and writes the same theme instead of drifting apart.
 */
let current: Theme = readInitialTheme();
const listeners = new Set<() => void>();

if (typeof document !== 'undefined') applyTheme(current);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Theme {
  return current;
}

function commit(next: Theme) {
  if (next === current) return;
  current = next;
  applyTheme(next);
  window.localStorage.setItem(STORAGE_KEY, next);
  listeners.forEach(l => l());
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setTheme = useCallback((next: Theme) => commit(next), []);
  const toggleTheme = useCallback(() => commit(current === 'dark' ? 'light' : 'dark'), []);

  return { theme, setTheme, toggleTheme };
}
