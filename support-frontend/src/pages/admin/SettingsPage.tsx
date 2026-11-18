import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, Settings01Icon } from '@hugeicons/core-free-icons';
import { settingsApi } from '../../api/admin';
import type { SettingEntry } from '../../api/types';
import { useReauth } from '../../auth/reauth';
import { ErrorState } from '../../components/display/ErrorState';
import { ReasonDialog } from '../../components/ReasonDialog';
import { toast } from '../../components/toast';
import { Badge, Button, EmptyState, Input, PageHeader, Panel, PanelHeader, Select, Skeleton, Switch } from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatRelative } from '../../lib/format';

type Kind = 'bool' | 'number' | 'select' | 'hours3' | 'killswitch' | 'always';

interface SettingDef {
  key: string;
  label: string;
  help?: string;
  kind: Kind;
  unit?: string;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  /** CONTRACT §5 default, shown while the key has never been saved. */
  fallback?: unknown;
}

interface Section {
  id: string;
  title: string;
  description?: string;
  settings: SettingDef[];
}

/** CONTRACT.md §5, grouped and worded for the support admin. */
export const SECTIONS: Section[] = [
  {
    id: 'approval',
    title: 'Double validation',
    description: 'Ces actions demandent l’accord d’un second agent, différent du demandeur.',
    settings: [
      { key: 'approval.regularization', label: 'Régularisations de retrait', kind: 'always', fallback: 'always', help: 'Toujours exigée : ce réglage ne se désactive pas.' },
      { key: 'approval.manualActivation', label: 'Activations manuelles', kind: 'always', fallback: 'always', help: 'Toujours exigée : ce réglage ne se désactive pas.' },
      { key: 'approval.contactChange', label: 'Changements d’e-mail ou de téléphone', kind: 'always', fallback: 'always', help: 'Toujours exigée : ce réglage ne se désactive pas.' },
      { key: 'approval.withdrawalManualCompleteAbove', label: 'Finalisation manuelle d’un retrait au-delà de', kind: 'number', unit: 'F', min: 0, fallback: 50000 },
    ],
  },
  {
    id: 'finance',
    title: 'Finance',
    settings: [
      { key: 'finance.alertHours', label: 'Seuils d’un retrait bloqué', help: 'En heures : alerte, puis dossier au responsable financier, puis alerte critique.', kind: 'hours3', fallback: [24, 48, 72] },
    ],
  },
  {
    id: 'views',
    title: 'Vérifications des vues',
    settings: [
      {
        key: 'views.assignmentMode', label: 'Mode d’affectation', kind: 'select',
        options: [
          { value: 'round_robin', label: 'Tourniquet' },
          { value: 'load', label: 'Selon la charge' },
          { value: 'manual', label: 'Manuel (superviseur)' },
        ],
        fallback: 'round_robin',
      },
      { key: 'views.unstartedRequeueMinutes', label: 'Remise en file d’une tâche non commencée après', kind: 'number', unit: 'min', min: 1, fallback: 10 },
      { key: 'views.idleAlertMinutes', label: 'Alerte d’inactivité après', kind: 'number', unit: 'min', min: 1, fallback: 15 },
      { key: 'views.qaSamplePercent', label: 'Contrôle qualité par échantillon', kind: 'number', unit: '%', min: 0, max: 100, fallback: 5 },
    ],
  },
  {
    id: 'tickets',
    title: 'Tickets',
    settings: [
      { key: 'tickets.autoCloseResolvedDays', label: 'Fermeture d’un ticket résolu sans réponse après', kind: 'number', unit: 'j', min: 1, fallback: 7 },
    ],
  },
  {
    id: 'assistant',
    title: 'Assistant',
    settings: [
      { key: 'assistant.dailyQuestionsPerMember', label: 'Questions par membre et par jour', kind: 'number', min: 0, fallback: 20 },
      { key: 'assistant.monthlyBudgetUsd', label: 'Budget mensuel', kind: 'number', unit: '$', min: 0, fallback: 30 },
    ],
  },
  {
    id: 'killswitch',
    title: 'Interrupteurs d’arrêt',
    description: 'Activé = l’automatisme est ARRÊTÉ. À utiliser en cas d’incident : l’effet est immédiat, sans redéploiement.',
    settings: [
      { key: 'killswitch.autoActivation', label: 'Activation automatique après paiement', kind: 'killswitch', fallback: false },
      { key: 'killswitch.autoWithdrawalFinalize', label: 'Finalisation automatique des retraits', kind: 'killswitch', fallback: false },
      { key: 'killswitch.reconciliation', label: 'Rapprochement automatique', kind: 'killswitch', fallback: false },
      { key: 'killswitch.deepseek', label: 'Assistant IA (DeepSeek)', kind: 'killswitch', fallback: true },
      { key: 'killswitch.autoAssignment', label: 'Affectation automatique des vérifications', kind: 'killswitch', fallback: false },
    ],
  },
];

