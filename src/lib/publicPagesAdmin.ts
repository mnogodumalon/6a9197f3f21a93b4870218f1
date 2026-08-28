// Client for the owner-facing public-pages management API (Klar service).
//
// Same-origin: the dashboard is served from {host}/objects/{appgroup}/ and
// Klar from {host}/claude — so `credentials: 'include'` carries the LA
// session (and the beta-routing cookie) automatically. Klar resolves the
// session to the owner's API key server-side; no key handling here.

const APPGROUP_ID = '6a9197f3f21a93b4870218f1';
const BASE = '/claude/public-pages';

export type PageOrigin = 'auto' | 'user' | 'agent';
export type PageType = 'form' | 'custom';

export interface PublicPageField {
  key: string;
  label: string;
  fulltype: string;
  required: boolean;
}

export interface PublicPageEndpoint {
  op: 'list' | 'create';
  entity: string;
  app_id: string;
  fields: PublicPageField[];
  scope_description?: string;
}

/** A page reached with `?<name>=<record_id>`. Its bare URL is a dead end, so
 *  the management UI offers one link PER RECORD instead (see getShareLinks). */
export interface PublicPageLinkParam {
  name: string;
  entity: string;
  app_id: string;
  label_field: string;
  secondary_field?: string | null;
}

export interface PublicPageSummary {
  slug: string;
  type: PageType;
  origin: PageOrigin;
  entity: string;
  app_id: string;
  title: string;
  description: string;
  published: boolean;
  share_url: string;
  fields: PublicPageField[];
  endpoints?: PublicPageEndpoint[];
  link_param?: PublicPageLinkParam | null;
}

export interface ShareLink {
  record_id: string;
  label: string;
  secondary: string;
  url: string;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const detail = body?.detail;
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail === 'object') return detail.message || JSON.stringify(detail);
  } catch {
    // not JSON
  }
  if (res.status === 401 || res.status === 403) return 'Nicht angemeldet oder keine Berechtigung.';
  if (res.status === 404) return 'Öffentliche Seiten sind auf diesem System nicht verfügbar.';
  if (res.status === 502 || res.status === 503) return 'Die öffentliche API ist derzeit nicht erreichbar.';
  return `Fehler (HTTP ${res.status}).`;
}

export async function listPublicPages(): Promise<Record<string, PublicPageSummary>> {
  const res = await fetch(`${BASE}/?appgroup_id=${encodeURIComponent(APPGROUP_ID)}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function setPublished(slug: string, published: boolean): Promise<PublicPageSummary> {
  return patchPage(slug, { published });
}

export async function updateFields(slug: string, fields: string[]): Promise<PublicPageSummary> {
  return patchPage(slug, { fields });
}

async function patchPage(slug: string, body: Record<string, unknown>): Promise<PublicPageSummary> {
  const res = await fetch(`${BASE}/${encodeURIComponent(APPGROUP_ID)}/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export interface FieldCatalogEntry {
  key: string;
  label: string;
  fulltype: string;
  required: boolean;
  selectable: boolean;
  selected: boolean;
  locked: boolean;
  exposes_list: boolean;
  reason?: string;
}

export interface FieldCatalog {
  editable: boolean;
  available: FieldCatalogEntry[];
  selected: string[];
}

/** One share link per record, for a page that needs a query parameter.
 *  Resolved server-side against live records — the dashboard would otherwise
 *  have to know which entity feeds which page. */
export async function getShareLinks(
  slug: string,
): Promise<{ param: string | null; entity?: string; links: ShareLink[] }> {
  const res = await fetch(
    `${BASE}/${encodeURIComponent(APPGROUP_ID)}/${encodeURIComponent(slug)}/links`,
    { credentials: 'include', headers: { Accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function getFields(slug: string): Promise<FieldCatalog> {
  const res = await fetch(
    `${BASE}/${encodeURIComponent(APPGROUP_ID)}/${encodeURIComponent(slug)}/fields`,
    { credentials: 'include', headers: { Accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}
