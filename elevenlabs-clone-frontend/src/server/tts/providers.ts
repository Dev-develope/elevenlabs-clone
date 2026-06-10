import { env } from "~/env";
import type { TtsProvider } from "~/types/services";
import { providerForVoice } from "./voice-catalog";

// Decides which engine handles a (voice, optional explicit override) tuple.
// Priority:
//   1. Caller-supplied `override` (e.g. a future UI toggle wins immediately).
//   2. The voice's declared provider in VOICE_CATALOG.
//   3. DEFAULT_TTS_PROVIDER env var (the user's blanket fallback).
export function resolveProvider(
  voiceId: string,
  override?: TtsProvider | null,
): TtsProvider {
  if (override) return override;
  const fromCatalog = providerForVoice(voiceId);
  if (fromCatalog) return fromCatalog;
  return env.DEFAULT_TTS_PROVIDER;
}

// Map provider → GeneratedAudioClip.service column. Kept centralized so a
// future renaming of either side stays a one-line change.
export function serviceForProvider(p: TtsProvider): string {
  return p; // currently 1:1; kept as a fn so we can diverge later if needed
}