const KNOWN = new Set(SECTIONS.flatMap(s => s.settings.map(d => d.key)));

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The value as shown to a person (switches in words). */
function describe(def: SettingDef, v: unknown): string {
  if (def.kind === 'bool') return v ? 'oui' : 'non';
  if (def.kind === 'killswitch') return v ? 'arrêté' : 'en marche';
  if (def.kind === 'select') return def.options?.find(o => o.value === v)?.label ?? String(v);
  if (def.kind === 'hours3' && Array.isArray(v)) return v.map(h => `${h} h`).join(' / ');
  return `${v ?? '—'}${def.unit ? ` ${def.unit}` : ''}`;
}

function invalid(def: SettingDef, v: unknown): string | null {
  if (def.kind === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return 'Entrez un nombre.';
    if (def.min != null && v < def.min) return `Minimum ${def.min}.`;
    if (def.max != null && v > def.max) return `Maximum ${def.max}.`;
  }
  if (def.kind === 'hours3') {
    if (!Array.isArray(v) || v.length !== 3 || v.some(h => typeof h !== 'number' || !(h > 0))) return 'Trois durées en heures, supérieures à 0.';
    if (!(v[0] < v[1] && v[1] < v[2])) return 'Les trois seuils doivent aller croissant.';
  }
  return null;
}

function SettingRow({ def, entry, onSave }: { def: SettingDef; entry?: SettingEntry; onSave: (def: SettingDef, value: unknown) => void }) {
  const current = entry ? entry.value : def.fallback;
  const [draft, setDraft] = useState<unknown>(current);
  useEffect(() => { setDraft(current); }, [current]);
  const changed = !same(draft, current);
  const err = changed ? invalid(def, draft) : null;
  const id = `setting-${def.key}`;
  const isSwitch = def.kind === 'bool' || def.kind === 'killswitch';
  const killOn = def.kind === 'killswitch' && current === true;

  const control = (() => {
    switch (def.kind) {
      case 'always':
        // Fixed on the server (support-service settings accept only 'always'): shown, never edited.
        return <span className="text-sm font-medium text-fg">Toujours</span>;
      case 'bool':
      case 'killswitch':
        return <Switch id={id} checked={draft === true} onCheckedChange={v => setDraft(v)} aria-label={def.label} className={def.kind === 'killswitch' ? 'data-[state=checked]:bg-danger' : undefined} />;
      case 'select':
        return <Select id={id} value={typeof draft === 'string' ? draft : undefined} onValueChange={setDraft} options={def.options ?? []} className="sm:w-56" />;
      case 'hours3': {
        const arr = Array.isArray(draft) ? (draft as number[]) : [24, 48, 72];
        const labels = ['Alerte', 'Dossier au responsable', 'Critique'];
        return (
          <div className="grid grid-cols-3 gap-2 sm:w-80">
            {labels.map((l, i) => (
              <label key={l} className="flex flex-col justify-end gap-1 text-xs text-fg-muted">
                {l}
                <Input type="number" inputMode="numeric" min={1} value={arr[i] ?? ''} aria-label={`${l} (heures)`}
                  onChange={e => { const next = [...arr]; next[i] = e.target.value === '' ? NaN : Number(e.target.value); setDraft(next); }} />
              </label>
            ))}
          </div>
        );
      }
      default:
        return (
          <div className="flex items-center gap-2">
            <Input id={id} type="number" inputMode="decimal" className="w-36" min={def.min} max={def.max}
              value={typeof draft === 'number' && Number.isFinite(draft) ? draft : ''}
              onChange={e => setDraft(e.target.value === '' ? NaN : Number(e.target.value))} />
            {def.unit && <span className="text-sm text-fg-muted">{def.unit}</span>}
          </div>
        );
    }
  })();

  return (
    <li className={cn('flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between', killOn && 'bg-danger-soft')}>
      <div className="min-w-0 flex-1">
        <label htmlFor={isSwitch || def.kind === 'number' || def.kind === 'select' ? id : undefined} className="text-sm font-medium text-fg">{def.label}</label>
        {def.help && <p className="mt-0.5 text-xs text-fg-muted">{def.help}</p>}
        {killOn && (
          <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-danger">
            <HugeiconsIcon icon={Alert02Icon} size={14} aria-hidden="true" /> Automatisme arrêté
          </p>
        )}
        <p className="mt-1 text-xs text-fg-subtle">
          {entry ? <>Valeur actuelle : {describe(def, current)}{entry.updatedAt && <> · modifiée {formatRelative(entry.updatedAt)}{entry.updatedBy ? ` par ${entry.updatedBy.name}` : ''}</>}</> : <>Pas encore enregistrée : valeur par défaut ({describe(def, def.fallback)}).</>}
        </p>
        {err && <p className="mt-1 text-xs text-danger">{err}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {control}
        {changed && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setDraft(current)}>Annuler</Button>
            <Button size="sm" variant={def.kind === 'killswitch' ? 'danger' : 'primary'} disabled={!!err} onClick={() => onSave(def, draft)}>Enregistrer</Button>
          </>
        )}
      </div>
    </li>
  );
}

