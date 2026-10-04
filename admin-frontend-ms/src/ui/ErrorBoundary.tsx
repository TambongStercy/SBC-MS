import { Component, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * A page that crashes shows this instead of blanking the whole admin: the
 * menu stays, the admin can reload or go elsewhere. Reset by changing `resetKey`.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
    state = { error: null as Error | null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error) {
        console.error('Page crashed:', error);
    }

    componentDidUpdate(prev: { resetKey?: string }) {
        if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
    }

    render() {
        if (!this.state.error) return this.props.children;
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6" role="alert">
                <span className="size-14 grid place-items-center rounded-pill bg-danger-soft text-danger mb-4"><AlertTriangle size={26} /></span>
                <p className="text-lg font-bold text-ink">Cette page a rencontré un problème.</p>
                <p className="mt-1 text-sm text-ink-2 max-w-sm">Le reste de l'admin fonctionne. Recharge la page ; si ça recommence, préviens la technique.</p>
                <div className="mt-5 flex gap-2">
                    <button type="button" onClick={() => window.location.reload()} className="h-11 px-5 rounded-pill bg-primary text-white font-semibold">Recharger</button>
                    <a href="/" className="h-11 px-5 rounded-pill border border-border bg-surface text-ink font-semibold inline-flex items-center">Accueil</a>
                </div>
            </div>
        );
    }
}
