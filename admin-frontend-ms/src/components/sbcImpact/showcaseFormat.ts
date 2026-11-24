import { formatNumber } from '../moduleKit';
import type { ShowcasePage } from '../../services/impactV2Api';

/** « 1er · 79,76/100 » */
export const showcaseResultText = (r: ShowcasePage['result']) => `${r.rank === 1 ? '1er' : `${r.rank}e`} · ${formatNumber(r.score, 2)}/100`;
