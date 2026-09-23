import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { Toasts } from './components/Toasts';
import { useHashRoute } from './hooks/useHashRoute';
import { reviewQueue } from './lib/categories';
import { pluralize } from './lib/format';
import { homePath, reviewPath, settingsPath } from './lib/routes';
import { CategoryPage } from './pages/CategoryPage';
import { HomePage } from './pages/HomePage';
import { ItemPage } from './pages/ItemPage';
import { ReviewPage } from './pages/ReviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { useApp } from './state/AppState';

function renderRoute(route: ReturnType<typeof useHashRoute>): ReactNode {
  switch (route.name) {
    case 'category':
      return <CategoryPage category={route.category} />;
    case 'item':
      return <ItemPage id={route.id} />;
    case 'review':
      return <ReviewPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <HomePage />;
  }
}

/** App shell: header, tab bar, routing and the PWA update prompt. */
export function App(): ReactNode {
  const { ready, online, items, analysis } = useApp();
  const route = useHashRoute();
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const updateServiceWorker = useRef<((reload?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    updateServiceWorker.current = registerSW({
      immediate: true,
      onNeedRefresh: () => setNeedRefresh(true),
      onOfflineReady: () => setOfflineReady(true),
    });
  }, []);

  const reviewCount = useMemo(() => reviewQueue(items).length, [items]);

  const tabs = [
    { href: homePath, label: 'Library', active: route.name === 'home' || route.name === 'category' || route.name === 'item' },
    { href: reviewPath, label: 'Review', active: route.name === 'review', badge: reviewCount },
    { href: settingsPath, label: 'Settings', active: route.name === 'settings' },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <a className="topbar__brand" href={homePath}>
          <span aria-hidden="true">📦</span> Possessions
        </a>
        <div className="topbar__status">
          {analysis.running ? <span className="dot dot--busy" title="Analyzing" /> : null}
          <span
            className={`dot ${online ? 'dot--online' : 'dot--offline'}`}
            title={online ? 'Online' : 'Offline — the app keeps working'}
          />
          <span className="topbar__count">{pluralize(items.length, 'item')}</span>
        </div>
      </header>

      {needRefresh ? (
        <div className="banner">
          <span>A new version is available.</span>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void updateServiceWorker.current?.(true)}
          >
            Reload
          </button>
        </div>
      ) : null}
      {!needRefresh && offlineReady ? (
        <div className="banner banner--info">
          <span>Ready to work offline.</span>
          <button type="button" className="btn" onClick={() => setOfflineReady(false)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <main className="main">
        {ready ? renderRoute(route) : <p className="hint">Opening local library…</p>}
      </main>

      <nav className="tabbar">
        {tabs.map((tab) => (
          <a
            key={tab.href}
            href={tab.href}
            className={`tabbar__item ${tab.active ? 'tabbar__item--active' : ''}`}
          >
            {tab.label}
            {tab.badge ? <span className="tabbar__badge">{tab.badge}</span> : null}
          </a>
        ))}
      </nav>

      <Toasts />
    </div>
  );
}
