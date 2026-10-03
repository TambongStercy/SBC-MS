import { listChangeRequests, listFraudFlags } from '../../../api/animation';

/** Open fraud flags ("À vérifier"): one row asked for, the total read. */
export const countOpenFraudFlags = async (): Promise<number> =>
    (await listFraudFlags({ status: 'OPEN', page: 1, limit: 1 })).total;

/** Change requests waiting for SBC. The route is unpaginated and capped at 200. */
export const countPendingChangeRequests = async (): Promise<number> =>
    (await listChangeRequests({ status: 'PENDING' })).length;
