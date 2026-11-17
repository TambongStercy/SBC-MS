import { fmtXaf } from '../display/format';

/**
 * settings-service writes its storage advice in English
 * (services/storageMonitor.service.ts). The known sentences are shown in
 * French; anything new falls through unchanged.
 */
const EXACT: Record<string, string> = {
    'Review and optimize file storage': 'Revoir et optimiser le stockage des fichiers',
    'Implement file cleanup policies': 'Mettre en place des règles de nettoyage',
    'Monitor storage growth trends': 'Surveiller la croissance du stockage',
    'Consider archiving old files': 'Envisager d’archiver les anciens fichiers',
    'Monitor storage usage trends': 'Surveiller l’évolution de l’utilisation',
    'Plan for potential cleanup': 'Prévoir un nettoyage',
    'Review file retention policies': 'Revoir la durée de conservation des fichiers',
    'Consider cost optimization': 'Chercher à réduire les coûts',
    'Continue monitoring usage': 'Continuer à surveiller l’utilisation',
    'Maintain current storage practices': 'Garder les pratiques actuelles',
    'Consider implementing file cleanup policies to reduce costs': 'Mettre en place des règles de nettoyage pour réduire les coûts',
    'Review file retention policies - archive old files to reduce storage costs': 'Revoir la conservation des fichiers : archiver les anciens pour réduire les coûts',
    'URGENT: High storage costs detected. Implement aggressive cleanup strategies': 'Urgent : coûts de stockage élevés. Nettoyer en priorité',
    'Storage costs are low and manageable': 'Les coûts de stockage sont faibles et maîtrisés',
};

const PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/^Current monthly cost: (\d+) FCFA \((\d+) USD\)$/, m => `Coût mensuel actuel : ${fmtXaf(Number(m[1]))} (${m[2]} $)`],
    [/^(\d+) safe temporary files could be cleaned up \(user content excluded\)$/, m => `${m[1]} fichiers temporaires peuvent être supprimés sans risque (contenu des membres exclu)`],
];

export function frStorage(text: string): string {
    if (EXACT[text]) return EXACT[text];
    for (const [re, fn] of PATTERNS) {
        const m = text.match(re);
        if (m) return fn(m);
    }
    return text;
}

const UNIT: Record<string, string> = { B: 'o', Bytes: 'o', KB: 'Ko', MB: 'Mo', GB: 'Go', TB: 'To' };

/** "12.4 MB" (the service's format) as "12,4 Mo". */
export function frSize(text: string): string {
    const m = text.trim().match(/^([\d.]+)\s*([A-Za-z]+)$/);
    if (!m) return text;
    return `${m[1].replace('.', ',')} ${UNIT[m[2]] ?? m[2]}`;
}
