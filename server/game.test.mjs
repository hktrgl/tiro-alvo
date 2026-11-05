import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, rewardFromRoll, deposit, shoot, GameError } from './game.mjs';

test('probability buckets contain exactly 2%, 3%, 10%, 25% and 60%', () => {
  const counts = {};
  for (let roll = 0; roll < 10_000; roll++) {
    const type = rewardFromRoll(roll);
    counts[type] = (counts[type] || 0) + 1;
  }
  assert.deepEqual(counts, { giftcard: 200, coupon: 300, keychain: 1000, highlights: 2500, consolation: 6000 });
  assert.throws(() => rewardFromRoll(-1), RangeError);
  assert.throws(() => rewardFromRoll(10_000), RangeError);
});

test('partial simulated deposits accumulate in cents and only full R$100 award 3 shots', () => {
  let document = createDocument();
  const first = deposit(document, { amount: 99.99, idempotencyKey: 'deposit-part-1' });
  assert.equal(first.response.creditedShots, 0);
  assert.equal(first.response.state.depositRemainder, 99.99);
  assert.equal(first.response.state.shots, 3);
  document = first.nextDocument;
  const second = deposit(document, { amount: 0.01, idempotencyKey: 'deposit-part-2' });
  assert.equal(second.response.creditedShots, 3);
  assert.equal(second.response.state.depositRemainder, 0);
  assert.equal(second.response.state.depositTotal, 100);
  assert.equal(second.response.state.shots, 6);
  assert.equal(document.state.shots, 3, 'transactions do not mutate their input');
  const third = deposit(second.nextDocument, { amount: 250, idempotencyKey: 'deposit-part-3' });
  assert.equal(third.response.creditedShots, 6);
  assert.equal(third.response.state.depositRemainder, 50);
});

test('deposits reject invalid money values and invalid idempotency keys', () => {
  for (const amount of [0, -1, 10_001, 0.001, '100', NaN, Infinity]) {
    assert.throws(() => deposit(createDocument(), { amount, idempotencyKey: 'valid-key-123' }), GameError);
  }
  for (const key of [undefined, '', 'short', '<script>alert(1)</script>']) {
    assert.throws(() => deposit(createDocument(), { amount: 100, idempotencyKey: key }), GameError);
  }
});

test('a simulated deposit retry does not credit twice and conflicting reuse fails', () => {
  const first = deposit(createDocument(), { amount: 100, idempotencyKey: 'deposit-key-1' });
  const retry = deposit(first.nextDocument, { amount: 100, idempotencyKey: 'deposit-key-1' });
  assert.equal(retry.nextDocument, first.nextDocument);
  assert.equal(retry.response.state.shots, 6);
  assert.equal(retry.response.creditedShots, 3);
  assert.throws(() => deposit(first.nextDocument, { amount: 200, idempotencyKey: 'deposit-key-1' }), { status: 409 });
});

test('each reward consumes a shot and credits the correct demo inventory', () => {
  for (const [roll, type, inventory, amount] of [[0, 'giftcard', 'giftcard', 10], [200, 'coupon', 'coupon', 1], [500, 'keychain', 'keychain', 1], [1500, 'highlights', 'highlights', 3], [4000, 'consolation', 'highlights', 1]]) {
    const result = shoot(createDocument(), { x: 0.5, y: 0.5, idempotencyKey: `reward-key-${roll}` }, { roll: () => roll });
    assert.equal(result.response.result.type, type);
    assert.equal(result.response.state.rewards[inventory], amount);
    assert.equal(result.response.state.shots, 2);
    assert.equal(result.response.state.history[0].id, result.response.result.id);
  }
});

test('shot retries preserve the result and do not consume more shots, including after depletion', () => {
  let document = createDocument();
  const first = shoot(document, { x: 0, y: 1, idempotencyKey: 'shot-retry-1' }, { roll: () => 4000 });
  document = first.nextDocument;
  for (let i = 0; i < 2; i++) document = shoot(document, { x: 1, y: 0, idempotencyKey: `other-shot-${i}` }, { roll: () => 4000 }).nextDocument;
  assert.equal(document.state.shots, 0);
  const retry = shoot(document, { x: 0, y: 1, idempotencyKey: 'shot-retry-1' }, { roll: () => 0 });
  assert.deepEqual(retry.response.result, first.response.result);
  assert.equal(retry.response.state.shots, 0);
  assert.throws(() => shoot(document, { x: 0.5, y: 0.5, idempotencyKey: 'new-shot-empty' }), { status: 409 });
  assert.throws(() => shoot(document, { x: 0.5, y: 0.5, idempotencyKey: 'shot-retry-1' }), { status: 409 });
});

test('shot coordinates are checked and only the latest 100 results remain in history', () => {
  for (const x of [-0.01, 1.01, NaN, Infinity, '0.5']) assert.throws(() => shoot(createDocument(), { x, y: 0.5, idempotencyKey: 'valid-shot-key' }), GameError);
  let document = deposit(createDocument(), { amount: 10_000, idempotencyKey: 'history-funding' }).nextDocument;
  for (let i = 0; i < 102; i++) document = shoot(document, { x: 0.5, y: 0.5, idempotencyKey: `history-shot-${i}` }, { roll: () => 4000 }).nextDocument;
  assert.equal(document.state.history.length, 100);
  assert.equal(document.state.rewards.highlights, 102);
});
