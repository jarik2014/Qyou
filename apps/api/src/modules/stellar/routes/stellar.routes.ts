import { Router } from 'express';
import { StellarController } from '../controllers/stellar.controller.js';
import { StellarApiService } from '../services/stellar.service.js';
import type { WalletService } from '@qyou/stellar';
import { InMemoryStellarRepository } from '../repositories/stellar.repository.js';
import type { StellarRepository } from '../repositories/stellar.repository.js';
import { requireAuth } from '../../../shared/middleware/auth-middleware.js';

export interface StellarRouterDependencies {
  stellarRepository?: StellarRepository;
  stellarService?: StellarApiService;
  /**
   * Wallet service wired at boot through `createStellarServices` (#1150), so
   * its options are explicit instead of defaulted deep inside the API service.
   */
  walletService?: WalletService;
}

export function createStellarRouter(deps: StellarRouterDependencies = {}): Router {
  const repository = deps.stellarRepository ?? new InMemoryStellarRepository();
  const service = deps.stellarService ?? new StellarApiService(repository, deps.walletService);
  const controller = new StellarController(service);

  const router = Router();

  // Wallet management routes protected by auth middleware
  router.post('/wallet', requireAuth, controller.linkWallet);
  router.get('/wallet', requireAuth, controller.getWallet);
  router.delete('/wallet', requireAuth, controller.unlinkWallet);

  return router;
}
