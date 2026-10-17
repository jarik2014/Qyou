import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { createStellarRouter } from '../routes/stellar.routes.js';
import { InMemoryStellarRepository } from '../repositories/stellar.repository.js';
import { errorHandler } from '../../../shared/middleware/error-handler.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-at-least-32-chars-long!';

function makeToken(userId: string): string {
  return jwt.sign({ sub: userId, email: `${userId}@example.com` }, JWT_SECRET);
}

function createApp(repository: InMemoryStellarRepository) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/stellar', createStellarRouter({ stellarRepository: repository }));
  app.use(errorHandler);
  return app;
}

function reward(userId: string, id: string, createdAt: number) {
  return { id, userId, amount: '1.0000000', asset: 'XLM', reason: 'referral', createdAt };
}

describe('GET /stellar/rewards (#1148)', () => {
  let repository: InMemoryStellarRepository;
  let app: express.Express;

  beforeEach(() => {
    repository = new InMemoryStellarRepository();
    // Two users, three rewards each, plus one collision on createdAt to prove the
    // id tiebreak keeps pagination stable.
    repository.seedReward(reward('user-1', 'r1', 1000));
    repository.seedReward(reward('user-1', 'r2', 2000));
    repository.seedReward(reward('user-1', 'r3', 2000));
    repository.seedReward(reward('user-2', 'other-1', 3000));
    app = createApp(repository);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/stellar/rewards');
    assert.equal(res.status, 401);
  });

  it('returns only the caller’s rewards, newest first', async () => {
    const res = await request(app)
      .get('/api/v1/stellar/rewards')
      .set('Authorization', `Bearer ${makeToken('user-1')}`);

    assert.equal(res.status, 200);
    const ids = res.body.items.map((item: { id: string }) => item.id);
    assert.deepEqual(ids, ['r3', 'r2', 'r1']);
    assert.ok(
      res.body.items.every((item: { userId: string }) => item.userId === 'user-1'),
      'another user’s rewards must never appear',
    );
    assert.equal(res.body.nextCursor, null);
  });

  it('paginates with an opaque cursor and does not skip or repeat rows', async () => {
    const auth = { Authorization: `Bearer ${makeToken('user-1')}` };

    const first = await request(app).get('/api/v1/stellar/rewards?limit=2').set(auth);
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.items.map((i: { id: string }) => i.id), ['r3', 'r2']);
    assert.ok(first.body.nextCursor, 'a first page of 2 from 3 rows must offer a cursor');

    const second = await request(app)
      .get(`/api/v1/stellar/rewards?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`)
      .set(auth);
    assert.equal(second.status, 200);
    assert.deepEqual(second.body.items.map((i: { id: string }) => i.id), ['r1']);
    assert.equal(second.body.nextCursor, null);

    const seen = [...first.body.items, ...second.body.items].map((i: { id: string }) => i.id);
    assert.equal(new Set(seen).size, seen.length, 'no duplicates across pages');
  });

  it('clamps and validates limit', async () => {
    const auth = { Authorization: `Bearer ${makeToken('user-1')}` };
    for (const bad of ['0', '-1', '101', 'abc', '']) {
      const res = await request(app).get(`/api/v1/stellar/rewards?limit=${bad}`).set(auth);
      assert.equal(res.status, 400, `limit=${bad} should be rejected`);
    }
    const ok = await request(app).get('/api/v1/stellar/rewards?limit=100').set(auth);
    assert.equal(ok.status, 200);
  });

  it('rejects a malformed cursor with 400 rather than silently starting over', async () => {
    const res = await request(app)
      .get('/api/v1/stellar/rewards?cursor=not-a-cursor')
      .set('Authorization', `Bearer ${makeToken('user-1')}`);
    assert.equal(res.status, 400);
  });

  it('returns an empty page for a user with no rewards', async () => {
    const res = await request(app)
      .get('/api/v1/stellar/rewards')
      .set('Authorization', `Bearer ${makeToken('user-without-rewards')}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items, []);
    assert.equal(res.body.nextCursor, null);
  });
});
