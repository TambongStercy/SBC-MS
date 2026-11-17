import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getModuleConfig, updateModuleConfig, type ModuleConfig } from '../../services/adminSbcLoveApi';
import { Button, Field, Input, Panel, PanelBody, PanelHeader, Select, Skeleton, Switch } from '../ui';
import { Can } from '../Can';
import { usePermission } from '../../hooks/usePermission';
import { ErrorState, Notice, formatDateTime } from '../moduleKit';
import { WEEKDAY_LABELS } from './labels';

type Draft = Pick<ModuleConfig, 'enabled' | 'autoApprove' | 'activeWeekday' | 'openHour' | 'closeHour' | 'timezone' | 'maxInterestsPerWeek' | 'autoSuspendThreshold'>;
const pickDraft = (c: ModuleConfig): Draft => ({
  enabled: c.enabled, autoApprove: c.autoApprove, activeWeekday: c.activeWeekday, openHour: c.openHour, closeHour: c.closeHour,
  timezone: c.timezone, maxInterestsPerWeek: c.maxInterestsPerWeek, autoSuspendThreshold: c.autoSuspendThreshold,
});

/** Integer in [min, max], else an error message. */
const checkInt = (v: number, min: number, max?: number) =>
  !Number.isInteger(v) || v < min || (max != null && v > max) ? (max != null ? `Entre ${min} et ${max}.` : `${min} au minimum.`) : undefined;

function ToggleRow({ title, help, checked, onChange, disabled }: { title: string; help: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 px-5 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className="block text-xs text-fg-muted">{help}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={title} />
    </label>
  );
}

/**
 * Module settings. The API takes any value unvalidated (CLAUDE.md), so the
 * form checks ranges before saving.
 */
export function ConfigTab() {
  const qc = useQueryClient();
  const canWrite = usePermission('sbclove') === 'write';
  const query = useQuery({ queryKey: ['sbclove', 'config'], queryFn: getModuleConfig });
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => { if (query.data) setDraft(pickDraft(query.data)); }, [query.data]);

  const save = useMutation({
    mutationFn: (d: Draft) => updateModuleConfig({ ...d, timezone: d.timezone.trim() }),
    onSuccess: updated => {
      toast.success('Réglages de SBC Love enregistrés.');
      qc.setQueryData(['sbclove', 'config'], updated);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'Les réglages n’ont pas pu être enregistrés.'),
  });

  const errors = useMemo(() => !draft ? {} : {
    openHour: checkInt(draft.openHour, 0, 23),
    closeHour: checkInt(draft.closeHour, 0, 23),
    timezone: draft.timezone.trim() ? undefined : 'Indiquez un fuseau (ex. Africa/Douala).',
    maxInterestsPerWeek: checkInt(draft.maxInterestsPerWeek, 1),
    autoSuspendThreshold: checkInt(draft.autoSuspendThreshold, 1),
  }, [draft]);
  const invalid = Object.values(errors).some(Boolean);
  const dirty = !!draft && !!query.data && JSON.stringify(draft) !== JSON.stringify(pickDraft(query.data));

  if (query.isLoading || (!draft && !query.isError)) {
    return <div className="space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }
  if (query.isError || !draft || !query.data) {
    return <Panel><ErrorState title="Les réglages n’ont pas pu être chargés" error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} /></Panel>;
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => (d ? { ...d, [k]: v } : d));
  const num = (v: string) => (v === '' ? NaN : Number(v));
  const ro = !canWrite;

  return (
    <div className="space-y-4">
      {ro && <Notice tone="info">Lecture seule : vous pouvez consulter ces réglages mais pas les modifier.</Notice>}

      <Panel className="divide-y divide-line">
        <ToggleRow title="Module actif" help="Ouvre ou ferme SBC Love pour tous les membres." checked={draft.enabled} onChange={v => set('enabled', v)} disabled={ro} />
        <ToggleRow title="Approbation automatique" help="Les profils sont approuvés sans passer par la validation." checked={draft.autoApprove} onChange={v => set('autoApprove', v)} disabled={ro} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Fenêtre d’ouverture"
            description={`Ouvert chaque ${WEEKDAY_LABELS[draft.activeWeekday]?.toLowerCase() ?? '—'}, de ${draft.openHour} h à ${draft.closeHour} h (${draft.timezone || 'fuseau non défini'}).`}
          />
          <PanelBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Jour" className="sm:col-span-2">
              <Select value={String(draft.activeWeekday)} onValueChange={v => set('activeWeekday', Number(v))} disabled={ro}
                options={WEEKDAY_LABELS.map((d, i) => ({ value: String(i), label: d }))} className="h-11 sm:h-9" />
            </Field>
            <Field label="Ouverture (heure)" error={errors.openHour}>
              <Input type="number" inputMode="numeric" min={0} max={23} value={Number.isNaN(draft.openHour) ? '' : draft.openHour}
                onChange={e => set('openHour', num(e.target.value))} disabled={ro} className="h-11 sm:h-9" />
            </Field>
            <Field label="Fermeture (heure)" error={errors.closeHour}>
              <Input type="number" inputMode="numeric" min={0} max={23} value={Number.isNaN(draft.closeHour) ? '' : draft.closeHour}
                onChange={e => set('closeHour', num(e.target.value))} disabled={ro} className="h-11 sm:h-9" />
            </Field>
            <Field label="Fuseau horaire" error={errors.timezone} className="sm:col-span-2">
              <Input value={draft.timezone} onChange={e => set('timezone', e.target.value)} placeholder="Africa/Douala" disabled={ro} className="h-11 sm:h-9" />
            </Field>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Quotas et seuils" description="Limites appliquées à chaque membre." />
          <PanelBody className="grid gap-4">
            <Field label="Intérêts par semaine (maximum)" error={errors.maxInterestsPerWeek}>
              <Input type="number" inputMode="numeric" min={1} value={Number.isNaN(draft.maxInterestsPerWeek) ? '' : draft.maxInterestsPerWeek}
                onChange={e => set('maxInterestsPerWeek', num(e.target.value))} disabled={ro} className="h-11 sm:h-9" />
            </Field>
            <Field label="Suspension automatique après (signalements)" error={errors.autoSuspendThreshold}
              help="Un profil est suspendu dès qu’il atteint ce nombre de signalements.">
              <Input type="number" inputMode="numeric" min={1} value={Number.isNaN(draft.autoSuspendThreshold) ? '' : draft.autoSuspendThreshold}
                onChange={e => set('autoSuspendThreshold', num(e.target.value))} disabled={ro} className="h-11 sm:h-9" />
            </Field>
          </PanelBody>
        </Panel>
      </div>

      <Can module="sbclove" write>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {query.data.updatedAt && (
            <p className="text-xs text-fg-muted sm:mr-auto">
              Dernière modification : {formatDateTime(query.data.updatedAt)}{query.data.updatedBy ? ` par ${query.data.updatedBy}` : ''}
            </p>
          )}
          {dirty && <Button variant="ghost" size="lg" onClick={() => setDraft(pickDraft(query.data))} disabled={save.isPending}>Annuler les modifications</Button>}
          <Button variant="primary" size="lg" loading={save.isPending} disabled={!dirty || invalid} onClick={() => save.mutate(draft)}>
            Enregistrer
          </Button>
        </div>
      </Can>
    </div>
  );
}
