import 'express';
import type { ReauthEvidence } from '../middleware/recent-auth.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      id: string;
      email: string;
      /** `iat` з access-токена, у секундах. */
      authTime?: number;
    };
    /** Заповнюється `requireRecentAuth` лише після справжньої перевірки. */
    reauth?: ReauthEvidence;
  }
}
