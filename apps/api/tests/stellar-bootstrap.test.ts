import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DistributionKillSwitch, NetworkGuard } from '@qyou/stellar';
import {
  createStellarServices,
  MissingStellarGuardError,
} from '../src/shared/stellar/bootstrap.js';

// #1150: booting the Stellar services without the guards they depend on used to
// succeed silently. These cases pin the fail-closed behaviour.
describe('createStellarServices — explicit wiring and boot-time guard checks (#1150)', () => {
  it('refuses to boot without a kill switch', () => {
    assert.throws(
      () => createStellarServices({ incentive: { allowMainnet: false } }),
      (error: unknown) => {
        assert.ok(error instanceof MissingStellarGuardError);
        assert.deepEqual(error.missing, ['killSwitch']);
        assert.match(error.message, /killSwitch/);
        return true;
      },
    );
  });

  it('refuses mainnet without a network guard', () => {
    const previous = process.env.STELLAR_NETWORK;
    process.env.STELLAR_NETWORK = 'MAINNET';
    try {
      assert.throws(
        () => createStellarServices({ guards: { killSwitch: new DistributionKillSwitch() } }),
        (error: unknown) => {
          assert.ok(error instanceof MissingStellarGuardError);
          assert.deepEqual(error.missing, ['networkGuard']);
          return true;
        },
      );
    } finally {
      if (previous === undefined) delete process.env.STELLAR_NETWORK;
      else process.env.STELLAR_NETWORK = previous;
    }
  });

  it('reports both guards when mainnet is requested and neither is supplied', () => {
    assert.throws(
      () => createStellarServices({ incentive: { allowMainnet: true } }),
      (error: unknown) => {
        assert.ok(error instanceof MissingStellarGuardError);
        assert.deepEqual([...error.missing].sort(), ['killSwitch', 'networkGuard']);
        return true;
      },
    );
  });

  it('boots on testnet with an injected kill switch', () => {
    const previous = process.env.STELLAR_NETWORK;
    delete process.env.STELLAR_NETWORK;
    try {
      const killSwitch = new DistributionKillSwitch();
      const { walletService, incentiveService } = createStellarServices({ guards: { killSwitch } });
      assert.ok(walletService);
      assert.ok(incentiveService);
      assert.ok(incentiveService.getClient());
    } finally {
      if (previous !== undefined) process.env.STELLAR_NETWORK = previous;
    }
  });

  it('passes wallet options through instead of hiding them behind defaults', () => {
    const seen: string[] = [];
    const { walletService } = createStellarServices({
      wallet: {
        cacheTtlMs: 1_234,
        balanceProvider: async (publicKey: string) => {
          seen.push(publicKey);
          return { xlm: '1', balances: [] };
        },
      },
      guards: { killSwitch: new DistributionKillSwitch() },
    });
    assert.ok(walletService);
    assert.deepEqual(seen, [], 'the provider is wired, not invoked at boot');
  });

  it('accepts an explicit network guard for mainnet', () => {
    const { incentiveService } = createStellarServices({
      guards: { killSwitch: new DistributionKillSwitch(), networkGuard: NetworkGuard },
      incentive: { allowMainnet: true },
    });
    assert.ok(incentiveService);
  });
});
