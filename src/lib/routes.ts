/**
 * Tiny hash router.
 *
 * A full router dependency is not needed for five screens, and hash routing
 * keeps deep links working when the app is installed as a PWA.
 */

export type Route =
  | { name: 'home' }
  | { name: 'category'; category: string }
  | { name: 'item'; id: string }
  | { name: 'review' }
  | { name: 'settings' };

export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#/, '').replace(/^\/+/, '');
  const [segment = '', ...rest] = clean.split('/');
  switch (segment) {
    case 'category': {
      const category = decodeURIComponent(rest.join('/'));
      return category ? { name: 'category', category } : { name: 'home' };
    }
    case 'item': {
      const id = decodeURIComponent(rest.join('/'));
      return id ? { name: 'item', id } : { name: 'home' };
    }
    case 'review':
      return { name: 'review' };
    case 'settings':
      return { name: 'settings' };
    default:
      return { name: 'home' };
  }
}

export const homePath = '#/';
export const reviewPath = '#/review';
export const settingsPath = '#/settings';

export function categoryPath(category: string): string {
  return `#/category/${encodeURIComponent(category)}`;
}

export function itemPath(id: string): string {
  return `#/item/${encodeURIComponent(id)}`;
}
