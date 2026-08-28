import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { IconWorld, IconCheck, IconLink } from '@tabler/icons-react';
import { loadPublicPagesConfig } from '@/lib/publicClient';
import { t } from '@/i18n';

/**
 * PublicPagesNav — sidebar section for the dashboard's public pages.
 *
 * Renders from the runtime config (public-pages.json) that also drives the
 * pages themselves: publishing a page makes it appear here without a rebuild,
 * pausing removes it. Only PUBLISHED pages are listed (drafts are invisible
 * by design — the list mirrors exactly what the outside world can reach).
 *
 * Rows open the public page in a new tab (it renders outside the dashboard
 * layout) and offer one-click copy of the shareable link. Anonymous visitors
 * never see this — the sidebar only exists inside the authenticated Layout.
 *
 * The whole section stays hidden until the dashboard actually HAS a public
 * page — published or waiting to be published. A dashboard that never asked
 * for one shows no trace of the feature.
 */

interface NavEntry {
  slug: string;
  title: string;
  url: string;
}

export function PublicPagesNav({ onNavigate }: { onNavigate?: () => void }) {
  const [entries, setEntries] = useState<NavEntry[]>([]);
  // Show the section only when there is something to show or to publish.
  // `pages` holds published pages only, so a draft is invisible there — the
  // artifact carries `unpublished_count` for exactly this decision. The mere
  // existence of the config is NOT enough: it is written for every dashboard,
  // so keying on it put an empty section into every sidebar.
  const [available, setAvailable] = useState(false);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cfg = await loadPublicPagesConfig();
      if (cancelled || !cfg) return;
      const published = Object.keys(cfg.pages).length;
      setAvailable(published > 0 || (cfg.unpublished_count ?? 0) > 0);
      const base = window.location.href.split('#')[0];
      setEntries(
        Object.entries(cfg.pages).map(([slug, page]) => ({
          slug,
          title: page.title,
          url: new URL(`#/public/${slug}`, base).toString(),
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!available) return null;

  const copy = async (entry: NavEntry) => {
    try {
      await navigator.clipboard.writeText(entry.url);
      setCopiedSlug(entry.slug);
      setTimeout(() => setCopiedSlug(current => (current === entry.slug ? null : current)), 1500);
    } catch {
      // Clipboard unavailable (permissions/insecure context) — the link still
      // opens via the row itself.
    }
  };

  return (
    <nav className="pt-4" aria-label={t('ppn_heading')}>
      <div className="flex items-center justify-between px-2 pb-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
          {t('ppn_heading')}
        </p>
        <NavLink
          to="verwaltung/oeffentliche-seiten"
          onClick={onNavigate}
          className="text-[11px] font-medium text-sidebar-foreground/50 hover:text-sidebar-accent-foreground transition-colors"
        >
          {t('ppn_manage_label')}
        </NavLink>
      </div>
      {/* The leading icons share the section heading's px-2 gutter; titles
          receive their hierarchy naturally from the icon and gap. */}
      <div className="space-y-0.5">
        {entries.map(entry => (
          <div key={entry.slug} className="group flex items-center min-w-0">
            <a
              href={entry.url}
              target="_blank"
              rel="noreferrer"
              className="flex flex-1 items-center gap-2 px-2 py-2 rounded-2xl text-base transition-colors min-w-0 font-normal text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
            >
              <IconWorld size={18} stroke={1.5} className="shrink-0" />
              <span className="truncate">{entry.title}</span>
            </a>
            <button
              type="button"
              title={t('ppn_copy_label')}
              aria-label={t('ppn_copy_label')}
              onClick={() => copy(entry)}
              className="shrink-0 p-2 mr-1 rounded-xl text-sidebar-foreground/60 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
            >
              {copiedSlug === entry.slug ? (
                <IconCheck size={16} stroke={1.5} />
              ) : (
                <IconLink size={16} stroke={1.5} />
              )}
            </button>
          </div>
        ))}
      </div>
    </nav>
  );
}
