import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { APP_IDS } from '@/types/app';
import { createRecordUrl } from '@/services/livingAppsService';
import { t } from '@/i18n';

interface FieldDef {
  key: string;
  label: string;
  type: string;
  options?: Array<{ key: string; label: string }>;
  targetEntity?: string;
  targetAppId?: string;
  displayField?: string;
}

interface BulkEditDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (fieldKey: string, value: any) => Promise<void>;
  fields: FieldDef[];
  selectedCount: number;
  loading?: boolean;
  lookupLists?: Record<string, any[]>;
}

export function BulkEditDialog({ open, onClose, onApply, fields, selectedCount, loading, lookupLists }: BulkEditDialogProps) {
  const [selectedField, setSelectedField] = useState('');
  const [value, setValue] = useState<any>('');

  useEffect(() => {
    if (open) { setSelectedField(''); setValue(''); }
  }, [open]);

  const editableFields = fields.filter(f => !f.type.startsWith('file') && f.type !== 'geo');
  const currentField = editableFields.find(f => f.key === selectedField);

  function handleFieldChange(key: string) {
    setSelectedField(key);
    const f = editableFields.find(fd => fd.key === key);
    if (f?.type === 'bool') setValue(false);
    else if (f?.type.includes('applookup')) setValue('none');
    else if (f?.type === 'number') setValue('');
    else setValue('');
  }

  async function handleApply() {
    if (!selectedField) return;
    let finalValue: any = value;
    if (currentField?.type === 'number') finalValue = Number(value);
    if (currentField?.type === 'bool') finalValue = Boolean(value);
    if (currentField?.type === 'lookup/select' || currentField?.type === 'lookup/radio') {
      const opt = currentField.options?.find(o => o.key === value);
      if (opt) finalValue = opt.key;
    }
    if (currentField?.type.includes('applookup') && currentField.targetAppId) {
      finalValue = value === 'none' ? null : createRecordUrl((APP_IDS as any)[currentField.targetAppId], value);
    }
    await onApply(selectedField, finalValue);
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('bulk_edit_title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t('choose_field')}</Label>
            <Select value={selectedField} onValueChange={handleFieldChange}>
              <SelectTrigger><SelectValue placeholder={t('select_placeholder')} /></SelectTrigger>
              <SelectContent>
                {editableFields.map(f => (
                  <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {currentField && (
            <div className="space-y-2">
              <Label>{t('new_value')}</Label>
              {currentField.type === 'bool' ? (
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={!!value}
                    onCheckedChange={v => setValue(v)}
                  />
                  <span className="text-sm">{value ? t('yes') : t('no')}</span>
                </div>
              ) : currentField.type === 'string/textarea' ? (
                <Textarea
                  value={value ?? ''}
                  onChange={e => setValue(e.target.value)}
                  rows={3}
                />
              ) : currentField.type === 'number' ? (
                <Input
                  type="number"
                  step="any"
                  value={value ?? ''}
                  onChange={e => setValue(e.target.value)}
                />
              ) : currentField.type === 'date/date' ? (
                <Input
                  type="date"
                  value={value ?? ''}
                  onChange={e => setValue(e.target.value)}
                />
              ) : currentField.type === 'date/datetimeminute' ? (
                <Input
                  type="datetime-local"
                  value={value ?? ''}
                  onChange={e => setValue(e.target.value)}
                />
              ) : (currentField.type === 'lookup/select' || currentField.type === 'lookup/radio') && currentField.options ? (
                <Select value={value ?? ''} onValueChange={v => setValue(v)}>
                  <SelectTrigger><SelectValue placeholder={t('select_placeholder')} /></SelectTrigger>
                  <SelectContent>
                    {currentField.options.map(o => (
                      <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : currentField.type.includes('applookup') && currentField.targetEntity ? (
                <Select value={value ?? 'none'} onValueChange={v => setValue(v)}>
                  <SelectTrigger><SelectValue placeholder={t('select_placeholder')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {(lookupLists?.[currentField.targetEntity + 'List'] ?? []).map((r: any) => (
                      <SelectItem key={r.record_id} value={r.record_id}>
                        {r.fields?.[currentField.displayField!] ?? r.record_id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={value ?? ''}
                  onChange={e => setValue(e.target.value)}
                />
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button onClick={handleApply} disabled={!selectedField || loading}>
            {loading ? t('applying') : t('apply_to_n', { n: selectedCount })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}