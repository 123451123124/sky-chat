'use client';

import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';
let sessionTheme: Theme | null = null;
const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'light', toggle: () => {} });

function getTheme(): Theme {
  if (sessionTheme) return sessionTheme;
  try {
    const saved = localStorage.getItem('sky-chat-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* Theme switching still works without persistent storage. */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function subscribe(listener: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const storageChanged = () => { sessionTheme = null; listener(); };
  window.addEventListener('sky-theme-change', listener);
  window.addEventListener('storage', storageChanged);
  media.addEventListener('change', listener);
  return () => {
    window.removeEventListener('sky-theme-change', listener);
    window.removeEventListener('storage', storageChanged);
    media.removeEventListener('change', listener);
  };
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getTheme, () => 'light' as Theme);
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);
  const toggle = () => {
    sessionTheme = getTheme() === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('sky-chat-theme', sessionTheme); } catch {}
    window.dispatchEvent(new Event('sky-theme-change'));
  };
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() { return useContext(ThemeContext); }
