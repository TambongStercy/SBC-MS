import { AnimatePresence, motion } from "framer-motion";
// Imported, not a "/src/..." string: that path only exists on the dev server,
// so the logo 404'd on every deployed build (preprod AND prod).
import logoSbc from "../assets/logo-sbc.png";
import { useNavigate } from "react-router-dom";
import { useState, FormEvent, useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { prepareRobotAnswer } from "../lib/robotCheck";
import { Button, Checkbox, Field, Input } from "../components/ui";
import {
  completeAdminTotp, confirmAdminEnrolment, startAdminEnrolment, verifyAdminEmailCode,
  type AdminEnrolment, type AdminSignedIn,
} from "../services/adminUserApi";

const ease = [0.22, 1, 0.36, 1] as const;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : '');

type Step = 'password' | 'email' | 'enroll' | 'totp' | 'backup';

const SUBMIT_LABEL: Record<Step, string> = {
  password: 'Se connecter',
  email: 'Valider le code',
  enroll: 'Activer et se connecter',
  totp: 'Se connecter',
  backup: 'Continuer',
};

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP": easier to type into an app by hand. */
const groupKey = (k: string) => k.replace(/(.{4})/g, '$1 ').trim();

function downloadCodes(codes: string[], email: string) {
  const text = [
    'Codes de secours — Administration SBC',
    `Compte : ${email}`,
    `Créés le : ${new Date().toLocaleString('fr-FR')}`,
    '',
    'Chaque code ne sert qu’une fois, à la place du code de l’application',
    'd’authentification (téléphone perdu ou changé).',
    '',
    ...codes,
  ].join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'codes-de-secours-sbc-admin.txt';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Sign-in, like the support desk: email + password, then the 6-digit code of
 * the authenticator app (Google Authenticator, Microsoft Authenticator, 2FAS…),
 * or a backup code. The first time, a code is emailed to the account, the
 * authenticator is set up from a QR code, and 10 backup codes are shown once.
 * The original identity is kept: the panning photo background (.background in
 * index.css) and the round SBC logo.
 */
function Login() {
  const navigate = useNavigate();
  const { login, finishLogin, isAdminAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [enrolment, setEnrolment] = useState<AdminEnrolment | null>(null);
  const [signedIn, setSignedIn] = useState<AdminSignedIn | null>(null);
  const [codesSaved, setCodesSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const enrolFor = useRef<string | null>(null);
  const loading = busy || isAuthLoading;

  useEffect(() => {
    if (isAdminAuthenticated) {
      navigate('/');
    }
  }, [isAdminAuthenticated, navigate]);

  // Security plan Phase 9: the anti-robot answer is solved while the admin types.
  useEffect(() => { prepareRobotAnswer(); }, []);

  // Set-up step: fetch the key and its QR code once per challenge.
  useEffect(() => {
    if (step !== 'enroll' || !challengeId || enrolFor.current === challengeId) return;
    enrolFor.current = challengeId;
    startAdminEnrolment(challengeId)
      .then(setEnrolment)
      .catch(error => {
        setErrorMessage(messageOf(error) || 'La configuration n’a pas pu démarrer. Recommencez la connexion.');
      });
  }, [step, challengeId]);

  const restart = () => {
    setStep('password'); setChallengeId(null); setCode(''); setUseBackup(false);
    setEnrolment(null); setSignedIn(null); setCodesSaved(false); setErrorMessage('');
    enrolFor.current = null;
  };

  const done = (session: AdminSignedIn) => {
    if (typeof session.backupCodesRemaining === 'number' && session.backupCodesRemaining <= 3) {
      toast.warning(`Il vous reste ${session.backupCodesRemaining} code${session.backupCodesRemaining > 1 ? 's' : ''} de secours. Créez-en de nouveaux dans « Sécurité du compte ».`, { duration: 10000 });
    }
    finishLogin(session);
  };

  /** A refused code ends the challenge after 5 tries: the server then answers the same refusal forever. */
  const run = async (fn: () => Promise<void>) => {
    setErrorMessage('');
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      setErrorMessage(messageOf(error) || 'Code invalide ou expiré');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (step === 'password') {
      setErrorMessage('');
      if (!email) { setErrorMessage("L'email est requis"); return; }
      if (!password) { setErrorMessage('Le mot de passe est requis'); return; }
      try {
        const next = await login({ email, password });
        setChallengeId(next.challengeId);
        setCode('');
        setStep(next.step);
      } catch (error) {
        setErrorMessage(messageOf(error) || 'Connexion refusée. Vérifiez vos identifiants.');
      }
      return;
    }
    if (!challengeId) return;
    if (step === 'backup') {
      if (signedIn) done(signedIn);
      return;
    }
    const value = code.trim();
    if (!value) {
      setErrorMessage(step === 'email' ? 'Entrez le code reçu par email' : useBackup ? 'Entrez un code de secours' : 'Entrez le code à 6 chiffres de l’application');
      return;
    }
    if (step === 'email') {
      await run(async () => {
        const next = await verifyAdminEmailCode(challengeId, value);
        setChallengeId(next.challengeId);
        setCode('');
        setStep('enroll');
      });
    } else if (step === 'enroll') {
      await run(async () => {
        const session = await confirmAdminEnrolment(challengeId, value.replace(/\s/g, ''));
        setSignedIn(session);
        setCode('');
        setStep('backup');
      });
    } else if (step === 'totp') {
      await run(async () => {
        const session = await completeAdminTotp(challengeId, useBackup ? { backupCode: value } : { code: value.replace(/\s/g, '') });
        done(session);
      });
    }
  };

  const copyCodes = async () => {
    if (!signedIn?.backupCodes) return;
    try {
      await navigator.clipboard.writeText(signedIn.backupCodes.join('\n'));
      toast.success('Codes copiés.');
    } catch {
      toast.error('La copie a échoué : notez-les ou téléchargez-les.');
    }
  };

  const digitsInput = (label: string, help?: ReactNode) => (
    <Field label={label} help={help}>
      <Input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={7}
        placeholder="123456"
        className="h-11 font-mono text-base tracking-[0.3em]"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        disabled={loading}
        autoFocus
        data-openreplay-hidden=""
      />
    </Field>
  );

  const backLink = (
    <button
      type="button"
      className="self-start text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline disabled:opacity-50"
      onClick={restart}
      disabled={loading}
    >
      Retour
    </button>
  );

  const panes: Record<Step, ReactNode> = {
    password: (
      <>
        <Field label="E-mail">
          <Input
            type="email"
            autoComplete="username"
            placeholder="admin@exemple.com"
            className="h-11 text-base md:text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
          />
        </Field>
        <Field label="Mot de passe">
          <Input
            type="password"
            autoComplete="current-password"
            className="h-11 text-base md:text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />
        </Field>
      </>
    ),
    email: (
      <>
        <p className="text-sm text-fg-muted">
          Première connexion avec l’application d’authentification. Pour commencer, un code a été envoyé à{' '}
          <span className="font-medium break-all text-fg">{email}</span>.
        </p>
        <Field label="Code reçu par email">
          <Input
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            autoCapitalize="off"
            placeholder="Code à 6 caractères"
            className="h-11 font-mono text-base tracking-[0.3em]"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={loading}
            autoFocus
            data-openreplay-hidden=""
          />
        </Field>
        {backLink}
      </>
    ),
    enroll: (
      <>
        <div className="space-y-1 text-sm text-fg-muted">
          <p className="font-medium text-fg">Configurez votre application d’authentification</p>
          <p>
            Dans Google Authenticator, Microsoft Authenticator ou 2FAS, ajoutez un compte et scannez ce code.
            Elle affichera ensuite un code à 6 chiffres qui change toutes les 30 secondes.
          </p>
        </div>
        {enrolment ? (
          <div className="flex flex-col items-center gap-3">
            <img src={enrolment.qrDataUrl} alt="QR code à scanner avec l’application d’authentification" className="h-48 w-48 rounded-control bg-white p-2" />
            <div className="w-full text-center">
              <p className="text-xs text-fg-muted">Impossible de scanner ? Saisissez cette clé :</p>
              <p className="mt-1 select-all break-all font-mono text-sm text-fg" data-openreplay-hidden="">{groupKey(enrolment.secret)}</p>
            </div>
          </div>
        ) : (
          !errorMessage && <p className="text-sm text-fg-muted">Préparation du code…</p>
        )}
        {digitsInput('Code affiché par l’application')}
        {backLink}
      </>
    ),
    totp: (
      <>
        {useBackup ? (
          <Field label="Code de secours" help="Un des 10 codes reçus à la configuration. Chacun ne sert qu’une fois.">
            <Input
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="XXXX-XXXX-XXXX"
              className="h-11 font-mono text-base tracking-widest"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={loading}
              autoFocus
              data-openreplay-hidden=""
            />
          </Field>
        ) : (
          digitsInput('Code de l’application d’authentification', 'Ouvrez l’application sur votre téléphone : code « SBC Admin ».')
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {backLink}
          <button
            type="button"
            className="text-sm text-primary underline-offset-4 hover:underline disabled:opacity-50"
            onClick={() => { setUseBackup(v => !v); setCode(''); setErrorMessage(''); }}
            disabled={loading}
          >
            {useBackup ? 'Utiliser l’application' : 'Téléphone perdu ? Code de secours'}
          </button>
        </div>
      </>
    ),
    backup: (
      <>
        <div className="space-y-1 text-sm text-fg-muted">
          <p className="font-medium text-fg">Vos codes de secours</p>
          <p>
            Si vous perdez votre téléphone, chacun de ces codes remplace une fois le code de l’application.
            Gardez-les hors de ce téléphone (papier, gestionnaire de mots de passe). Ils ne seront plus affichés.
          </p>
        </div>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-control border border-line bg-surface-2 p-3 font-mono text-sm text-fg" data-openreplay-hidden="">
          {signedIn?.backupCodes?.map(c => <li key={c} className="select-all">{c}</li>)}
        </ul>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={() => void copyCodes()}>Copier</Button>
          <Button type="button" variant="outline" onClick={() => signedIn?.backupCodes && downloadCodes(signedIn.backupCodes, email)}>Télécharger</Button>
        </div>
        <label className="flex cursor-pointer items-start gap-3 text-sm text-fg">
          <Checkbox checked={codesSaved} onCheckedChange={v => setCodesSaved(v === true)} className="mt-0.5" />
          J’ai mis ces codes en lieu sûr.
        </label>
      </>
    ),
  };

  return (
    <main className="background flex h-dvh w-full items-center justify-center overflow-y-auto px-4 py-8 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      {/* Darkens the photo a little so the card reads in both themes */}
      <div className="pointer-events-none fixed inset-0 bg-black/30" aria-hidden="true" />

      <motion.div
        className="relative my-auto w-full max-w-sm rounded-panel border border-line bg-surface/85 p-6 backdrop-blur-md sm:p-8"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease }}
      >
        <motion.div
          className="mb-6 flex items-center gap-3"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease }}
        >
          <img className="h-16 w-16 shrink-0 rounded-full object-cover" src={logoSbc} alt="Logo SBC" />
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-primary">Administration</p>
            <h1 className="text-lg font-semibold leading-snug text-fg">Sniper Business Center</h1>
          </div>
        </motion.div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <AnimatePresence initial={false}>
            {errorMessage && (
              <motion.div
                key="error"
                role="alert"
                className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {errorMessage}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              className="flex flex-col gap-4"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.25, ease }}
            >
              {panes[step]}
            </motion.div>
          </AnimatePresence>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3, ease }}
          >
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="mt-2 w-full"
              loading={loading}
              disabled={(step === 'backup' && !codesSaved) || (step === 'enroll' && !enrolment)}
            >
              {loading ? 'Connexion…' : SUBMIT_LABEL[step]}
            </Button>
          </motion.div>
        </form>
      </motion.div>
    </main>
  );
}

export default Login;
