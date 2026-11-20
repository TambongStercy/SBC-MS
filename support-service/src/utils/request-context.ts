import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
    requestId: string;
    actor?: string; // "<agentId>|<role>" for x-support-actor
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export const currentRequestId = (): string | undefined => requestContext.getStore()?.requestId;
export const currentActor = (): string | undefined => requestContext.getStore()?.actor;
