import { WalletService } from '@qyou/stellar';
import type { WalletAccount, WalletBalances } from '@qyou/stellar';
import type { StellarRepository } from '../repositories/stellar.repository.js';
import type {
  ListRewardsQuery,
  LinkWalletInput,
  RewardsPage,
  UnlinkWalletInput,
  WalletDetailsResponse,
  UnlinkWalletResponse,
  StellarAuditLogEntry,
} from '../types/stellar.types.js';
import {
  ValidationError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from '../../../shared/errors/index.js';
import { logger } from '../../../shared/logger/index.js';
import { decodeRewardCursor } from '../repositories/stellar.repository.js';

const DEFAULT_REWARDS_PAGE_SIZE = 20;
const MAX_REWARDS_PAGE_SIZE = 100;

export class StellarApiService {
  private readonly _repository: StellarRepository;
  private readonly _walletService: WalletService;

  constructor(repository: StellarRepository, walletService?: WalletService) {
    this._repository = repository;
    this._walletService = walletService ?? new WalletService();
  }

  public async linkWallet(userId: string, input: LinkWalletInput): Promise<WalletAccount> {
    if (!input.publicKey || !this._walletService.isValidPublicKey(input.publicKey)) {
      throw new ValidationError(
        'Invalid Stellar public key: must be a 56-character string starting with G.',
      );
    }

    const existingUserWallet = await this._repository.getWalletByUserId(userId);
    if (existingUserWallet) {
      throw new ConflictError(
        `User already has a linked Stellar wallet: ${existingUserWallet.publicKey}`,
      );
    }

    const existingKeyWallet = await this._repository.getWalletByPublicKey(input.publicKey);
    if (existingKeyWallet) {
      throw new ConflictError(
        `Stellar public key ${input.publicKey} is already linked to another account.`,
      );
    }

    const account: WalletAccount = {
      userId,
      publicKey: input.publicKey,
      createdAt: Date.now(),
    };

    // Keep memory cache in sync
    try {
      this._walletService.linkWallet(userId, input.publicKey);
    } catch {
      // If already in wallet service map, ignore
    }

    await this._repository.saveWallet(account);

    await this._repository.recordAuditLog({
      event: 'STELLAR_WALLET_LINKED',
      userId,
      details: { publicKey: input.publicKey },
      timestamp: Date.now(),
    });

    logger.info(`[stellar] Linked wallet ${input.publicKey} to user ${userId}`);
    return account;
  }

  public async getWalletDetails(userId: string): Promise<WalletDetailsResponse> {
    const wallet = await this._repository.getWalletByUserId(userId);
    if (!wallet) {
      throw new NotFoundError(`No linked Stellar wallet found for user ${userId}.`);
    }

    const balances = await this._walletService.getBalances(wallet.publicKey);

    return {
      wallet,
      balances,
    };
  }

  /**
   * Reward history for one caller (#1148). Cursor pagination, newest first.
   *
   * The page is always scoped to ``userId``: there is no parameter that would
   * let a caller read somebody else's rewards.
   */
  public async listRewards(userId: string, query: ListRewardsQuery): Promise<RewardsPage> {
    const rawLimit = query.limit;
    const limit = rawLimit === undefined ? DEFAULT_REWARDS_PAGE_SIZE : Number(rawLimit);
    if (rawLimit !== undefined && rawLimit.trim() === '') {
      throw new ValidationError('limit must be an integer between 1 and 100');
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_REWARDS_PAGE_SIZE) {
      throw new ValidationError(
        `limit must be an integer between 1 and ${MAX_REWARDS_PAGE_SIZE}`,
      );
    }

    let cursor = null;
    if (query.cursor !== undefined && query.cursor !== '') {
      try {
        cursor = decodeRewardCursor(String(query.cursor));
      } catch {
        throw new ValidationError('cursor is not a valid pagination cursor');
      }
    }

    return this._repository.listRewards(userId, limit, cursor);
  }

  public async unlinkWallet(
    userId: string,
    input: UnlinkWalletInput,
  ): Promise<UnlinkWalletResponse> {
    if (!input.password && !input.reauthConfirmed) {
      throw new UnauthorizedError(
        'Re-authentication required: must provide password or verified confirmation to unlink wallet.',
      );
    }

    const wallet = await this._repository.getWalletByUserId(userId);
    if (!wallet) {
      throw new NotFoundError(`No linked Stellar wallet found for user ${userId}.`);
    }

    await this._repository.deleteWallet(userId);
    try {
      this._walletService.unlinkWallet(userId);
    } catch {
      // Ignored if missing in memory cache
    }

    const timestamp = Date.now();

    await this._repository.recordAuditLog({
      event: 'STELLAR_WALLET_UNLINKED',
      userId,
      details: { previousPublicKey: wallet.publicKey, unlinkedAt: timestamp },
      timestamp,
    });

    logger.info(
      `[stellar-audit] STELLAR_WALLET_UNLINKED: user=${userId} publicKey=${wallet.publicKey} timestamp=${timestamp}`,
    );

    return {
      success: true,
      message: 'Stellar wallet unlinked successfully.',
      unlinkedAt: timestamp,
    };
  }

  public async getAuditLogs(userId?: string): Promise<StellarAuditLogEntry[]> {
    return this._repository.getAuditLogs(userId);
  }
}
