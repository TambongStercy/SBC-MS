import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { logoutAdmin } from '../api/admin';
import { useAuth } from '../context/AuthContext';
import { Button, Card } from '../ui';

/** Asks once, then signs out here and on the server. */
export default function Deconnexion() {
    const navigate = useNavigate();
    const { logout } = useAuth();
    const [busy, setBusy] = useState(false);
    const signOut = async () => {
        setBusy(true);
        // The local sign-out happens even if the server call fails.
        try { await logoutAdmin(); } catch { /* signed out locally below */ }
        logout();
    };
    return (
        <div className="min-h-[70vh] grid place-items-center px-4">
            <Card className="w-full max-w-sm text-center space-y-4">
                <span className="mx-auto size-12 grid place-items-center rounded-pill bg-danger-soft text-danger"><LogOut size={22} /></span>
                <div>
                    <h1 className="text-lg font-bold">Se déconnecter ?</h1>
                    <p className="text-sm text-ink-2">Il faudra te reconnecter pour revenir dans l’admin.</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <Button variant="secondary" onClick={() => navigate(-1)} disabled={busy}>Annuler</Button>
                    <Button variant="danger" onClick={signOut} loading={busy}>Déconnexion</Button>
                </div>
            </Card>
        </div>
    );
}
