import type { WalletAccount, WalletBalances } from '@qyou/stellar';

export interface LinkWalletInput {
  publicKey: string;
}

export interface UnlinkWalletInput {
  /** Перевіряється проти хешу в requireRecentAuth, не тут. */
  password?: string;
  /** @deprecated #1154 — прапорець із тіла запиту нічого не доводить; ігнорується. */
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
