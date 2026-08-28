import type { Testererfassung } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';
import {
  RecordSection, RecordField, RecordRelation, RecordAttachments,
} from '@/components/widgets/RecordView';
import { t, appLabel, fieldLabel } from '@/i18n';

export interface TestererfassungDetailsProps {
  /** Der Record — enriched oder roh; alle Felder werden hier gerendert. */
  record: Testererfassung;
}

export function TestererfassungDetails({
  record,
}: TestererfassungDetailsProps) {
  return (
    <>
      <RecordSection title={t('details')} cols={2}>
        <RecordField label={fieldLabel('testererfassung', 'titel')} value={record.fields.titel} format="text" />
        <RecordField label={fieldLabel('testererfassung', 'beschreibung')} value={record.fields.beschreibung} format="longtext" className="md:col-span-2" />
        <RecordField label={fieldLabel('testererfassung', 'datum')} value={record.fields.datum} format="date" />
        <RecordField label={fieldLabel('testererfassung', 'status')} value={record.fields.status} format="pill" />
        <RecordField label={fieldLabel('testererfassung', 'ergebnis')} value={record.fields.ergebnis} format="longtext" className="md:col-span-2" />
        <RecordField label={fieldLabel('testererfassung', 'bestanden')} value={record.fields.bestanden} format="bool" />
      </RecordSection>

      <RecordAttachments appId={APP_IDS.TESTERERFASSUNG} recordId={record.record_id} />
    </>
  );
}
