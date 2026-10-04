import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Button, Input } from '../ui';

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
        <main className="min-h-screen bg-bg text-ink flex items-center justify-center px-4 py-10">
            <div className="w-full max-w-sm">
                <div className="flex flex-col items-center text-center mb-6">
                    <img src="/sbc-app-icon.png" alt="" className="size-16 rounded-card mb-4" />
                    <h1 className="text-2xl font-extrabold tracking-tight">SBC Admin</h1>
                    <p className="text-sm text-ink-2 mt-1">Sniper Business Center</p>
                </div>
                <form onSubmit={submit} className="bg-surface border border-border rounded-card p-5 space-y-4" noValidate>
                    <Input label="Email" type="email" autoComplete="username" inputMode="email" value={email}
                        onChange={e => setEmail(e.target.value)} placeholder="nom@exemple.com" />
                    <div className="relative">
                        <Input label="Mot de passe" type={show ? 'text' : 'password'} autoComplete="current-password" value={password}
                            onChange={e => setPassword(e.target.value)} className="pr-11" />
                        <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                            className="absolute right-1 bottom-0.5 size-10 grid place-items-center text-ink-3 hover:text-ink">
                            {show ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                    {error && <p className="text-sm text-danger bg-danger-soft rounded-tile px-3 py-2" role="alert">{error}</p>}
                    <Button type="submit" size="lg" full loading={isLoading}>Se connecter</Button>
                </form>
            </div>
        </main>
    );
}

export default Login;
