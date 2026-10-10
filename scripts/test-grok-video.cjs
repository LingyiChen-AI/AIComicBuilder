const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'src/lib/ai/providers/grok-video.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const mod = new Module(file, module);
mod.filename = file;
mod.paths = module.paths;
mod._compile(compiled, file);
const { GrokVideoProvider, normalizeGrokBaseUrl } = mod.exports;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-video-test-'));
const png = path.join(tmp, 'frame.png');
fs.writeFileSync(png, Buffer.from('test-frame'));
const key = 'sk-unit-test-secret';
const params = { prompt: 'Animate a cube', duration: 2, ratio: '9:16', firstFrame: png, lastFrame: png };
const reference = { prompt: 'Animate', duration: 2, ratio: 'auto', initialImage: 'https://images.example/frame.png' };
const options = { apiKey: key, baseUrl: 'https://gateway.example/', uploadDir: tmp, pollIntervalMs: 1, pollTimeoutMs: 1000 };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const media = () => new Response(Buffer.from('mock-mp4'), { headers: { 'Content-Type': 'video/mp4' } });
const submit = () => json({ request_id: 'task/one' });
const done = (url = 'https://cdn.example/video.mp4') => json({ status: 'done', video: { url, respect_moderation: true } });

test('Grok video REST contract', async t => {
  const original = global.fetch;
  t.after(() => { global.fetch = original; fs.rmSync(tmp, { recursive: true, force: true }); });
  async function sequence(responses, run, inspect) {
    const calls = [];
    global.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      assert.ok(responses.length, 'unexpected HTTP request');
      const value = responses.shift();
      if (value instanceof Error) throw value;
      return typeof value === 'function' ? value() : value;
    };
    await run();
    if (inspect) inspect(calls);
  }
  await t.test('normalizes root, /v1, trailing slash and gateway prefix', () => {
    for (const input of ['https://example.com', 'https://example.com/', 'https://example.com/v1', 'https://example.com/v1/']) assert.equal(normalizeGrokBaseUrl(input), 'https://example.com/v1');
    assert.equal(normalizeGrokBaseUrl('https://example.com/proxy/'), 'https://example.com/proxy/v1');
    for (const input of ['file:///tmp', 'https://user:pass@example.com', 'https://example.com?key=secret']) assert.throws(() => normalizeGrokBaseUrl(input));
  });
  await t.test('pins both frames; pending -> done; downloads without exposing Key to CDN', async () => {
    await sequence([submit, json({ status: 'pending' }), done, media], async () => {
      const result = await new GrokVideoProvider(options).generateVideo(params);
      assert.equal(fs.readFileSync(result.filePath, 'utf8'), 'mock-mp4');
    }, calls => {
      const body = JSON.parse(calls[0].init.body);
      assert.equal(calls[0].url, 'https://gateway.example/v1/videos/generations');
      assert.equal(body.model, 'grok-imagine-video-1.5');
      assert.equal(body.aspect_ratio, '9:16');
      assert.equal(body.duration, 2);
      assert.equal(body.resolution, '720p');
      assert.ok(body.image.url.startsWith('data:image/png;base64,'));
      assert.deepEqual(body.last_frame, body.image);
      assert.equal(calls[1].url, 'https://gateway.example/v1/videos/task%2Fone');
      assert.equal(calls[0].init.headers.Authorization, `Bearer ${key}`);
      assert.equal(calls[3].init.headers.Authorization, undefined);
      assert.equal(calls.filter(c => c.init.method === 'POST').length, 1);
    });
  });
  await t.test('reference mode preserves URLs and references, omits auto ratio and last_frame', async () => {
    await sequence([submit, done, media], () => new GrokVideoProvider(options).generateVideo({ ...reference, referenceImages: [png] }), calls => {
      const body = JSON.parse(calls[0].init.body);
      assert.deepEqual(body.image, { url: reference.initialImage });
      assert.ok(body.reference_images[0].url.startsWith('data:image/png;base64,'));
      assert.equal(body.last_frame, undefined);
      assert.equal(body.aspect_ratio, undefined);
    });
  });
  await t.test('same-origin media is authenticated', async () => {
    await sequence([submit, done('https://gateway.example/v1/videos/task/content'), media], () => new GrokVideoProvider(options).generateVideo(reference), calls => assert.equal(calls[2].init.headers.Authorization, `Bearer ${key}`));
  });
  await t.test('gateway relative media URLs resolve against origin and retain authentication', async () => {
    await sequence([submit, done('/v1/videos/task/content'), media], () => new GrokVideoProvider(options).generateVideo(reference), calls => {
      assert.equal(calls[2].url, 'https://gateway.example/v1/videos/task/content');
      assert.equal(calls[2].init.headers.Authorization, `Bearer ${key}`);
    });
  });
  await t.test('old model rejects keyframes before any request, but permits single-image mode', async () => {
    await sequence([], () => assert.rejects(new GrokVideoProvider({ ...options, model: 'grok-imagine-video' }).generateVideo(params), /require grok-imagine-video-1.5/));
    await sequence([submit, done, media], () => new GrokVideoProvider({ ...options, model: 'grok-imagine-video' }).generateVideo(reference));
  });
  await t.test('validates duration, ratio, image format, reference count and missing Key', async () => {
    for (const change of [{ duration: 0 }, { duration: 16 }, { duration: 2.5 }, { duration: NaN }, { ratio: 'bogus' }, { firstFrame: 'frame.gif' }, { prompt: '' }, { referenceImages: Array(15).fill(png) }]) {
      await sequence([], () => assert.rejects(new GrokVideoProvider(options).generateVideo({ ...params, ...change })));
    }
    await sequence([], () => assert.rejects(new GrokVideoProvider({ ...options, apiKey: '' }).generateVideo(params), /API Key/));
    assert.throws(() => new GrokVideoProvider({ ...options, pollTimeoutMs: -1 }));
  });
  await t.test('submit 403 and 429 fail without retry and redact credentials', async () => {
    for (const status of [403, 429]) {
      await sequence([json({ error: { message: `Denied ${key}` } }, status)], () => assert.rejects(new GrokVideoProvider(options).generateVideo(params), error => error.message.includes(String(status)) && !error.message.includes(key)), calls => assert.equal(calls.length, 1));
    }
  });
  await t.test('missing request_id and malformed JSON stop before polling', async () => {
    await sequence([json({})], () => assert.rejects(new GrokVideoProvider(options).generateVideo(params), /request_id/));
    await sequence([new Response('not JSON')], () => assert.rejects(new GrokVideoProvider(options).generateVideo(params)));
  });
  await t.test('retries transient polls, not 401; never resubmits', async () => {
    await sequence([submit, json({}, 503), json({}, 429), done, media], () => new GrokVideoProvider(options).generateVideo(params), calls => assert.equal(calls.filter(c => c.init.method === 'POST').length, 1));
    await sequence([submit, json({}, 401)], () => assert.rejects(new GrokVideoProvider(options).generateVideo(params), /401/));
  });
  await t.test('failed, expired, unexpected status, missing URL and moderation fail clearly', async () => {
    for (const result of [{ status: 'failed', error: { message: key } }, { status: 'expired' }, { status: 'what' }, { status: 'done' }, { status: 'done', video: { url: 'https://cdn.example/video.mp4', respect_moderation: false } }]) {
      await sequence([submit, json(result)], () => assert.rejects(new GrokVideoProvider(options).generateVideo(params), error => !error.message.includes(key)));
    }
  });
  await t.test('pending times out; request timeouts are explicit', async () => {
    global.fetch = async (_, init) => init.method === 'POST' ? submit() : json({ status: 'pending' });
    await assert.rejects(new GrokVideoProvider({ ...options, pollTimeoutMs: 10 }).generateVideo(params), /timed out/);
    await sequence([new DOMException('request aborted', 'TimeoutError')], () => assert.rejects(new GrokVideoProvider(options).generateVideo(params), /request timed out/));
  });
  await t.test('rejects non-HTTP URLs, failed downloads, HTML and empty media', async () => {
    await sequence([submit, done('file:///secret')], () => assert.rejects(new GrokVideoProvider(options).generateVideo(params), /invalid video URL/));
    for (const response of [new Response('no', { status: 404 }), new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }), new Response('', { headers: { 'Content-Type': 'video/mp4' } })]) {
      await sequence([submit, done, response], () => assert.rejects(new GrokVideoProvider(options).generateVideo(params), /download/));
    }
  });
  await t.test('UI, factory and model-list integration expose the new video-only protocol', () => {
    assert.match(fs.readFileSync(path.join(root, 'src/stores/model-store.ts'), 'utf8'), /"grok"/);
    assert.ok(fs.readFileSync(path.join(root, 'src/components/settings/provider-form.tsx'), 'utf8').includes('value: "grok", label: "Grok (xAI)"'));
    assert.match(fs.readFileSync(path.join(root, 'src/lib/ai/provider-factory.ts'), 'utf8'), /case "grok":/);
    assert.match(fs.readFileSync(path.join(root, 'src/app/api/models/list/route.ts'), 'utf8'), /body.protocol === "grok"/);
  });
});
