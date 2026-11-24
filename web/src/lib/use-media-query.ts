import { useSyncExternalStore } from 'react';

/**
 * 訂閱 CSS media query。不支援 matchMedia 的環境（如 jsdom）一律視為不符合。
 * @param query 例如 '(min-width: 1024px)'
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  );
}
