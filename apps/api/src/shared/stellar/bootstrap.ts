import { IncentiveService, WalletService } from '@qyou/stellar';
import type { IncentiveServiceOptions, WalletServiceOptions } from '@qyou/stellar';
import { DistributionKillSwitch, NetworkGuard } from '@qyou/stellar';

/**
 * A guard the distribution path cannot run without is missing at boot.
 *
 * Thrown from `createStellarServices` rather than logged: a service wired
 * without these is exactly the state #1150 describes — guards and the kill
 * switch silently absent, so a bad distribution has nothing to stop it.
 */
export class MissingStellarGuardError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(
      `createStellarServices: missing required guard(s): ${missing.join(', ')}. ` +
        'Pass them explicitly in the config — the distribution path must be haltable and ' +
        'mainnet must never be reachable by accident.',
    );
    this.name = 'MissingStellarGuardError';
    this.missing = missing;
  }
}

export interface StellarServicesGuards {
  /** Halts every distribution; required unconditionally. */
  readonly killSwitch?: DistributionKillSwitch;
  /** Required only when the incentive service may talk to mainnet. */
  readonly networkGuard?: typeof NetworkGuard;
}

export interface StellarServicesConfig {
  readonly wallet?: WalletServiceOptions;
  readonly incentive?: IncentiveServiceOptions;
  readonly guards?: StellarServicesGuards;
}

const MAINNET_NAMES = new Set(['MAINNET', 'PUBLIC']);

function isMainnetSelected(): boolean {
  const configured = (process.env.STELLAR_NETWORK ?? '').toUpperCase();
  return MAINNET_NAMES.has(configured);
}

/**
 * Factory for bootstrapping Stellar services within the API lifecycle.
 *
 * Explicit dependency injection (#1150): nothing that matters is left to an
 * implicit default. The wallet service receives its options, the incentive
 * service receives its options *and* an injected kill switch, and the factory
 * refuses to return a pair that is missing a required guard.
 */
export function createStellarServices(config: StellarServicesConfig = {}) {
  const guards = config.guards ?? {};
  const incentive = config.incentive ?? {};
  const allowMainnet = incentive.allowMainnet === true || isMainnetSelected();

  const missing: string[] = [];
  if (!guards.killSwitch) missing.push('killSwitch');
  if (allowMainnet && !guards.networkGuard) missing.push('networkGuard');
  if (missing.length > 0) throw new MissingStellarGuardError(missing);

  const walletService = new WalletService(config.wallet ?? {});
  const incentiveService = new IncentiveService({
    ...incentive,
    killSwitch: guards.killSwitch,
    allowMainnet,
  });

  return { walletService, incentiveService };
}
