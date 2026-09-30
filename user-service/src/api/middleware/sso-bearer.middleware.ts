import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthenticatedRequest } from './auth.middleware';
import { userRepository } from '../../database/repositories/user.repository';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('SsoBearer');

/**
 * Lets an SSO client call SBC's own authenticated endpoints on behalf of the user
 * who authorised it.
 *
 * SSO access tokens carry `{ sub, client_id, scopes, type }` and are signed with a
 * SEPARATE secret from SBC user JWTs — deliberately, so the two are not
 * interchangeable and losing one secret does not hand over the other. The
 * consequence is that an SSO token cannot satisfy `authenticate`, which requires
 * `userId` and `role`. This bridges that gap for the specific routes we choose to
 * open, rather than teaching `authenticate` to accept SSO tokens, which would
 * silently widen every authenticated endpoint in the service at once.
 *
 * What it deliberately does NOT do is bypass anything downstream. It populates
 * `req.user` exactly as `authenticate` would, so `requireActiveSubscription` and
 * the CIBLE/CLASSIQUE filter rules still apply: a partner app sees precisely the
 * contacts its user is entitled to, and no more.
 */
export const ssoBearer = (requiredScope: string) =>
    async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        const header = req.headers.authorization;
        if (!header?.startsWith('Bearer ')) {
            res.status(401).json({ success: false, message: 'Jeton SSO manquant.' });
            return;
        }

        try {
            const decoded = jwt.verify(header.slice(7), config.sso.jwtSecret) as {
                sub?: string; scopes?: string[]; type?: string; client_id?: string;
            };

            // A refresh token must never work as an access token: it is long-lived
            // by design and is meant to be exchanged, not presented.
            if (decoded.type !== 'access' || typeof decoded.sub !== 'string') {
                res.status(401).json({ success: false, message: 'Jeton SSO invalide.' });
                return;
            }

            if (!decoded.scopes?.includes(requiredScope)) {
                res.status(403).json({
                    success: false,
                    code: 'INSUFFICIENT_SCOPE',
                    message: `Ce jeton n'a pas la portée « ${requiredScope} ».`,
                });
                return;
            }

            // The role is not in the token: it can change (or be revoked) long
            // before a token expires, and an SSO client must never be the thing
            // that decides it.
            const user = await userRepository.findById(decoded.sub);
            if (!user || user.deleted || user.blocked) {
                res.status(401).json({ success: false, message: 'Compte introuvable ou désactivé.' });
                return;
            }

            req.user = {
                userId: String(user._id),
                id: String(user._id),
                email: user.email,
                role: user.role,
            } as AuthenticatedRequest['user'];

            log.debug(`SSO client ${decoded.client_id} acting for user ${decoded.sub} (${requiredScope})`);
            next();
        } catch (err) {
            log.warn(`Rejected SSO bearer token: ${(err as Error).message}`);
            res.status(401).json({ success: false, message: 'Jeton SSO invalide ou expiré.' });
        }
    };