/** Support settings and kill switches (CONTRACT §5); every change has a reason, a code, and an audit line. */
export default function SettingsPage() {
  const reauth = useReauth();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: settingsApi.list });
  const [pending, setPending] = useState<{ def: SettingDef; value: unknown } | null>(null);
  const byKey = useMemo(() => new Map((settings.data ?? []).map(s => [s.key, s])), [settings.data]);
  const others = (settings.data ?? []).filter(s => !KNOWN.has(s.key));

  return (
    <>
      <PageHeader title="Réglages" description="Seuils, délais et interrupteurs d’arrêt. Chaque modification demande un motif et votre code, et entre au journal d’audit." />
      {settings.isError ? (
        <Panel><ErrorState error={settings.error} onRetry={() => settings.refetch()} retrying={settings.isFetching} /></Panel>
      ) : settings.isLoading ? (
        <div className="space-y-4">{[0, 1, 2].map(i => <Skeleton key={i} className="h-40 w-full" />)}</div>
      ) : (
        <div className="space-y-6">
          {SECTIONS.map(section => (
            <Panel key={section.id} className={section.id === 'killswitch' ? 'border-danger/40' : undefined}>
              <PanelHeader
                title={section.title}
                description={section.description}
                actions={section.id === 'killswitch' && section.settings.some(d => byKey.get(d.key)?.value === true)
                  ? <Badge tone="danger">Automatisme arrêté</Badge> : undefined}
              />
              <ul className="divide-y divide-line border-t border-line">
                {section.settings.map(def => <SettingRow key={def.key} def={def} entry={byKey.get(def.key)} onSave={(d, v) => setPending({ def: d, value: v })} />)}
              </ul>
            </Panel>
          ))}
          {others.length > 0 && (
            <Panel>
              <PanelHeader title="Autres" description="Réglages que cet écran ne sait pas encore modifier (lecture seule)." />
              <ul className="divide-y divide-line border-t border-line">
                {others.map(s => (
                  <li key={s.key} className="px-5 py-3">
                    <p className="font-mono text-xs text-fg">{s.key}</p>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-control bg-surface-2 p-2 font-mono text-xs text-fg-muted">{JSON.stringify(s.value, null, 2)}</pre>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {!settings.data?.length && <EmptyState icon={Settings01Icon} title="Aucun réglage enregistré" description="Les valeurs par défaut du service s’appliquent." />}
        </div>
      )}

      <ReasonDialog
        open={!!pending}
        onOpenChange={o => { if (!o) setPending(null); }}
        title={pending ? `Modifier : ${pending.def.label}` : ''}
        description={pending ? `Nouvelle valeur : ${describe(pending.def, pending.value)}.` : undefined}
        confirmLabel="Enregistrer"
        tone={pending?.def.kind === 'killswitch' ? 'danger' : 'primary'}
        onConfirm={async reason => {
          const p = pending!;
          const token = await reauth({ title: 'Modifier un réglage' });
          await settingsApi.save(p.def.key, p.value, reason, token);
          toast.success('Réglage enregistré.');
          await queryClient.invalidateQueries({ queryKey: ['settings'] });
        }}
      />
    </>
  );
}
