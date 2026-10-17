import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import type { AuthRepository } from '../../modules/auth/repositories/auth.repository.js';
import { UnauthorizedError } from '../errors/index.js';

/**
 * Proof that the caller re-authenticated for this specific action (#1154).
 *
 * `DELETE /wallet` used to accept any session plus a `reauthConfirmed: true`
 * flag the client sent itself — the flag proved nothing and the `password`
 * field was only checked for presence, never verified. Destructive wallet
 * unlink now requires either the account password (verified against the stored
 * hash) or an access token issued within the recent-auth window.
 */
export interface ReauthEvidence {
  readonly method: 'password' | 'recent-auth';
  /** Момент підтвердження, epoch ms. */
  readonly at: number;
}

export const DEFAULT_REAUTH_WINDOW_MINUTES = 10;

export function reauthWindowMinutes(): number {
  const configured = Number(process.env.WALLET_UNLINK_REAUTH_MINUTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_REAUTH_WINDOW_MINUTES;
}

export interface RequireRecentAuthOptions {
  /** Потрібен для шляху з паролем; без нього лишається тільки вікно свіжості. */
  readonly authRepository?: AuthRepository;
  readonly maxAgeMinutes?: number;
  /** Для тестів. */
  readonly now?: () => number;
}

/**
 * Пропускає далі лише з доведеним re-auth і кладе доказ у `req.reauth`.
 */
export function requireRecentAuth(options: RequireRecentAuthOptions = {}) {
  const maxAgeMinutes = options.maxAgeMinutes ?? reauthWindowMinutes();
  const now = options.now ?? (() => Date.now());
  const windowMs = maxAgeMinutes * 60_000;

  return async function recentAuthMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError('Authentication required to unlink wallet.');
      }

      const password = typeof req.body?.password === 'string' ? req.body.password : undefined;

      if (password) {
        if (!options.authRepository || typeof options.authRepository.findById !== 'function') {
          throw new UnauthorizedError(
            'Password re-authentication is not available for this deployment. Sign in again and retry.',
          );
        }

        const user = await options.authRepository.findById(req.user.id);
        const matches = user ? await bcrypt.compare(password, user.passwordHash) : false;
        if (!matches) {
          throw new UnauthorizedError('Invalid password: wallet unlink requires re-authentication.');
        }

        req.reauth = { method: 'password', at: now() };
        next();
        return;
      }

      const authTime = req.user.authTime;
      if (typeof authTime !== 'number') {
        throw new UnauthorizedError(
          `Re-authentication required: this session carries no issue time. Sign in again (valid for ${maxAgeMinutes} minutes).`,
        );
      }

      const ageMs = now() - authTime * 1000;
      if (ageMs > windowMs) {
        throw new UnauthorizedError(
          `Re-authentication required: this session is older than ${maxAgeMinutes} minutes. ` +
            'Provide your password or sign in again before unlinking a wallet.',
        );
      }

      req.reauth = { method: 'recent-auth', at: authTime * 1000 };
      next();
    } catch (error) {
      next(error);
    }
  };
}
