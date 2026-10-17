import { Router } from 'express';
import { StellarController } from '../controllers/stellar.controller.js';
import { StellarApiService } from '../services/stellar.service.js';
import { InMemoryStellarRepository } from '../repositories/stellar.repository.js';
import type { StellarRepository } from '../repositories/stellar.repository.js';
import { requireAuth } from '../../../shared/middleware/auth-middleware.js';
import { requireRecentAuth } from '../../../shared/middleware/recent-auth.js';
import type { RequestHandler } from 'express';

export interface StellarRouterDependencies {
  stellarRepository?: StellarRepository;
  stellarService?: StellarApiService;
  /**
   * Re-auth guard for `DELETE /wallet` (#1154). The app passes
   * `requireRecentAuth({ authRepository })` so the password path is available;
   * the fallback keeps the freshness check when nothing is injected.
   */
  unlinkReauth?: RequestHandler;
}

export function createStellarRouter(deps: StellarRouterDependencies = {}): Router {
  const repository = deps.stellarRepository ?? new InMemoryStellarRepository();
  const service = deps.stellarService ?? new StellarApiService(repository);
  const controller = new StellarController(service);

  const router = Router();

  // Wallet management routes protected by auth middleware
  router.post('/wallet', requireAuth, controller.linkWallet);
  router.get('/wallet', requireAuth, controller.getWallet);
  // #1154: відвʼязка гаманця вимагає доведеного re-auth, а не лише сесії.
  router.delete('/wallet', requireAuth, deps.unlinkReauth ?? requireRecentAuth(), controller.unlinkWallet);

  return router;
}
