// Light / dark appearance, chosen per device (stored in localStorage; index.html applies it before the first paint).
import { useSyncExternalStore } from 'react';

export type ThemeChoice = 'dark' | 'light' | 'system';
const KEY = 'theme';
const listeners = new Set<() => void>();
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;

export function themeChoice(): ThemeChoice {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'system' ? v : 'dark'; } catch { return 'dark'; }
}

export function resolvedTheme(c = themeChoice()): 'dark' | 'light' {
  return c === 'system' ? (media?.matches ? 'light' : 'dark') : c;
}

export function applyTheme() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#fbfbf9' : '#0b0b0d');
  listeners.forEach((l) => l());
}

export function setTheme(c: ThemeChoice) {
  try { localStorage.setItem(KEY, c); } catch { /* private mode: applies until reload */ }
  applyTheme();
}

media?.addEventListener?.('change', () => { if (themeChoice() === 'system') applyTheme(); });

export function useTheme() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => themeChoice() + ':' + resolvedTheme());
}
