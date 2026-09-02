/**
 * The PUBLIC door of the journey port — anonymous, grant-scoped.
 *
 *   const port = createPublicPort(cfg, page);
 *
 * `list` reads through the page's list endpoints (a `scope` on the grant
 * decides what a visitor sees), `create` writes the page's own entity, `ref`
 * yields the grant-scoped record reference. Creating any OTHER entity throws
 * a JourneyPortError with the fix in the message — a public page has exactly
 * one create target, declared in `_public/surface.json`.
 */
import {
  createPublicRecord,
  listPublicRecords,
  recordRef,
  type PublicPageConfig,
  type PublicPagesConfig,
} from '@/lib/publicClient';
import { JourneyPortError, toWirePayload, type JourneyPort, type JourneyRecord } from './port';
import { matchesSearch } from './search';
import { ENTITIES, type EntityKey } from './rules';

function appIdOf(entity: EntityKey): string {
  const info = (ENTITIES as Record<string, { appId: string } | undefined>)[entity];
  if (!info) throw new JourneyPortError(`Unknown entity '${entity}' — use one of: ${Object.keys(ENTITIES).join(', ')}.`);
  return info.appId;
}

export function createPublicPort(cfg: PublicPagesConfig, page: PublicPageConfig): JourneyPort {
  const port: JourneyPort = {
    door: 'public',
    async list(entity, opts) {
      const map = await listPublicRecords(cfg, page, {
        appId: appIdOf(entity), limit: opts?.limit ?? 500, offset: opts?.offset,
      });
      const rows = Object.entries(map).map(([id, r]): JourneyRecord => ({
        id: r.id ?? id,
        fields: (r.fields ?? {}) as Record<string, unknown>,
        createdAt: r.created_at ?? null,
      }));
      // A grant's allowed query is field/limit/offset — no `filter`. So the
      // search happens here, over the page the grant handed out.
      const search = opts?.search;
      return search ? rows.filter(r => matchesSearch(r.fields, search.query, search.fields)) : rows;
    },
    // Grants allow field/limit/offset only — no aggregate, no filter. null
    // means "this door cannot count", which is not the same as zero.
    async count() {
      return null;
    },
    async create(entity, values) {
      const appId = appIdOf(entity);
      if (appId !== page.app_id) {
        throw new JourneyPortError(
          `This public page creates '${page.entity}' records only — '${entity}' is not its entity. ` +
            'A second create target needs its own page (one flow = one page).',
        );
      }
      const r = await createPublicRecord(cfg, page, toWirePayload(entity, values, port));
      return { id: r.id, fields: (r.fields ?? {}) as Record<string, unknown>, createdAt: r.created_at ?? null };
    },
    ref: (appId, recordId) => recordRef(cfg, page, appId, recordId),
  };
  return port;
}
