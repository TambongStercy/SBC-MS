import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Download04Icon } from '@hugeicons/core-free-icons';
import { errorMessage } from '../../api/http';
import { useAuth } from '../../auth/context';
import { Turnstile, TURNSTILE_SITE_KEY } from '../../auth/Turnstile';
import { CopyButton } from '../../components/CopyButton';
import { Button, Checkbox, Field, Input, Skeleton } from '../../components/ui';
import { downloadBlob } from '../../lib/download';
import { AuthLayout, FormError } from './AuthLayout';

const sixDigits = (v: string) => v.replace(/\D/g, '').slice(0, 6);

/** Login, then TOTP or first-time enrolment, then (once) the backup codes. */
export default function LoginPage() {
  const { state } = useAuth();
  return (
    <AuthLayout>
      {state.status === 'totp' ? <TotpStep key="totp" />
        : state.status === 'enroll' ? <EnrollStep key="enroll" />
        : state.status === 'backupCodes' ? <BackupCodesStep codes={state.backupCodes} />
        : <PasswordStep notice={state.status === 'anonymous' ? state.notice : undefined} />}
    </AuthLayout>
  );
}

function PasswordStep({ notice }: { notice?: string }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const needsTurnstile = !!TURNSTILE_SITE_KEY;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) { setError('Entrez votre e-mail et votre mot de passe.'); return; }
    if (needsTurnstile && !token) { setError('Patientez pendant la vérification anti-robot.'); return; }
    setBusy(true);
    try {
      await login(email.trim(), password, token ?? undefined);
    } catch (err) {
      // Same message whatever the reason (the server does the same).
      setError(errorMessage(err, 'Connexion refusée. Vérifiez vos identifiants.'));
      setPassword('');
      if (needsTurnstile) setResetKey(k => k + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Connexion">
      {notice && !error && <p role="status" className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-fg">{notice}</p>}
      <FormError message={error} />
      <Field label="E-mail">
        <Input type="email" autoComplete="username" className="h-11 text-base md:text-sm" value={email} onChange={e => setEmail(e.target.value)} disabled={busy} />
      </Field>
      <Field label="Mot de passe">
        <Input type="password" autoComplete="current-password" className="h-11 text-base md:text-sm" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />
      </Field>
      {needsTurnstile && <Turnstile onToken={setToken} resetKey={resetKey} onError={() => setError('La vérification anti-robot n’a pas pu se charger. Rechargez la page.')} />}
      <Button type="submit" variant="primary" size="lg" className="mt-2 w-full" loading={busy}>Se connecter</Button>
      <p className="text-xs text-fg-muted">Accès réservé aux agents du support SBC. Chaque connexion est journalisée.</p>
    </form>
  );
}

function TotpStep() {
  const { submitTotp, restart } = useAuth();
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const clean = useBackup ? code.trim() : sixDigits(code);
    if (useBackup ? clean.length < 6 : clean.length !== 6) {
      setError(useBackup ? 'Entrez un de vos codes de secours.' : 'Entrez les 6 chiffres de votre application.');
      return;
    }
    setBusy(true);
    try {
      await submitTotp(useBackup ? { backupCode: clean } : { code: clean });
    } catch (err) {
      setError(errorMessage(err, 'Code refusé.'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Code de connexion">
      <p className="text-sm text-fg-muted">
        {useBackup
          ? 'Entrez un de vos codes de secours. Chaque code ne sert qu’une fois.'
          : 'Ouvrez votre application d’authentification et entrez le code à 6 chiffres affiché pour SBC Support.'}
      </p>
      <FormError message={error} />
      <Field label={useBackup ? 'Code de secours' : 'Code de l’application'}>
        <Input
          key={useBackup ? 'backup' : 'totp'}
          autoFocus
          inputMode={useBackup ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoCapitalize="off"
          className="h-11 font-mono text-base tracking-[0.3em]"
          placeholder={useBackup ? 'xxxx-xxxx' : '123456'}
          value={code}
          onChange={e => setCode(useBackup ? e.target.value : sixDigits(e.target.value))}
          disabled={busy}
        />
      </Field>
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>Valider</Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => { setUseBackup(b => !b); setCode(''); setError(''); }}>
          {useBackup ? 'Utiliser le code de l’application' : 'Utiliser un code de secours'}
        </button>
        <button type="button" className="text-fg-muted underline-offset-4 hover:text-fg hover:underline" onClick={restart}>Recommencer</button>
      </div>
    </form>
  );
}

/** Secret key from otpauth://totp/Label?secret=XXXX&issuer=…, grouped by 4 for typing. */
export function manualKey(otpauthUrl: string): string {
  const m = /[?&]secret=([^&]+)/i.exec(otpauthUrl);
  const secret = m ? decodeURIComponent(m[1]).toUpperCase() : '';
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

function EnrollStep() {
  const { state, startEnroll, confirmEnroll, restart } = useAuth();
  const enrollment = state.status === 'enroll' ? state.enrollment : undefined;
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useMemo(() => (enrollment ? manualKey(enrollment.otpauthUrl) : ''), [enrollment]);

  useEffect(() => {
    if (enrollment) return;
    startEnroll().catch(err => setError(errorMessage(err, 'Impossible de préparer l’application. Recommencez la connexion.')));
  }, [enrollment, startEnroll]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (sixDigits(code).length !== 6) { setError('Entrez les 6 chiffres affichés par l’application.'); return; }
    setBusy(true);
    try {
      await confirmEnroll(sixDigits(code));
    } catch (err) {
      setError(errorMessage(err, 'Code refusé. Vérifiez l’heure de votre téléphone et réessayez.'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Activation de l’application d’authentification">
      <div>
        <h2 className="text-base font-semibold text-fg">Protégez votre compte</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Première connexion : installez une application d’authentification (Google Authenticator, Microsoft Authenticator, 2FAS…), puis scannez ce code.
        </p>
      </div>
      <FormError message={error} />
      {enrollment ? (
        <div className="flex flex-col items-center gap-3 rounded-panel border border-line bg-surface-2 p-4">
          {/* White frame: a QR code must stay dark-on-light to scan, in both themes. */}
          <img src={enrollment.qrDataUrl} alt="QR code à scanner avec l’application d’authentification" width={192} height={192} className="h-48 w-48 rounded-md bg-white p-2" />
          <div className="w-full text-center">
            <p className="text-xs text-fg-muted">Impossible de scanner ? Entrez cette clé à la main :</p>
            <p className="mt-1 break-all font-mono text-sm font-medium text-fg" data-testid="manual-key">{key}</p>
            <CopyButton text={key.replace(/\s/g, '')} label="Copier la clé" variant="ghost" className="mt-1" />
          </div>
        </div>
      ) : (
        !error && <Skeleton className="mx-auto h-48 w-48" />
      )}
      <Field label="Code affiché par l’application">
        <Input inputMode="numeric" autoComplete="one-time-code" className="h-11 font-mono text-base tracking-[0.3em]" placeholder="123456"
          value={code} onChange={e => setCode(sixDigits(e.target.value))} disabled={busy || !enrollment} />
      </Field>
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!enrollment}>Activer</Button>
      <button type="button" className="self-start text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline" onClick={restart}>Recommencer</button>
    </form>
  );
}

function BackupCodesStep({ codes }: { codes: string[] }) {
  const { backupCodesSaved } = useAuth();
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');
  const download = () => downloadBlob(
    new Blob([`SBC Support — codes de secours\nChaque code ne sert qu'une fois.\n\n${text}\n`], { type: 'text/plain;charset=utf-8' }),
    'sbc-support-codes-de-secours.txt',
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-fg">Vos codes de secours</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Si vous perdez votre téléphone, chacun de ces codes remplace une fois le code de l’application.
          Ils ne seront <strong className="font-semibold text-fg">plus jamais affichés</strong> : rangez-les maintenant dans un endroit sûr.
        </p>
      </div>
      <ol className="grid grid-cols-2 gap-2 rounded-panel border border-line bg-surface-2 p-4 font-mono text-sm" aria-label="Codes de secours">
        {codes.map(c => <li key={c} className="text-center text-fg">{c}</li>)}
      </ol>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={text} label="Copier les codes" />
        <Button type="button" size="sm" onClick={download}>
          <HugeiconsIcon icon={Download04Icon} size={14} aria-hidden="true" /> Télécharger
        </Button>
      </div>
      <label className="flex items-start gap-3 text-sm text-fg">
        <Checkbox checked={saved} onCheckedChange={v => setSaved(v === true)} className="mt-0.5" aria-label="J’ai rangé mes codes de secours" />
        <span>J’ai rangé mes codes de secours dans un endroit sûr.</span>
      </label>
      <Button type="button" variant="primary" size="lg" className="w-full" disabled={!saved} onClick={backupCodesSaved}>Continuer</Button>
    </div>
  );
}
