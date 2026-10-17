import type { WalletAccount } from '@qyou/stellar';
import type {
  RewardRecord,
  RewardsPage,
  StellarAuditLogEntry,
} from '../types/stellar.types.js';

export interface StellarRepository {
  getWalletByUserId(userId: string): Promise<WalletAccount | null>;
  getWalletByPublicKey(publicKey: string): Promise<WalletAccount | null>;
  saveWallet(account: WalletAccount): Promise<WalletAccount>;
  deleteWallet(userId: string): Promise<boolean>;
  recordAuditLog(entry: Omit<StellarAuditLogEntry, 'id'>): Promise<StellarAuditLogEntry>;
  getAuditLogs(userId?: string): Promise<StellarAuditLogEntry[]>;
  /** Newest first, scoped to one user, keyset-paginated (#1148). */
  listRewards(userId: string, limit: number, cursor: RewardCursor | null): Promise<RewardsPage>;
}

/** Decoded keyset position: the last row of the previous page. */
export interface RewardCursor {
  createdAt: number;
  id: string;
}

/** Cursor is opaque to clients: base64url of "<createdAt>|<id>". */
export function encodeRewardCursor(cursor: RewardCursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, "utf8").toString("base64url");
}

export function decodeRewardCursor(raw: string): RewardCursor {
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  const separator = decoded.lastIndexOf("|");
  if (separator <= 0) {
    throw new Error("Malformed cursor");
  }
  const createdAt = Number(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (!Number.isFinite(createdAt) || !id) {
    throw new Error("Malformed cursor");
  }
  return { createdAt, id };
}

export class InMemoryStellarRepository implements StellarRepository {
  private readonly _wallets = new Map<string, WalletAccount>();
  private readonly _auditLogs: StellarAuditLogEntry[] = [];
  private readonly _rewards: RewardRecord[] = [];

  public async getWalletByUserId(userId: string): Promise<WalletAccount | null> {
    return this._wallets.get(userId) || null;
  }

  public async getWalletByPublicKey(publicKey: string): Promise<WalletAccount | null> {
    for (const wallet of this._wallets.values()) {
      if (wallet.publicKey === publicKey) {
        return wallet;
      }
    }
    return null;
  }

  public async saveWallet(account: WalletAccount): Promise<WalletAccount> {
    this._wallets.set(account.userId, account);
    return account;
  }

  public async deleteWallet(userId: string): Promise<boolean> {
    return this._wallets.delete(userId);
  }

  public async recordAuditLog(entry: Omit<StellarAuditLogEntry, 'id'>): Promise<StellarAuditLogEntry> {
    const fullEntry: StellarAuditLogEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      ...entry,
    };
    this._auditLogs.push(fullEntry);
    return fullEntry;
  }

  /** Test/seed helper — there is no reward-writing path yet (see #1147). */
  public seedReward(reward: RewardRecord): void {
    this._rewards.push(reward);
  }

  public async listRewards(
    userId: string,
    limit: number,
    cursor: RewardCursor | null,
  ): Promise<RewardsPage> {
    const ordered = this._rewards
      .filter((reward) => reward.userId === userId)
      .sort((a, b) => (b.createdAt - a.createdAt) || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0));

    const start = cursor
      ? ordered.findIndex(
          (reward) =>
            reward.createdAt < cursor.createdAt ||
            (reward.createdAt === cursor.createdAt && reward.id < cursor.id),
        )
      : 0;

    if (start === -1) {
      return { items: [], nextCursor: null };
    }

    const items = ordered.slice(start, start + limit);
    const last = items[items.length - 1];
    const hasMore = start + items.length < ordered.length;
    return {
      items,
      nextCursor: hasMore && last ? encodeRewardCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }

  public async getAuditLogs(userId?: string): Promise<StellarAuditLogEntry[]> {
    if (!userId) {
      return [...this._auditLogs];
    }
    return this._auditLogs.filter((log) => log.userId === userId);
  }
}
