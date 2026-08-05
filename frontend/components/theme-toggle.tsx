'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

const storageKey = 'rk-theme';

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    const nextDark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    setDark(nextDark);
    document.documentElement.classList.toggle('dark', nextDark);
  }, []);

  const toggle = () => {
    const nextDark = !dark;
    setTransitioning(true);
    setDark(nextDark);
    window.localStorage.setItem(storageKey, nextDark ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', nextDark);
    document.documentElement.classList.add('theme-transitioning');
    document.body.classList.add('theme-freeze');
    window.setTimeout(() => {
      document.documentElement.classList.remove('theme-transitioning');
      document.body.classList.remove('theme-freeze');
      setTransitioning(false);
    }, 700);
  };

  return <button type="button" onClick={toggle} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'} className={`theme-toggle fixed bottom-4 right-4 z-[220] flex h-9 w-9 items-center justify-center rounded-full border border-charcoal bg-charcoal text-ivory shadow-md backdrop-blur transition hover:border-gold hover:bg-gold dark:border-charcoal/30 dark:bg-ivory dark:text-charcoal ${transitioning ? 'theme-toggle-active' : ''}`}><span className="sr-only">{dark ? 'Light mode' : 'Dark mode'}</span>{dark ? <Sun className={`h-3.5 w-3.5 transition-transform duration-1000 ${transitioning ? 'rotate-180' : ''}`} /> : <Moon className={`h-3.5 w-3.5 transition-transform duration-1000 ${transitioning ? 'rotate-180' : ''}`} />}</button>;
}
