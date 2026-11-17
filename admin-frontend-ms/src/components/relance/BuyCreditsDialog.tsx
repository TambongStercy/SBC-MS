import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Mail01Icon, ShoppingCart01Icon, SmartPhone01Icon } from '@hugeicons/core-free-icons';
import { getPacks, purchasePack } from '../../services/adminRelanceApi';
import { Button, Dialog, DialogContent, Segmented, Skeleton } from '../ui';
import { apiError, fmtInt, fmtXaf } from '../display/format';

/**
 * Buys a credit pack for the signed-in admin's OWN relance account (member
 * endpoint /relance/packs/purchase): opens the payment page in a new tab.
 */
export function BuyCreditsDialog({ open, onOpenChange, initialChannel = 'email', smsAllowed }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialChannel?: 'email' | 'sms';
    smsAllowed: boolean;
}) {
    const [channel, setChannel] = useState<'email' | 'sms'>(initialChannel);
    const [buying, setBuying] = useState<string | null>(null);
    const packs = useQuery({ queryKey: ['relance-packs'], queryFn: getPacks, enabled: open, staleTime: 10 * 60_000 });
    const list = packs.data ? (channel === 'email' ? packs.data.emailPacks : packs.data.smsPacks) : [];

    const buy = async (packId: string) => {
        setBuying(packId);
        try {
            const { checkoutUrl } = await purchasePack(packId);
            window.open(checkoutUrl, '_blank');
            onOpenChange(false);
            toast.info('La page de paiement s’est ouverte dans un nouvel onglet.');
        } catch (error) {
            toast.error(apiError(error, 'L’achat n’a pas pu démarrer.'));
        } finally {
            setBuying(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                title="Acheter des crédits pour ce compte"
                description="Ces crédits vont sur le compte relance de l’administrateur connecté, pas sur celui d’un membre."
            >
                <div className="space-y-4">
                    {smsAllowed && (
                        <Segmented
                            fill
                            size="lg"
                            label="Type de crédits"
                            value={channel}
                            onValueChange={setChannel}
                            options={[
                                { value: 'email', label: 'E-mail', icon: Mail01Icon },
                                { value: 'sms', label: 'SMS (Cameroun)', icon: SmartPhone01Icon },
                            ]}
                        />
                    )}
                    {packs.isLoading ? (
                        <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
                    ) : packs.isError ? (
                        <p className="text-sm text-danger">{apiError(packs.error, 'Les packs n’ont pas pu être chargés.')}</p>
                    ) : list.length === 0 ? (
                        <p className="py-4 text-center text-sm text-fg-muted">Aucun pack disponible.</p>
                    ) : (
                        <ul className="divide-y divide-line rounded-panel border border-line">
                            {list.map(pack => (
                                <li key={pack.id} className="flex items-center justify-between gap-3 px-4 py-3">
                                    <div>
                                        <p className="text-sm font-medium text-fg">{fmtInt(pack.credits)} {channel === 'email' ? 'e-mails' : 'SMS'}</p>
                                        <p className="text-sm text-fg-muted tabular-nums">{fmtXaf(pack.priceXAF)}</p>
                                    </div>
                                    <Button variant="primary" size="lg" loading={buying === pack.id} disabled={!!buying} onClick={() => void buy(pack.id)}>
                                        <HugeiconsIcon icon={ShoppingCart01Icon} size={16} aria-hidden="true" />
                                        Acheter
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
