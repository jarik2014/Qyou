import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DistributionKillSwitch } from '@qyou/stellar';
import { createStellarServices } from '../src/shared/stellar/bootstrap.js';

describe('API Stellar Bootstrap Smoke Test (#1005)', () => {
  it('successfully constructs WalletService and IncentiveService at API boot', () => {
    // #1150 — the factory now requires the distribution guard explicitly.
    const { walletService, incentiveService } = createStellarServices({
      guards: { killSwitch: new DistributionKillSwitch() },
    });
    assert.ok(walletService);
    assert.ok(incentiveService);
    assert.ok(incentiveService.getClient());
  });
});
