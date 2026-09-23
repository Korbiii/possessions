import { useEffect, useState } from 'react';
import { parseHash, type Route } from '../lib/routes';

/** Subscribes to `window.location.hash` and returns the parsed route. */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export function navigate(path: string): void {
  if (window.location.hash === path) return;
  window.location.hash = path;
}
