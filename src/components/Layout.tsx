import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { IconAlertCircle } from '@tabler/icons-react';
import { useState, useEffect, useRef } from 'react';
import { ActionsSidebar } from '@/components/ActionsSidebar';
import { IntentsNav } from '@/components/IntentsNav';
import { PublicPagesNav } from '@/components/PublicPagesNav';
import { Button } from '@/components/ui/button';
import { VersionCheck } from '@/components/VersionCheck';
// Sprachwechsel kommt aus der Plattform-Topnav: sie schreibt <html lang>,
// src/i18n beobachtet das Attribut und LocaleGate remountet den Baum.
import { t, appgroupLabel } from '@/i18n';

const APP_ID = '6a9197ea96a5e7ac4144fc4c';
const APPGROUP_ID = '6a9197f3f21a93b4870218f1';

const IS_EMBED = new URLSearchParams(window.location.search).has('embed') || window.navigator.userAgent.startsWith('LivingAppsMobile');

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [authError, setAuthError] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const dashboardLinkRef = useRef<HTMLElement>(null);
  useEffect(() => { document.title = appgroupLabel(); }, []);
  useEffect(() => {
    const handler = () => setAuthError(true);
    window.addEventListener('auth-error', handler);
    return () => window.removeEventListener('auth-error', handler);
  }, []);

  // Mobil startet der Drawer eingeklappt. Das collapsed-Attribut wird
  // imperativ gesetzt (nicht als JSX-Prop), weil die Header-Bar es beim
  // Toggle selbst setzt/entfernt — React darf es nicht zurückerobern.
  useEffect(() => {
    if (drawerRef.current && window.matchMedia('(max-width: 767.98px)').matches) {
      drawerRef.current.setAttribute('collapsed', '');
    }
  }, []);

  // Der Dashboard-Eintrag zeigt per App-Parameter auf genau diese Seite —
  // statt sie neu zu laden (leave-page + location.assign), fangen wir das
  // cancelbare Event ab und wechseln SPA-intern auf die Übersicht.
  useEffect(() => {
    const el = dashboardLinkRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      e.preventDefault();
      navigate('/');
      if (window.matchMedia('(max-width: 767.98px)').matches) {
        el.closest('la-drawer')?.setAttribute('collapsed', '');
      }
    };
    el.addEventListener('dashboard-link:action-request', handler);
    return () => el.removeEventListener('dashboard-link:action-request', handler);
  }, [navigate]);

  // Aktiv-Zustand des Dashboard-Eintrags: la-dashboard-link-widget kennt
  // (anders als la-app-group-nav-widget) kein here-Flag — Widget-Lücke.
  // Wir spiegeln die here-Optik der Nachbarliste über ein zustandsabhängiges
  // Stylesheet im offenen Shadow DOM. Interval-Fallback, weil der Loader
  // asynchron lädt und das Shadow Root beim ersten Render fehlen kann.
  const onDashboard = location.pathname === '/';
  useEffect(() => {
    const apply = () => {
      const sr = dashboardLinkRef.current?.shadowRoot;
      if (!sr) return false;
      let style = sr.querySelector('style[data-here]');
      if (!style) {
        style = document.createElement('style');
        style.setAttribute('data-here', '');
        sr.appendChild(style);
      }
      // #d24601 = text-action-orange-dark der Widget-Library (here-Optik)
      style.textContent = onDashboard
        ? 'a { color: #d24601 !important; font-weight: 500; cursor: default; }'
        : '';
      return true;
    };
    if (apply()) return;
    const timer = window.setInterval(() => { if (apply()) window.clearInterval(timer); }, 250);
    return () => window.clearInterval(timer);
  }, [onDashboard]);

  return (
    // Der body ist das App-Frame-Grid (Vorgabe Widget-Team, s. index.css):
    // top/left/center-Areas. #root und dieser Wrapper sind display:contents,
    // damit Header, Drawer und Content direkte Grid-Items werden. Die
    // Area-Zuordnung von Header/Drawer liegt in index.css.
    <div className="contents">
      {!IS_EMBED && (
        <la-header-bar-widget title={appgroupLabel()} app-id={APP_ID}>
          {/* app-id auch am Menü selbst: erst mit eigenem App-Kontext zeigt
              es die Einstellungs-Sektion (Benutzerverwaltung, Datenansicht,
              Klar KI, App kopieren, Anleitung, Struktur). */}
          <la-apps-menu-widget slot="widgets" app-id={APP_ID} />
          <la-profile-menu-widget slot="widgets" />
        </la-header-bar-widget>
      )}

      {/* Overlay-Widgets, die Header (Contact) und Profil-Menü (Profil
          bearbeiten / Sicherheit) per document.querySelector suchen und über
          das open-Attribut öffnen — ohne diese Elemente verpuffen die Klicks
          stumm. Bewusst NICHT in den Header geslottet: als Geschwister bleiben
          ihre Modals außerhalb des Header-Stacking-Contexts (z-Leiste). */}
      {!IS_EMBED && (
        <>
          <la-feedback-form-widget />
          <la-user-profile-widget />
          <la-security-widget />
          {/* „Aktuelle App kopieren" im Apps-Menü sucht dieses Overlay per
              querySelector; la-gua-widget (Benutzerverwaltung) erzeugt das
              Menü dagegen selbst. */}
          <la-app-group-copy-widget data-grp-id={APPGROUP_ID} />
        </>
      )}

      {/* Drawer = Grid-Area "left" (Zuordnung in index.css): In-Flow-Spalte,
          die den Content selbst verdrängt; eingeklappt ein schmaler Streifen
          mit Hover-Peek. Mobil ein Fixed-Overlay (verlässt das Grid). */}
      {!IS_EMBED && (
        <la-drawer ref={drawerRef}>
          {/* Darstellung-Umschalter — identisch zur Datenverwaltung: der
              Dashboard-Eintrag (la-dashboard-link-widget) und die App-Liste
              der Gruppe (la-app-group-nav-widget → /gateway-Listenseiten). */}
          <la-nav-section type="secondary" label={t('display_section')}>
            <la-dashboard-link-widget ref={dashboardLinkRef} app-id={APP_ID} />
            {/* dense = kleinere Unterpunkt-Schrift (setzt --la-nav-text-size
                im Sektions-Shadow) — exakt wie die Datenverwaltung im Gateway. */}
            <la-nav-section type="primary" label={t('data_management')} icon="IconMenu2" dense="">
              <la-app-group-nav-widget group-id={APPGROUP_ID} />
            </la-nav-section>
          </la-nav-section>

          {/* Produktivitäts-Sektion (Figma-Muster): zusätzliche Funktionen —
              Abläufe und Öffentliche Seiten als aufklappbare Gruppen
              (starten zu), Werkzeuge als schlichter Eintrag (öffnet den
              Werkzeuge-Drawer des Assistenten), dann die Version als
              Meta-Zeile. Klar Lab und
              die Entwickler/Beta-Toggles stecken im Versions-Panel. */}
          <la-nav-section type="secondary" label={t('actions_section')}>
            <IntentsNav />
            <ActionsSidebar />
            <PublicPagesNav />
            <div className="pt-2">
              <VersionCheck />
            </div>
          </la-nav-section>

          {/* Sticky Footer = dünne Meta-Zeile (Figma-Muster). Relative
              Pfade, damit die Plattform-Seiten auf jedem Host stimmen. */}
          <div slot="footer" className="flex flex-wrap justify-center gap-x-4 gap-y-1 border-t border-sidebar-border py-3 text-sm font-medium text-muted-foreground">
            <a href="/impressum.htm" className="hover:text-foreground transition-colors">{t('legal_imprint')}</a>
            <a href="/datenschutz.htm" className="hover:text-foreground transition-colors">{t('legal_privacy')}</a>
            <a href="/apps.htm" className="hover:text-foreground transition-colors">LivingApps</a>
          </div>
        </la-drawer>
      )}

      <div className="[grid-area:center] min-w-0">
        <main className={`max-w-screen-2xl ${IS_EMBED ? "p-2 lg:p-4" : "p-6 lg:p-8"}`}>
          {authError ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center">
                <IconAlertCircle size={22} className="text-destructive" />
              </div>
              <div className="text-center">
                <h3 className="font-semibold text-foreground mb-1">{t('auth_error_title')}</h3>
              </div>
              <Button variant="outline" size="sm" onClick={() => {
                window.location.href = `${window.location.origin}/login.htm?cugCoUrl=${encodeURIComponent(window.location.href)}`;
              }}>{t('auth_login_button')}</Button>
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>

      {/* The assistant element (<la-klar-assistant>) mounts in App.tsx,
          OUTSIDE LocaleGate — its keyed remounts must not tear the element
          down mid-chat. */}
    </div>
  );
}
