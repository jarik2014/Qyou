import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { InMemoryAuthRepository } from '../src/modules/auth/repositories/in-memory-auth.repository.js';
import { requireRecentAuth } from '../src/shared/middleware/recent-auth.js';
import { InMemoryStellarRepository } from '../src/modules/stellar/repositories/stellar.repository.js';
import { StellarApiService } from '../src/modules/stellar/services/stellar.service.js';

const VALID_KEY = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

function fakeRequest(overrides: {
  body?: Record<string, unknown>;
  userId?: string;
  authTime?: number;
}): Request {
  return {
    body: overrides.body ?? {},
    user: overrides.userId
      ? { id: overrides.userId, email: 'user@example.com', authTime: overrides.authTime }
      : undefined,
  } as unknown as Request;
}

/** Проганяє middleware і повертає або помилку, або req після нього. */
async function run(
  middleware: ReturnType<typeof requireRecentAuth>,
  req: Request,
): Promise<{ error?: Error; req: Request }> {
  let captured: Error | undefined;
  await middleware(req, {} as Response, ((err?: Error) => {
    captured = err;
  }) as never);
  return { error: captured, req };
}

async function seedUser(password: string) {
  const repo = new InMemoryAuthRepository();
  const user = await repo.create({ email: 'user@example.com', passwordHash: await bcrypt.hash(password, 10) });
  return { repo, userId: user.id };
}

describe('requireRecentAuth — DELETE /wallet (#1154)', () => {
  it('accepts a session issued inside the window and records the evidence', async () => {
    const now = 1_700_000_000_000;
    const middleware = requireRecentAuth({ maxAgeMinutes: 10, now: () => now });
    const { error, req } = await run(
      middleware,
      fakeRequest({ userId: 'u1', authTime: Math.floor(now / 1000) - 5 * 60 }),
    );
    assert.equal(error, undefined);
    assert.deepEqual(req.reauth, { method: 'recent-auth', at: (Math.floor(now / 1000) - 300) * 1000 });
  });

  it('rejects a session older than the window', async () => {
    const now = 1_700_000_000_000;
    const middleware = requireRecentAuth({ maxAgeMinutes: 10, now: () => now });
    const { error } = await run(
      middleware,
      fakeRequest({ userId: 'u1', authTime: Math.floor(now / 1000) - 11 * 60 }),
    );
    assert.ok(error instanceof Error);
    assert.match(error.message, /older than 10 minutes/);
  });

  it('rejects a flag-only body: reauthConfirmed from the client proves nothing', async () => {
    const now = 1_700_000_000_000;
    const middleware = requireRecentAuth({ maxAgeMinutes: 10, now: () => now });
    const { error, req } = await run(
      middleware,
      fakeRequest({
        userId: 'u1',
        authTime: Math.floor(now / 1000) - 60 * 60,
        body: { reauthConfirmed: true },
      }),
    );
    assert.ok(error instanceof Error);
    assert.equal(req.reauth, undefined);
  });

  it('accepts a correct password even in an old session', async () => {
    const { repo, userId } = await seedUser('correct horse battery staple');
    const now = 1_700_000_000_000;
    const middleware = requireRecentAuth({ authRepository: repo, maxAgeMinutes: 10, now: () => now });
    const { error, req } = await run(
      middleware,
      fakeRequest({
        userId,
        authTime: Math.floor(now / 1000) - 90 * 60,
        body: { password: 'correct horse battery staple' },
      }),
    );
    assert.equal(error, undefined);
    assert.deepEqual(req.reauth, { method: 'password', at: now });
  });

  it('rejects a wrong password', async () => {
    const { repo, userId } = await seedUser('right');
    const middleware = requireRecentAuth({ authRepository: repo, maxAgeMinutes: 10 });
    const { error } = await run(
      middleware,
      fakeRequest({ userId, authTime: Math.floor(Date.now() / 1000), body: { password: 'wrong' } }),
    );
    assert.ok(error instanceof Error);
    assert.match(error.message, /Invalid password/);
  });

  it('refuses the password path when no repository is wired', async () => {
    const middleware = requireRecentAuth({ maxAgeMinutes: 10 });
    const { error } = await run(
      middleware,
      fakeRequest({ userId: 'u1', authTime: Math.floor(Date.now() / 1000), body: { password: 'x' } }),
    );
    assert.ok(error instanceof Error);
    assert.match(error.message, /not available/);
  });

  it('rejects a token without an issue time', async () => {
    const middleware = requireRecentAuth({ maxAgeMinutes: 10 });
    const { error } = await run(middleware, fakeRequest({ userId: 'u1' }));
    assert.ok(error instanceof Error);
    assert.match(error.message, /no issue time/);
  });
});

describe('StellarApiService.unlinkWallet — re-auth is required and audited (#1154)', () => {
  async function serviceWithWallet() {
    const repository = new InMemoryStellarRepository();
    const service = new StellarApiService(repository);
    await service.linkWallet('user-1', { publicKey: VALID_KEY });
    return { repository, service };
  }

  it('refuses to unlink without verified re-auth evidence', async () => {
    const { service } = await serviceWithWallet();
    await assert.rejects(
      service.unlinkWallet('user-1', { reauthConfirmed: true }),
      /Re-authentication required/,
    );
  });

  it('unlinks with evidence and records how the caller proved identity', async () => {
    const { repository, service } = await serviceWithWallet();
    const result = await service.unlinkWallet('user-1', { password: 'x' }, {
      method: 'password',
      at: 1_700_000_000_000,
    });
    assert.equal(result.success, true);

    const logs = await repository.getAuditLogs('user-1');
    const unlinked = logs.find((entry) => entry.event === 'STELLAR_WALLET_UNLINKED');
    assert.ok(unlinked);
    assert.equal(unlinked.details.reauthMethod, 'password');
    assert.equal(unlinked.details.reauthAt, 1_700_000_000_000);
    assert.equal(unlinked.details.previousPublicKey, VALID_KEY);
  });
});
