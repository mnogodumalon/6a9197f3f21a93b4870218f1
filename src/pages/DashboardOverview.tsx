import { useMemo, useState } from 'react';
import type { DashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { LOOKUP_OPTIONS, lookupOption } from '@/types/app';
import { lookupKey } from '@/lib/formatters';
import { tx, appLabel } from '@/i18n';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { formatDate } from '@/lib/formatters';
import { format } from 'date-fns';
import { DashboardGrid } from '@/components/DashboardGrid';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import {
  KanbanWidget,
  type KanbanCard,
  type KanbanColumn,
  type KanbanTone,
} from '@/components/widgets/KanbanWidget';
import { LivingAppsService } from '@/services/livingAppsService';
import { IconClipboardList, IconAlertTriangle, IconCircleCheck, IconPlayerPlay } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';

function toneForStatus(status: string | undefined): KanbanTone {
  if (status === 'abgeschlossen') return 'success';
  if (status === 'in_bearbeitung') return 'primary';
  return 'warning';
}

export default function DashboardOverview({ data }: { data: DashboardData }) {
  const { testererfassung, setTestererfassung, fetchAll } = data;
  const clock = useClock();

  const crud = useEntityCrud(data, {
    footer: (top) => {
      if (top.type !== 'testererfassung') return undefined;
      const rec = testererfassung.find(r => r.record_id === top.record.record_id);
      if (!rec) return undefined;
      const status = lookupKey(rec.fields.status);
      if (status === 'offen') return {
        label: tx('In Bearbeitung setzen'),
        onClick: () => advanceStatus(rec.record_id, 'in_bearbeitung'),
      };
      if (status === 'in_bearbeitung') return {
        label: tx('Abschließen'),
        onClick: () => advanceStatus(rec.record_id, 'abgeschlossen'),
      };
      return undefined;
    },
  });

  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  // Columns from schema — inside component body (locale-aware getters)
  const COLUMNS = useMemo<KanbanColumn[]>(
    () => (LOOKUP_OPTIONS['testererfassung']?.['status'] ?? []).map(o => ({ key: o.key, label: o.label })),
    [],
  );

  const cards = useMemo<KanbanCard[]>(
    () =>
      testererfassung.map(r => {
        const status = lookupKey(r.fields.status) ?? COLUMNS[0]?.key ?? '';
        return {
          id: `testererfassung:${r.record_id}`,
          column: status,
          title: r.fields.titel ?? tx('Ohne Titel'),
          subtitle: r.fields.datum ? formatDate(r.fields.datum) : undefined,
          tone: toneForStatus(status),
        };
      }),
    [testererfassung, COLUMNS],
  );

  // Shared advance helper — used by banner, work-list and overlay footer
  const advanceStatus = async (recordId: string, newStatus: string) => {
    const prev = testererfassung.find(r => r.record_id === recordId);
    if (!prev) return;
    const prevStatus = lookupKey(prev.fields.status);
    setTestererfassung(old =>
      old.map(r =>
        r.record_id === recordId
          ? { ...r, fields: { ...r.fields, status: lookupOption('testererfassung', 'status', newStatus) } }
          : r,
      ),
    );
    try {
      await LivingAppsService.updateTestererfassungEntry(recordId, { status: newStatus });
      undoToast(
        tx`Status aktualisiert`,
        async () => {
          setTestererfassung(old =>
            old.map(r =>
              r.record_id === recordId
                ? { ...r, fields: { ...r.fields, status: lookupOption('testererfassung', 'status', prevStatus ?? 'offen') } }
                : r,
            ),
          );
          await LivingAppsService.updateTestererfassungEntry(recordId, { status: prevStatus ?? 'offen' });
        },
      );
    } catch {
      fetchAll();
    }
  };

  const moveCard = async (cardId: string, newColumn: string): Promise<string | void> => {
    const rid = cardId.split(':')[1];
    if (!rid) return;
    const rec = testererfassung.find(r => r.record_id === rid);
    if (!rec) return;
    const prevStatus = lookupKey(rec.fields.status);
    setTestererfassung(old =>
      old.map(r =>
        r.record_id === rid
          ? { ...r, fields: { ...r.fields, status: lookupOption('testererfassung', 'status', newColumn) } }
          : r,
      ),
    );
    try {
      await LivingAppsService.updateTestererfassungEntry(rid, { status: newColumn });
      const col = COLUMNS.find(c => c.key === newColumn);
      undoToast(
        tx`Status auf ${col?.label ?? newColumn} gesetzt`,
        async () => {
          setTestererfassung(old =>
            old.map(r =>
              r.record_id === rid
                ? { ...r, fields: { ...r.fields, status: lookupOption('testererfassung', 'status', prevStatus ?? 'offen') } }
                : r,
            ),
          );
          await LivingAppsService.updateTestererfassungEntry(rid, { status: prevStatus ?? 'offen' });
        },
      );
    } catch {
      fetchAll();
    }
  };

  // KPI derivations
  const total = testererfassung.length;
  const offene = testererfassung.filter(r => lookupKey(r.fields.status) === 'offen');
  const inBearbeitung = testererfassung.filter(r => lookupKey(r.fields.status) === 'in_bearbeitung');
  const abgeschlossen = testererfassung.filter(r => lookupKey(r.fields.status) === 'abgeschlossen');
  const bestanden = testererfassung.filter(r => r.fields.bestanden === true);
  const bestandenRate = abgeschlossen.length > 0
    ? Math.round((bestanden.length / abgeschlossen.length) * 100)
    : 0;

  // Hero: urgent = tests that are overdue (have a datum in the past and are not abgeschlossen)
  const todayKey = format(clock, 'yyyy-MM-dd');
  const ueberfaellig = testererfassung.filter(r => {
    const status = lookupKey(r.fields.status);
    if (status === 'abgeschlossen') return false;
    if (!r.fields.datum) return false;
    return r.fields.datum < todayKey;
  });

  // Context line
  const naechster = testererfassung
    .filter(r => lookupKey(r.fields.status) !== 'abgeschlossen' && r.fields.datum && r.fields.datum >= todayKey)
    .sort((a, b) => (a.fields.datum ?? '').localeCompare(b.fields.datum ?? ''))[0];

  let contextLine: string;
  if (total === 0) {
    contextLine = tx('Noch keine Tests erfasst — leg jetzt los!');
  } else if (ueberfaellig.length > 0) {
    contextLine = tx`${ueberfaellig.length} Test${ueberfaellig.length === 1 ? '' : 's'} überfällig — ${namen(ueberfaellig.map(r => r.fields.titel ?? ''))}`;
  } else if (naechster) {
    contextLine = tx`Nächster Test: ${naechster.fields.titel ?? ''} am ${formatDate(naechster.fields.datum)}`;
  } else {
    contextLine = tx`${abgeschlossen.length} von ${total} Tests abgeschlossen`;
  }

  // Filtered cards for kanban
  const filteredCards = statusFilter
    ? cards.filter(c => c.column === statusFilter)
    : cards;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{gruss(clock)}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{contextLine}</p>
        </div>
        <Button
          size="sm"
          onClick={() => crud.testererfassung.openCreate({ status: 'offen' })}
          className="shrink-0 self-start sm:self-auto"
        >
          {tx('Neuer Test')}
        </Button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={ueberfaellig.length > 0 ? (
          <HeroBanner
            icon={<IconAlertTriangle size={18} />}
            action={{
              label: tx('In Bearbeitung setzen'),
              onClick: () => advanceStatus(ueberfaellig[0].record_id, 'in_bearbeitung'),
            }}
          >
            <b>{namen(ueberfaellig.map(r => r.fields.titel ?? ''))}</b>{' '}
            {ueberfaellig.length === 1 ? tx('ist überfällig') : tx('sind überfällig')}
            {ueberfaellig[0].fields.datum ? tx` — fällig war ${formatDate(ueberfaellig[0].fields.datum)}` : ''}.
          </HeroBanner>
        ) : undefined}
        kpis={
          <StatStrip>
            <StatStripItem
              title={tx('Gesamt')}
              value={total}
              icon={<IconClipboardList size={16} />}
            />
            <StatStripItem
              title={tx('Offen')}
              value={offene.length}
              tone={offene.length > 0 ? 'warning' : 'default'}
              icon={<IconAlertTriangle size={16} />}
              onClick={() => setStatusFilter(f => f === 'offen' ? null : 'offen')}
              active={statusFilter === 'offen'}
            />
            <StatStripItem
              title={tx('In Bearbeitung')}
              value={inBearbeitung.length}
              tone={inBearbeitung.length > 0 ? 'primary' : 'default'}
              icon={<IconPlayerPlay size={16} />}
              onClick={() => setStatusFilter(f => f === 'in_bearbeitung' ? null : 'in_bearbeitung')}
              active={statusFilter === 'in_bearbeitung'}
            />
            <StatStripItem
              title={tx('Bestanden')}
              value={abgeschlossen.length > 0 ? `${bestandenRate}%` : '—'}
              tone={bestandenRate >= 80 ? 'success' : abgeschlossen.length > 0 ? 'warning' : 'default'}
              icon={<IconCircleCheck size={16} />}
              onClick={() => setStatusFilter(f => f === 'abgeschlossen' ? null : 'abgeschlossen')}
              active={statusFilter === 'abgeschlossen'}
            />
          </StatStrip>
        }
        primary={
          <KanbanWidget
            cards={filteredCards}
            columns={COLUMNS}
            defaultCollapsed={['abgeschlossen']}
            onCardClick={card => {
              const rid = card.id.split(':')[1];
              const rec = testererfassung.find(r => r.record_id === rid);
              if (rec) crud.testererfassung.openDetail(rec);
            }}
            onCardMove={moveCard}
            onAddCard={column => crud.testererfassung.openCreate({ status: column })}
          />
        }
        aside={
          <>
            <WorkList
              title={tx('Überfällig & offen')}
              items={[...ueberfaellig, ...offene.filter(r => !ueberfaellig.find(u => u.record_id === r.record_id))]
                .slice(0, 8)
                .map(r => ({
                  id: r.record_id,
                  title: r.fields.titel ?? tx('Ohne Titel'),
                  secondLine: (
                    <>
                      <span className={ueberfaellig.find(u => u.record_id === r.record_id) ? 'font-medium text-destructive' : 'font-medium text-amber-600'}>
                        {ueberfaellig.find(u => u.record_id === r.record_id) ? tx('Überfällig') : tx('Offen')}
                      </span>
                      {r.fields.datum && (
                        <span className="text-muted-foreground"> · {formatDate(r.fields.datum)}</span>
                      )}
                    </>
                  ),
                  action: {
                    label: tx('Starten'),
                    onClick: () => advanceStatus(r.record_id, 'in_bearbeitung'),
                  },
                }))}
              onItemClick={id => {
                const rec = testererfassung.find(r => r.record_id === id);
                if (rec) crud.testererfassung.openDetail(rec);
              }}
              empty={{
                text: total === 0
                  ? tx('Noch kein Test erfasst.')
                  : tx('Alle Tests im Zeitplan — super!'),
                action: total === 0
                  ? { label: tx('Ersten Test anlegen'), onClick: () => crud.testererfassung.openCreate({ status: 'offen' }) }
                  : undefined,
              }}
            />
            <WorkList
              title={tx('Zuletzt abgeschlossen')}
              items={abgeschlossen
                .sort((a, b) => (b.fields.datum ?? '').localeCompare(a.fields.datum ?? ''))
                .slice(0, 5)
                .map(r => ({
                  id: r.record_id,
                  title: r.fields.titel ?? tx('Ohne Titel'),
                  secondLine: (
                    <>
                      {r.fields.bestanden === true
                        ? <span className="font-medium text-emerald-600">{tx('Bestanden')}</span>
                        : r.fields.bestanden === false
                          ? <span className="font-medium text-destructive">{tx('Nicht bestanden')}</span>
                          : <span className="text-muted-foreground">{tx('Abgeschlossen')}</span>}
                      {r.fields.datum && (
                        <span className="text-muted-foreground"> · {formatDate(r.fields.datum)}</span>
                      )}
                    </>
                  ),
                }))}
              onItemClick={id => {
                const rec = testererfassung.find(r => r.record_id === id);
                if (rec) crud.testererfassung.openDetail(rec);
              }}
              empty={{
                text: tx('Noch kein Test abgeschlossen.'),
              }}
            />
          </>
        }
      />

      {crud.surfaces}
    </div>
  );
}
