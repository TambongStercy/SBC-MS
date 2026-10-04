import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
// Imported, not a "/src/..." string: that path only exists on the dev server.
import logoSbc from '../assets/logo-sbc.png';
import { useAuth } from '../context/AuthContext';

/** The server answers in English; admins read French. */
function frenchError(message?: string): string {
    const m = (message || '').toLowerCase();
    if (m.includes('invalid email or password')) return 'Email ou mot de passe incorrect.';
    if (m.includes('not an admin')) return "Ce compte n'a pas accès à l'administration.";
    if (m.includes('blocked')) return 'Ce compte est bloqué.';
    if (m.includes('deleted')) return 'Ce compte a été supprimé.';
    if (m.includes('too many')) return 'Trop de tentatives. Réessaie dans quelques minutes.';
    if (m.includes('network')) return 'Pas de connexion au serveur. Vérifie ta connexion.';
    return 'Connexion impossible. Vérifie tes identifiants.';
}

const field = 'w-full rounded-xl bg-black/35 text-white placeholder-white/50 border border-white/15 px-4 h-12 text-[15px] focus:outline-none focus:ring-2 focus:ring-white/40 disabled:opacity-60';

/** The original admin login: the drifting photo, a frosted card, the SBC logo. */
function Login() {
    const navigate = useNavigate();
    const { login, isAdminAuthenticated, isLoading } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [show, setShow] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => { if (isAdminAuthenticated) navigate('/'); }, [isAdminAuthenticated, navigate]);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        if (!email.trim() || !password) { setError('Entre ton email et ton mot de passe.'); return; }
        try {
            await login({ email: email.trim(), password });
        } catch (err: any) {
            setError(frenchError(err?.message));
        }
    };

    return (
        <main className="sbc-login-bg min-h-screen flex items-center justify-center px-4 py-10">
            <motion.div
                className="w-full max-w-sm rounded-2xl bg-gray-900/40 backdrop-blur-md border border-white/10 shadow-2xl p-6 sm:p-7 text-white"
                initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: 'easeOut' }}>
                <div className="flex items-center justify-center gap-3 mb-6">
                    <motion.img src={logoSbc} alt="Logo SBC" className="size-20 rounded-full object-cover shadow-lg"
                        initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.6, delay: 0.15 }} />
                    <p className="text-xl font-semibold leading-snug">Administrateur Sniper<br />Business Center</p>
                </div>
                <form onSubmit={submit} className="space-y-3" noValidate>
                    <AnimatedError text={error} />
                    <label className="sr-only" htmlFor="login-email">Email</label>
                    <input id="login-email" type="email" autoComplete="username" inputMode="email" placeholder="Email"
                        className={field} value={email} onChange={e => setEmail(e.target.value)} disabled={isLoading} />
                    <div className="relative">
                        <label className="sr-only" htmlFor="login-password">Mot de passe</label>
                        <input id="login-password" type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="Mot de passe"
                            className={`${field} pr-12`} value={password} onChange={e => setPassword(e.target.value)} disabled={isLoading} />
                        <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                            className="absolute right-1 top-1 size-10 grid place-items-center text-white/60 hover:text-white">
                            {show ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                    <motion.button type="submit" disabled={isLoading}
                        className="w-full h-12 mt-3 rounded-xl bg-primary hover:bg-primary-hover text-white font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.3, ease: 'easeOut' }}
                        whileTap={{ scale: 0.98 }}>
                        {isLoading && <Loader2 size={18} className="animate-spin" />}
                        {isLoading ? 'Connexion…' : 'Se connecter'}
                    </motion.button>
                </form>
            </motion.div>
        </main>
    );
}

function AnimatedError({ text }: { text: string }) {
    if (!text) return null;
    return (
        <motion.p key={text} role="alert" className="text-sm bg-red-500/80 rounded-xl px-3 py-2"
            initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }} transition={{ duration: 0.35 }}>
            {text}
        </motion.p>
    );
}

export default Login;
