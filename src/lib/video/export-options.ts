export const TRANSITIONS = ['cut', 'fade', 'dissolve', 'fadeblack', 'fadewhite', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'circleopen', 'circleclose', 'pixelize'] as const;
export type TransitionType = typeof TRANSITIONS[number] | 'fade_in' | 'fade_out';
export function parseExportOptions(payload?: Record<string, unknown>) {
  if (payload?.subtitlesEnabled !== undefined && typeof payload.subtitlesEnabled !== 'boolean') throw new Error('subtitlesEnabled must be a boolean');
  const transition = payload?.transition ?? 'shot';
  if (transition !== 'shot' && !TRANSITIONS.includes(transition as typeof TRANSITIONS[number])) throw new Error('Unsupported transition');
  if (payload?.mode !== undefined && !['keyframe', 'reference'].includes(String(payload.mode))) throw new Error('Unsupported video mode');
  return { subtitlesEnabled: payload?.subtitlesEnabled !== false, transition: transition as 'shot' | TransitionType, mode: payload?.mode as 'keyframe' | 'reference' | undefined };
}
export function transitionOverlap(type: TransitionType, left: number, right: number) {
  return type === 'cut' ? 0 : Math.floor(Math.min(0.5, left / 3, right / 3) * 30) / 30;
}
