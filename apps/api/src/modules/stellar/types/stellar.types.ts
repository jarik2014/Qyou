import type { WalletAccount, WalletBalances } from '@qyou/stellar';

export interface LinkWalletInput {
  publicKey: string;
}

export interface UnlinkWalletInput {
  password?: string;
  reauthConfirmed?: boolean;
}

export interface WalletDetailsResponse {
  wallet: WalletAccount;
  balances: WalletBalances;
}

export interface UnlinkWalletResponse {
  success: boolean;
  message: string;
  unlinkedAt: number;
}

export interface StellarAuditLogEntry {
  id: string;
  event: string;
  userId: string;
  details: Record<string, unknown>;
  timestamp: number;
}

/** One reward row as exposed to the caller (#1148). */
export interface RewardRecord {
  id: string;
  userId: string;
  /** Decimal string, 7 places — money is never a float here. */
  amount: string;
  asset: string;
  reason: string;
  createdAt: number;
}

export interface RewardsPage {
  items: RewardRecord[];
  /** Opaque cursor for the next page, or null when this is the last one. */
  nextCursor: string | null;
}

/** Raw query values as they arrive from the request (``?limit=20&cursor=...``). */
export interface ListRewardsQuery {
  limit?: string;
  cursor?: string;
}
