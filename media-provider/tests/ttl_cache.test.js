// media-provider/tests/ttl_cache.test.js
const test = require('node:test');
const assert = require('node:assert');
const { createTtlCache } = require('../infra/ttlCache');

test('TtlCache: returns cached value before TTL and expires cleanly at/after TTL', () => {
  let clock = 1000;
  const cache = createTtlCache(500, () => clock);

  cache.set('k1', { ok: true });
  assert.deepStrictEqual(cache.get('k1'), { ok: true });

  clock = 1499;
  assert.deepStrictEqual(cache.get('k1'), { ok: true });

  clock = 1500;
  assert.strictEqual(cache.get('k1'), undefined);
});

test('TtlCache: delete and clear remove entries immediately', () => {
  const cache = createTtlCache(60_000, () => 1000);
  cache.set('a', 1);
  cache.set('b', 2);

  cache.delete('a');
  assert.strictEqual(cache.get('a'), undefined);
  assert.strictEqual(cache.get('b'), 2);

  cache.clear();
  assert.strictEqual(cache.get('b'), undefined);
});
