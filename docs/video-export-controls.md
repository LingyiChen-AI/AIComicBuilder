# Video export controls

Episode preview offers subtitles (on by default), shot-defined transitions (default) or a uniform transition, and a ZIP of the current version/mode active clips.

Supported transitions: hard cut, fade, dissolve, fade through black/white, wipe left/right, slide left/right, circle open/close, pixelize. Effects overlap up to 0.5 seconds (short clips are capped); audio crossfades over the same interval. Subtitle timings use actual media duration and overlap offsets. Turning subtitles off skips SRT generation and burn-in. Original clips are unchanged.

Tests: `pnpm test:video-export` (requires ffmpeg/ffprobe on PATH, or FFMPEG_PATH/FFPROBE_PATH). Covers parameter validation, subtitle on/off, all transitions, mixed/silent/different-size clips, 31-clip stress test, single/missing clip, ZIP bytes/order/path validation. Run `pnpm test:grok-video`, `pnpm exec tsc --noEmit`, targeted ESLint and production build as regressions.

No database migration. Feature branch is based on codex/grok-video-provider; review the delta against that branch. Original main checkout and local compatibility edits are preserved.

Preview confirmation: changed settings hide the old final player. Confirm rebuilds and verifies media before switching the player; export settings are stored beside the rendered file and returned with the episode for reloads. Original intra-clip effects remain unchanged.
