import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import apiClient from '../../api/apiClient';
import { getUserSummaryStats } from '../../services/adminUserApi';
import { useTheme } from '../../theme/ThemeProvider';
import { Card, ErrorState, KeyValue, Page, SectionTitle, Skeleton, Stat } from '../../ui';
import { formatCompact, formatMoney, formatNumber } from '../../lib/format';
import { countryName } from '../../lib/labels';

type Month = { month: string; registered: number; classiqueActive: number; cibleActive: number };

/** SVG attributes can't read CSS variables: resolve the theme tokens to colours. */
function useTokens() {
    const { theme } = useTheme();
    return useMemo(() => {
        const css = getComputedStyle(document.documentElement);
        const c = (name: string) => `rgb(${css.getPropertyValue(`--c-${name}`).trim().split(/\s+/).join(',')})`;
        return { primary: c('primary'), success: c('success'), accent: c('accent'), grid: c('border'), ink: c('ink-3') };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [theme]);
}

const monthLabel = (key: string) => {
    const [y, m] = key.split('-').map(Number);
    return new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit' }).format(new Date(y, m - 1, 1));
};

/**
 * The longer view: how many members, sign-ups and active subscriptions month
 * by month, and where members' balances sit. (The old dashboard's other
 * figures were wrong or dead — see the redesign audit.)
 */
export default function StatsPage() {
    const t = useTokens();
    const summary = useQuery({ queryKey: ['stats', 'summary'], queryFn: getUserSummaryStats });
    const months = useQuery({ queryKey: ['stats', 'monthly'], queryFn: async (): Promise<Month[]> => (await apiClient.get('/users/admin/stats/monthly-activity', { params: { months: 12 } })).data.data });
    const balances = useQuery({ queryKey: ['stats', 'balances'], queryFn: async (): Promise<Array<{ _id: string | null; totalBalance: number }>> => (await apiClient.get('/users/admin/stats/balance-by-country')).data.data });
    const data = (months.data ?? []).map(m => ({ ...m, label: monthLabel(m.month) }));
    const totalHeld = (balances.data ?? []).reduce((s, b) => s + (b.totalBalance || 0), 0);
    const axis = { stroke: t.ink, fontSize: 12, tickLine: false, axisLine: false } as const;
    const tooltip = { contentStyle: { borderRadius: 12, border: `1px solid ${t.grid}`, fontSize: 13 } };

    return (
        <Page title="Statistiques" back="/plus">
            <div className="space-y-5">
                <div className="grid grid-cols-3 gap-2">
                    <Stat label="Membres" value={formatNumber(summary.data?.totalUsers)} loading={summary.isLoading} to="/membres" />
                    <Stat label="Classique actifs" value={formatNumber(summary.data?.activeClassique)} loading={summary.isLoading} to="/membres?abonnement=classique" />
                    <Stat label="Ciblé actifs" value={formatNumber(summary.data?.activeCible)} loading={summary.isLoading} to="/membres?abonnement=cible" />
                </div>

                <section>
                    <SectionTitle>Inscriptions par mois</SectionTitle>
                    <Card>
                        {months.isLoading ? <Skeleton className="h-64" /> : months.isError ? <ErrorState onRetry={() => months.refetch()} /> : (
                            <div className="h-64"><ResponsiveContainer width="100%" height="100%">
                                <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                                    <CartesianGrid stroke={t.grid} vertical={false} />
                                    <XAxis dataKey="label" {...axis} />
                                    <YAxis {...axis} tickFormatter={v => formatCompact(v)} width={44} />
                                    <Tooltip {...tooltip} formatter={(v: number) => [formatNumber(v), 'Inscriptions']} cursor={{ fill: t.grid, opacity: 0.4 }} />
                                    <Bar dataKey="registered" fill={t.primary} radius={[6, 6, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer></div>
                        )}
                    </Card>
                </section>

                <section>
                    <SectionTitle>Abonnements actifs par mois</SectionTitle>
                    <Card>
                        {months.isLoading ? <Skeleton className="h-64" /> : months.isError ? <ErrorState onRetry={() => months.refetch()} /> : (
                            <div className="h-64"><ResponsiveContainer width="100%" height="100%">
                                <LineChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                                    <CartesianGrid stroke={t.grid} vertical={false} />
                                    <XAxis dataKey="label" {...axis} />
                                    <YAxis {...axis} tickFormatter={v => formatCompact(v)} width={44} />
                                    <Tooltip {...tooltip} formatter={(v: number, name: string) => [formatNumber(v), name]} />
                                    <Legend wrapperStyle={{ fontSize: 13 }} />
                                    <Line type="monotone" dataKey="classiqueActive" name="Classique" stroke={t.success} strokeWidth={2.5} dot={false} />
                                    <Line type="monotone" dataKey="cibleActive" name="Ciblé" stroke={t.primary} strokeWidth={2.5} dot={false} />
                                </LineChart>
                            </ResponsiveContainer></div>
                        )}
                    </Card>
                </section>

                <section>
                    <SectionTitle>Soldes des membres par pays</SectionTitle>
                    <Card>
                        {balances.isLoading ? <Skeleton className="h-40" /> : balances.isError ? <ErrorState onRetry={() => balances.refetch()} /> : (
                            <>
                                <KeyValue items={(balances.data ?? []).slice(0, 12).map(b => [b._id ? countryName(b._id) : 'Pays non renseigné', formatMoney(b.totalBalance)] as [string, string])} />
                                <p className="mt-3 text-sm text-ink-2">Total détenu pour les membres : <b className="text-ink tabular">{formatMoney(totalHeld)}</b> — l’argent que SBC leur doit.</p>
                            </>
                        )}
                    </Card>
                </section>
            </div>
        </Page>
    );
}
