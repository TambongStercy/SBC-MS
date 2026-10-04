import { BarChart3, CircleUser, FileText, HardDrive, LogOut, Megaphone, MessageCircle, Moon, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeProvider';
import { ROLE_LABEL } from '../../lib/roles';
import { Avatar, NavList, NavRow, Page, SectionTitle, Switch } from '../../ui';

/** Everything that isn't daily work: communication, content, access, settings. */
export default function PlusHub() {
    const { role, adminUser } = useAuth();
    const { theme, setTheme } = useTheme();
    const isAdmin = role === 'admin';

    return (
        <Page title="Plus">
            <div className="space-y-6">
                {isAdmin && (
                    <>
                        <section>
                            <SectionTitle>Communication</SectionTitle>
                            <NavList>
                                <NavRow to="/plus/annonces" icon={<Megaphone size={20} />} title="Annonces" description="Notifications sur le téléphone des membres" />
                                <NavRow to="/plus/whatsapp" icon={<MessageCircle size={20} />} tone="success" title="WhatsApp" description="Connexion du compte WhatsApp de SBC" />
                                <NavRow to="/plus/stories" icon={<Sparkles size={20} />} tone="accent" title="Stories" description="Les stories des membres, publier en tant que SBC" />
                            </NavList>
                        </section>
                        <section>
                            <SectionTitle>Contenu et accès</SectionTitle>
                            <NavList>
                                <NavRow to="/plus/contenu" icon={<FileText size={20} />} tone="neutral" title="Contenu de l'app" description="Formations, actualités, fichiers, groupes" />
                                <NavRow to="/plus/roles" icon={<ShieldCheck size={20} />} tone="warning" title="Rôles et accès" description="Administrateurs, admins retraits, modérateurs" />
                                <NavRow to="/plus/stockage" icon={<HardDrive size={20} />} tone="neutral" title="Stockage" description="Fichiers et coût du stockage" />
                                <NavRow to="/plus/statistiques" icon={<BarChart3 size={20} />} tone="neutral" title="Statistiques" description="Membres, inscriptions et abonnements dans le temps" />
                            </NavList>
                        </section>
                    </>
                )}
                <section>
                    <SectionTitle>Apparence</SectionTitle>
                    <div className="bg-surface border border-border rounded-card flex items-center gap-3 px-4 py-3">
                        <span className="size-10 grid place-items-center rounded-pill bg-surface-2 text-ink-2"><Moon size={20} /></span>
                        <span className="flex-1 font-semibold">Thème sombre</span>
                        <Switch label="Thème sombre" checked={theme === 'dark'} onChange={v => setTheme(v ? 'dark' : 'light')} />
                    </div>
                </section>
                <section>
                    <SectionTitle>Compte</SectionTitle>
                    <NavList>
                        <div className="flex items-center gap-3 px-4 py-3">
                            {adminUser?.name ? <Avatar name={adminUser.name} size={40} /> : <span className="size-10 grid place-items-center rounded-pill bg-surface-2"><CircleUser size={20} /></span>}
                            <span className="min-w-0">
                                <span className="block font-semibold truncate">{adminUser?.name || 'Admin'}</span>
                                <span className="block text-sm text-ink-2">{ROLE_LABEL[role ?? ''] ?? role}{adminUser?.email ? ` · ${adminUser.email}` : ''}</span>
                            </span>
                        </div>
                        <NavRow to="/logout" icon={<LogOut size={20} />} tone="danger" title="Déconnexion" />
                    </NavList>
                </section>
            </div>
        </Page>
    );
}
