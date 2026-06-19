import { Router } from 'express';
import { ssoController } from '../controllers/sso.controller';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { strictLimiter, mediumLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

/**
 * @route POST /api/sso/grant-code
 * @desc  Exchange the user's SBC JWT for a short-lived SSO authorization code.
 *        Called by SBC's own frontend after the user clicks "Authorize" on the
 *        consent screen — not by third-party servers.
 * @body  { client_id: string, redirect_uri: string, scopes: string[] }
 * @auth  Bearer (SBC user JWT)
 */
router.post(
    '/grant-code',
    authenticate as any,
    mediumLimiter,
    (req, res) => ssoController.grantCode(req as AuthenticatedRequest, res),
);

/**
 * @route POST /api/sso/token
 * @desc  Server-to-server: exchange an auth code for access + refresh tokens.
 *        Called by the third-party app's BACKEND, never from a browser.
 * @body  { code, client_id, client_secret, redirect_uri }
 * @auth  client_secret in body
 *
 * Strict rate-limit because this is also the brute-force target for stolen codes.
 */
router.post(
    '/token',
    strictLimiter,
    (req, res) => ssoController.token(req, res),
);

/**
 * @route GET /api/sso/userinfo
 * @desc  Fetch fresh user info using an SSO access token.
 * @auth  Bearer <SSO access token>
 */
router.get(
    '/userinfo',
    mediumLimiter,
    (req, res) => ssoController.userinfo(req, res),
);

/**
 * @route POST /api/sso/refresh
 * @desc  Server-to-server: rotate an expired access token.
 * @body  { refresh_token, client_id, client_secret }
 * @auth  client_secret in body
 */
router.post(
    '/refresh',
    strictLimiter,
    (req, res) => ssoController.refresh(req, res),
);

/**
 * @route GET /api/sso/referrals/relationship?sponsorId=<24-char ObjectId>
 * @desc  Check whether the bearer is a direct (Niveau 1) referral of sponsorId.
 *        SBC Live calls this to enforce filleul-gated and tier-waiver access rules.
 * @auth  Bearer <SSO access token> with referrals.read scope
 */
router.get(
    '/referrals/relationship',
    mediumLimiter,
    (req, res) => ssoController.referralRelationship(req, res),
);

export default router;
