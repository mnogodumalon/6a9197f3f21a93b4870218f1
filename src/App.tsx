import '@/lib/sentry';
import '@/lib/stale-bundle';
import { Fragment, lazy, Suspense, useEffect, useState } from 'react';
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import { locale, onLocaleChange, syncProfileLocale } from '@/i18n';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ErrorBusProvider } from '@/components/ErrorBus';
import { Layout } from '@/components/Layout';
import DashboardReady from '@/pages/DashboardReady';
import AdminPage from '@/pages/AdminPage';
import PublicPagesAdmin from '@/pages/PublicPagesAdmin';
import TestererfassungPage from '@/pages/TestererfassungPage';
import TestererfassungDetailPage from '@/pages/TestererfassungDetailPage';
// <custom:imports>
// </custom:imports>

// Lazy: public pages live outside <Layout> and only load on /#/public/:slug —
// dashboard users never pay for them, anonymous visitors skip the dashboard.
const PublicPage = lazy(() => import('@/pages/public/PublicPage'));

// Language switch = full remount below the router: every t()/label lookup
// re-evaluates, the la-* widgets re-read <html lang>. Sits inside HashRouter
// so the current route survives (it re-reads the URL hash).
function LocaleGate({ children }: { children: React.ReactNode }) {
  // The i18n layer notifies for locale CHANGES and for catalog/overlay
  // ARRIVALS (same locale, new data). `setCurrent(locale)` bailed out on
  // the arrivals — when locales/pages.json lost the race against the first
  // paint, the page stayed frozen in the build language until the next
  // locale switch. A generation counter accepts every notification; the
  // key must include it because `children` is the same element object on
  // every gate render (React would bail out without the remount).
  const [gen, setGen] = useState(0);
  useEffect(() => onLocaleChange(() => setGen((g) => g + 1)), []);
  // Adopt the LA profile language (SSOT) — but never on public routes,
  // where the visitor's browser language governs (initPublicLocale).
  useEffect(() => {
    if (!window.location.hash.startsWith('#/public')) void syncProfileLocale();
  }, []);
  return <Fragment key={`${locale}:${gen}`}>{children}</Fragment>;
}

const APPGROUP_ID = '6a9197f3f21a93b4870218f1';

// The assistant (chat + Werkzeuge + code viewer) is platform chrome:
// <la-klar-assistant>, loaded via /actions-agent/embed/embed.js (appended
// dynamically in index.html). Own shadow DOM, own styling. Mounted OUTSIDE
// LocaleGate on purpose — its keyed remounts (locale switch, catalog
// arrival) must not tear the element down mid-chat; the element follows
// <html lang> itself. Hidden on anonymous public routes; its 401 guard is
// the backstop, not the mechanism.
function AssistantMount() {
  const location = useLocation();
  if (location.pathname.startsWith('/public')) return null;
  return <la-klar-assistant appgroup-id={APPGROUP_ID} />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ErrorBusProvider>
        <HashRouter>
            <AssistantMount />
            <LocaleGate>
            <Routes>
              <Route path="public/:slug" element={<Suspense fallback={null}><PublicPage /></Suspense>} />
              <Route element={<Layout />}>
                <Route index element={<DashboardReady />} />
                <Route path="testererfassung" element={<TestererfassungPage />} />
                <Route path="testererfassung/:id" element={<TestererfassungDetailPage />} />
                <Route path="admin" element={<AdminPage />} />
                <Route path="verwaltung/oeffentliche-seiten" element={<PublicPagesAdmin />} />
                {/* <custom:routes> */}
                {/* </custom:routes> */}
              </Route>
            </Routes>
            </LocaleGate>
        </HashRouter>
      </ErrorBusProvider>
    </ErrorBoundary>
  );
}
