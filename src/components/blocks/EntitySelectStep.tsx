import { useState, useMemo, type ReactNode } from 'react';
import { IconSearch, IconChevronRight, IconPlus } from '@tabler/icons-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getStatusColor } from '@/components/blocks/StatusBadge';
import { t } from '@/i18n';

interface SelectItem {
  id: string;
  title: string;
  subtitle?: string;
  status?: { key: string; label: string };
  stats?: { label: string; value: string | number }[];
  icon?: React.ReactNode;
}

interface EntitySelectStepProps {
  items: SelectItem[];
  onSelect: (id: string) => void;
  searchPlaceholder?: string;
  emptyIcon?: React.ReactNode;
  emptyText?: string;
  /** Label for the "create new" button. If set, the button is shown above the list. */
  createLabel?: string;
  /** Called when the "create new" button is clicked. Use this to reveal the
   *  step's own mini-form (never the generic {Entity}Dialog). */
  onCreateNew?: () => void;
  /** Optional: render the mini-form panel alongside the list. */
  createDialog?: ReactNode;
}

export function EntitySelectStep({
  items,
  onSelect,
  // Destructuring defaults are evaluated on every render, so these follow a
  // language switch without any extra wiring.
  searchPlaceholder = t('search'),
  emptyIcon,
  emptyText = t('no_results'),
  createLabel,
  onCreateNew,
  createDialog,
}: EntitySelectStepProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(item =>
      item.title.toLowerCase().includes(q) ||
      (item.subtitle ?? '').toLowerCase().includes(q)
    );
  }, [items, search]);

  return (
    <div className="space-y-3">
      {/* Search + Create New row */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {onCreateNew && (
          <Button variant="outline" onClick={onCreateNew} className="shrink-0 gap-1.5">
            <IconPlus size={15} />
            {createLabel ?? t('step_create_new')}
          </Button>
        )}
      </div>

      {/* createDialog slot — the step's own inline mini-form (never the
          generic {Entity}Dialog; check-intents fails the build on that import) */}
      {createDialog}

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {emptyIcon && <div className="mb-3 flex justify-center opacity-40">{emptyIcon}</div>}
          <p className="text-sm">{emptyText}</p>
          {onCreateNew && (
            <Button variant="outline" size="sm" onClick={onCreateNew} className="mt-3 gap-1.5">
              <IconPlus size={14} />
              {createLabel ?? t('step_create_new')}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(item => (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className="w-full text-left flex items-center gap-3 p-4 rounded-xl border bg-card hover:bg-accent hover:border-primary/30 transition-colors overflow-hidden group"
            >
              {item.icon && (
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  {item.icon}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                    {item.title}
                  </span>
                  {item.status && (
                    // Colours come from StatusBadge's single table (getStatusColor)
                    // so a status looks the same here as on its badge. Its classes
                    // include a border-* colour, which stays inert without a
                    // `border` width utility — this pill deliberately has none.
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${getStatusColor(item.status.key)}`}>
                      {item.status.label}
                    </span>
                  )}
                </div>
                {item.subtitle && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.subtitle}</p>
                )}
                {item.stats && item.stats.length > 0 && (
                  <div className="flex gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                    {item.stats.map((s, i) => (
                      <span key={i}>{s.label}: <span className="font-medium text-foreground">{s.value}</span></span>
                    ))}
                  </div>
                )}
              </div>
              <IconChevronRight size={16} className="text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
