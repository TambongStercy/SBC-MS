import { AnimatePresence, motion } from "framer-motion";
// Imported, not a "/src/..." string: that path only exists on the dev server,
// so the logo 404'd on every deployed build (preprod AND prod).
import logoSbc from "../assets/logo-sbc.png";
import { useNavigate } from "react-router-dom";
import { useState, FormEvent, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { Button, Field, Input } from "../components/ui";

const ease = [0.22, 1, 0.36, 1] as const;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : '');

/**
 * Sign-in, in two steps: email + password (loginAdmin), then the code emailed
 * to the admin (verifyLoginCode). The original identity is kept: the panning
 * photo background (.background in index.css) and the round SBC logo.
 */
function Login() {
  const navigate = useNavigate();
  const { login, verifyLoginCode, isAdminAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  // Set once the password is accepted: the admin then types the emailed code.
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [code, setCode] = useState('');

  useEffect(() => {
    if (isAdminAuthenticated) {
      navigate('/');
    }
  }, [isAdminAuthenticated, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!email) {
      setErrorMessage("L'email est requis");
      return;
    }
    if (!password) {
      setErrorMessage('Le mot de passe est requis');
      return;
    }

    try {
      const challenge = await login({ email, password });
      setPendingUserId(challenge.userId);
      setCode('');
    } catch (error) {
      setErrorMessage(messageOf(error) || 'Connexion refusée. Vérifiez vos identifiants.');
    }
  };

  const handleCodeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    if (!pendingUserId) return;
    if (!code.trim()) {
      setErrorMessage('Entrez le code reçu par email');
      return;
    }
    try {
      await verifyLoginCode(pendingUserId, code.trim());
    } catch (error) {
      setErrorMessage(messageOf(error) || 'Code invalide ou expiré');
    }
  };

  const backToPassword = () => { setPendingUserId(null); setCode(''); setErrorMessage(''); };

  return (
    <main className="background flex h-dvh w-full items-center justify-center overflow-y-auto px-4 py-8 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      {/* Darkens the photo a little so the card reads in both themes */}
      <div className="pointer-events-none fixed inset-0 bg-black/30" aria-hidden="true" />

      <motion.div
        className="relative w-full max-w-sm rounded-panel border border-line bg-surface/85 p-6 shadow-overlay backdrop-blur-md sm:p-8"
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
          <img className="h-16 w-16 shrink-0 rounded-full object-cover shadow-panel" src={logoSbc} alt="Logo SBC" />
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-primary">Administration</p>
            <h1 className="text-lg font-semibold leading-snug text-fg">Sniper Business Center</h1>
          </div>
        </motion.div>

        <form onSubmit={pendingUserId ? handleCodeSubmit : handleSubmit} className="flex flex-col gap-4">
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
            {pendingUserId ? (
              <motion.div
                key="code"
                className="flex flex-col gap-4"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.25, ease }}
              >
                <p className="text-sm text-fg-muted">
                  Un code de connexion a été envoyé à <span className="font-medium break-all text-fg">{email}</span>.
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
                    disabled={isAuthLoading}
                    autoFocus
                  />
                </Field>
                <button
                  type="button"
                  className="self-start text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline disabled:opacity-50"
                  onClick={backToPassword}
                  disabled={isAuthLoading}
                >
                  Retour
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="password"
                className="flex flex-col gap-4"
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
                transition={{ duration: 0.25, ease }}
              >
                <Field label="Email">
                  <Input
                    type="email"
                    autoComplete="username"
                    placeholder="admin@exemple.com"
                    className="h-11 text-base md:text-sm"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isAuthLoading}
                  />
                </Field>
                <Field label="Mot de passe">
                  <Input
                    type="password"
                    autoComplete="current-password"
                    className="h-11 text-base md:text-sm"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isAuthLoading}
                  />
                </Field>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3, ease }}
          >
            <Button type="submit" variant="primary" size="lg" className="mt-2 w-full" loading={isAuthLoading}>
              {isAuthLoading ? 'Connexion…' : pendingUserId ? 'Valider le code' : 'Se connecter'}
            </Button>
          </motion.div>
        </form>
      </motion.div>
    </main>
  );
}

export default Login;
