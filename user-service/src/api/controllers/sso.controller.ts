import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { ssoService } from '../../services/sso.service';
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';

const log = logger.getLogger('SsoController');

class SsoController {
    /**
     * Step 1 — SBC frontend exchanges the user's SBC JWT for a one-shot auth code
     * after the user clicks "Authorize" on the consent screen. The frontend then
     * redirects the browser to `${redirect_uri}?code=<code>&state=<state>`.
     *
     * @route POST /api/sso/grant-code
     * @access Authenticated (SBC user Bearer token)
     */
    async grantCode(req: AuthenticatedRequest, res: Response): Promise<void> {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ success: false, message: 'Authentication required.' });
            return;
        }
        const { client_id, redirect_uri, scopes } = req.body || {};
        if (!client_id || !redirect_uri) {
            res.status(400).json({ success: false, message: 'client_id and redirect_uri are required' });
            return;
        }
        if (!Array.isArray(scopes) || scopes.length === 0) {
            res.status(400).json({ success: false, message: 'scopes must be a non-empty array' });
            return;
        }
        try {
            const result = await ssoService.issueAuthorizationCode(userId, client_id, redirect_uri, scopes);
            res.status(200).json({
                success: true,
                data: {
                    code: result.code,
                    expiresAt: result.expiresAt,
                    grantedScopes: result.scopes,
                },
            });
        } catch (error: any) {
            log.error(`grantCode failed for user ${userId}: ${error.message}`);
            const status = error instanceof AppError ? error.statusCode : 500;
            res.status(status).json({ success: false, message: error.message });
        }
    }

    /**
     * Step 2 — server-to-server: the third-party app's backend exchanges the auth
     * code for access + refresh tokens and the user payload.
     *
     * @route POST /api/sso/token
     * @access Public (client_id + client_secret authenticate)
     */
    async token(req: Request, res: Response): Promise<void> {
        const { code, client_id, client_secret, redirect_uri } = req.body || {};
        if (!code || !client_id || !client_secret || !redirect_uri) {
            res.status(400).json({ success: false, message: 'code, client_id, client_secret, redirect_uri are required' });
            return;
        }
        try {
            const result = await ssoService.exchangeCodeForTokens(code, client_id, client_secret, redirect_uri);
            res.status(200).json({
                success: true,
                data: {
                    access_token: result.accessToken,
                    refresh_token: result.refreshToken,
                    token_type: 'Bearer',
                    expires_in: result.expiresIn,
                    scope: result.scopes.join(' '),
                    user: result.user,
                },
            });
        } catch (error: any) {
            log.warn(`SSO token exchange failed (client ${client_id}): ${error.message}`);
            const status = error instanceof AppError ? error.statusCode : 500;
            res.status(status).json({ success: false, message: error.message });
        }
    }

    /**
     * Step 3 — fetch fresh user info with an SSO access token.
     *
     * @route GET /api/sso/userinfo
     * @access Bearer SSO access token
     */
    async userinfo(req: Request, res: Response): Promise<void> {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            res.status(401).json({ success: false, message: 'Bearer access_token required' });
            return;
        }
        const accessToken = authHeader.slice('Bearer '.length).trim();
        try {
            const user = await ssoService.getUserInfoFromAccessToken(accessToken);
            res.status(200).json({ success: true, data: user });
        } catch (error: any) {
            const status = error instanceof AppError ? error.statusCode : 500;
            res.status(status).json({ success: false, message: error.message });
        }
    }

    /**
     * Step 4 — refresh an expired access token.
     *
     * @route POST /api/sso/refresh
     * @access Public (client_id + client_secret authenticate)
     */
    async refresh(req: Request, res: Response): Promise<void> {
        const { refresh_token, client_id, client_secret } = req.body || {};
        if (!refresh_token || !client_id || !client_secret) {
            res.status(400).json({ success: false, message: 'refresh_token, client_id, client_secret are required' });
            return;
        }
        try {
            const result = await ssoService.refreshAccessToken(refresh_token, client_id, client_secret);
            res.status(200).json({
                success: true,
                data: {
                    access_token: result.accessToken,
                    refresh_token: result.refreshToken,
                    token_type: 'Bearer',
                    expires_in: result.expiresIn,
                    scope: result.scopes.join(' '),
                },
            });
        } catch (error: any) {
            log.warn(`SSO refresh failed (client ${client_id}): ${error.message}`);
            const status = error instanceof AppError ? error.statusCode : 500;
            res.status(status).json({ success: false, message: error.message });
        }
    }
}

export const ssoController = new SsoController();
export default ssoController;
