# Grok / xAI video integration

## Plan and acceptance criteria

1. Add an independent `grok` video protocol without changing existing providers or persisted selections.
2. Implement the documented xAI REST contract, including both first and last frames on Grok 1.5.
3. Verify mock HTTP contracts, negative cases, type checking, lint, production build and an opt-in live smoke test.
4. Publish an issue and linked PR without credentials, local databases, user prompts or generated media.

## Configuration

In Settings → Video models, select **Grok (xAI)**. Use `https://api.x.ai` or an xAI-compatible gateway root, plus its API Key. A Base URL ending in `/v1` is also accepted; `/v1` is appended only once. Fetch models or manually enter the model ID exposed by your gateway (for example `grok-imagine-video-1.5`). The model list is filtered to Grok video models. Switching protocol preserves custom gateway URLs and existing selections.

The adapter uses:

- `POST {base}/v1/videos/generations` → `request_id`
- `GET {base}/v1/videos/{request_id}` → `pending`, `done` or `failed`
- `done.video.url` → download and persist under `uploads/videos`

Keyframe mode sends `image: {url}` and `last_frame: {url}`. Reference mode sends `image` and, when provided, `reference_images: [{url}, …]`. Local PNG/JPEG/WebP images become base64 data URIs; HTTP(S) URLs remain URLs. Grok 1.5 supports pinned last frames and combined image/reference inputs. Older models are rejected for these modes instead of silently dropping constraints; single-image reference mode remains supported. Gateway aliases must include `video-1.5` to opt into those capabilities.

Duration must be an integer from 1–15 seconds. Output resolution is 720p. Auto ratio omits `aspect_ratio`. xAI image-to-video follows the input image ratio; setting a different ratio does not crop/resize the input. No automatic submission retry is performed. Transient 429/5xx polling errors are retried within a 10-minute deadline; permanent errors, malformed responses and downloads fail explicitly. Keys are redacted from adapter errors and are not sent to a different-origin media CDN.

## Expected tests

Run `pnpm test:grok-video` (Node 18+). Uses the existing TypeScript dependency to compile only the provider into memory; no new runtime or test dependency. Mocked tests cover:

- Base URL normalization and invalid URLs
- Bearer authentication; first/last-frame mapping and data URIs
- Reference images, auto ratio and older-model capability checks
- pending → done polling, encoded task IDs and transient reads
- Invalid duration/ratio/images, missing Key and excess references
- Submission errors, no duplicate submissions and credential redaction
- Malformed JSON, missing task IDs, failed/expired/unknown states
- Missing video URL, moderation failure, request/poll timeouts
- CDN credential isolation and authenticated same-origin downloads
- Download HTTP failure, HTML responses, empty media and saved bytes
- UI/factory/model-list wiring (static integration assertions)

Also run `pnpm exec tsc --noEmit`, targeted ESLint and `pnpm build`. A live test creates **one** short synthetic clip using explicit local environment credentials; do not include credentials, generated media or gateway-specific private data in the PR. A successful mock test does not establish gateway availability.

## Rollback

For a merged change, revert the feature commit and rebuild. Before reverting, change any provider using `grok` to another supported provider or remove it in Settings. Do not reinterpret an existing Grok model as Seedance. No database migrations are introduced and old provider configuration is unchanged.

## Protocol references

- https://docs.x.ai/developers/model-capabilities/video/generation
- https://docs.x.ai/developers/model-capabilities/video/reference-to-video#first--last-frame
- https://docs.x.ai/developers/model-capabilities/video/image-to-video
