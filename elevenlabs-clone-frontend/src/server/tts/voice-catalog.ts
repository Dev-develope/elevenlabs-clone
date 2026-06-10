import type { TtsProvider } from "~/types/services";

// Single source of truth for which voice belongs to which TTS provider.
// The voice picker reads this list; the server uses `providerForVoice()`
// to route requests to the correct backend. Add new entries here only —
// do not duplicate this mapping anywhere else.
export interface VoiceEntry {
  // Stable id sent from the browser. For 60db voices this is the UUID
  // expected by /tts-synthesize (`voice_id`). For StyleTTS2 it's the
  // `target_voice` slug the self-hosted FastAPI accepts.
  id: string;
  // Human-friendly label for the voice picker.
  label: string;
  // Which engine answers calls for this voice.
  provider: TtsProvider;
}

export const VOICE_CATALOG: VoiceEntry[] = [
  // ---- StyleTTS2 (self-hosted, reference WAVs baked into the model image) ----
  { id: "andreas", label: "Andreas (StyleTTS2)", provider: "styletts2" },
  { id: "woman", label: "Woman (StyleTTS2)", provider: "styletts2" },

  // ---- 60db cloud voices (UUIDs from docs.60db.ai) ----
  // Swap these UUIDs for your actual 60db voice library entries.
  {
    id: "fbb75ed2-975a-40c7-9e06-38e30524a9a1",
    label: "60db Default",
    provider: "60db-sync",
  },
];

// Resolve a voice id back to its provider. Returns null when unknown
// so callers can fall back to DEFAULT_TTS_PROVIDER from env.
export function providerForVoice(voiceId: string): TtsProvider | null {
  return VOICE_CATALOG.find((v) => v.id === voiceId)?.provider ?? null;
}

// Grouped view for the voice picker (UI consumes this directly).
export function voicesByProvider(): Record<TtsProvider, VoiceEntry[]> {
  return {
    styletts2: VOICE_CATALOG.filter((v) => v.provider === "styletts2"),
    "60db-sync": VOICE_CATALOG.filter((v) => v.provider === "60db-sync"),
  };
}
