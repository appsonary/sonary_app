// media-provider/tests/extract_audio_stream.test.js
const test = require('node:test');
const assert = require('node:assert');
const { createTtlCache } = require('../infra/ttlCache');
const { createExtractAudioStreamUseCase } = require('../use-cases/extractAudioStream');
const { MediaProviderUnavailableError } = require('../../services/mediaProvider');

function makeStream(id, streamUrl = 'https://cdn.example.com/audio.m4a') {
  return {
    videoId: id,
    title: 'Track Title',
    artist: 'Track Artist',
    duration: 180,
    thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
    streamUrl,
    mimeType: 'audio/mp4',
    format: 'm4a',
    bitrate: 131072,
    userAgent: 'TestUA/1.0',
    headers: { 'User-Agent': 'TestUA/1.0' },
  };
}

test('ExtractAudioStream: falls back across Strategy pipeline, caches hit, and invalidates cleanly', async () => {
  const calls = [];
  let invalidatedCount = 0;

  const primaryStrategy = {
    name: 'primary-client',
    async extract(id) {
      calls.push(`primary:${id}`);
      throw new Error('HTTP 503');
    },
  };

  const secondaryStrategy = {
    name: 'secondary-client',
    async extract(id) {
      calls.push(`secondary:${id}`);
      return makeStream(id, `https://cdn.example.com/${id}.m4a`);
    },
  };

  const useCase = createExtractAudioStreamUseCase({
    strategies: [primaryStrategy, secondaryStrategy],
    cache: createTtlCache(60_000),
    onInvalidate: () => {
      invalidatedCount += 1;
    },
  });

  const first = await useCase.execute('dQw4w9WgXcQ');
  assert.strictEqual(first.streamUrl, 'https://cdn.example.com/dQw4w9WgXcQ.m4a');
  assert.deepStrictEqual(calls, ['primary:dQw4w9WgXcQ', 'secondary:dQw4w9WgXcQ']);

  // Second call hits TTL cache without touching any strategy
  const second = await useCase.execute('dQw4w9WgXcQ');
  assert.strictEqual(second.streamUrl, first.streamUrl);
  assert.strictEqual(calls.length, 2);

  // Invalidate triggers callback and forces re-extraction
  useCase.invalidateCache('dQw4w9WgXcQ');
  assert.strictEqual(invalidatedCount, 1);
  assert.strictEqual(useCase.getCached('dQw4w9WgXcQ'), undefined);

  await useCase.execute('dQw4w9WgXcQ');
  assert.strictEqual(calls.length, 4);
});

test('ExtractAudioStream: aggregates errors into MediaProviderUnavailableError when all strategies fail', async () => {
  const useCase = createExtractAudioStreamUseCase({
    strategies: [
      {
        name: 'client-a',
        async extract() {
          throw new Error('blocked');
        },
      },
      {
        name: 'client-b',
        async extract() {
          throw new MediaProviderUnavailableError({ 'https://mirror.test': 'HTTP 429' });
        },
      },
    ],
    cache: createTtlCache(60_000),
  });

  await assert.rejects(
    () => useCase.execute('dQw4w9WgXcQ'),
    (err) => {
      assert.ok(err instanceof MediaProviderUnavailableError);
      assert.strictEqual(err.instanceErrors['client-a'], 'blocked');
      assert.strictEqual(err.instanceErrors['https://mirror.test'], 'HTTP 429');
      return true;
    }
  );
});
