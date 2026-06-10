// Service identifiers stored on GeneratedAudioClip.service.
// - styletts2:    self-hosted StyleTTS2 (TTS)
// - seedvc:       self-hosted Seed-VC (voice conversion)
// - make-an-audio: self-hosted Make-An-Audio (text-to-SFX)
// - 60db-sync:    60db cloud TTS via REST /tts-synthesize
//                 (streaming + WS variants don't persist as clips — they're
//                  played live and only credit-deducted after the fact)
export type ServiceType =
  | "styletts2"
  | "seedvc"
  | "make-an-audio"
  | "60db-sync";

export type TtsProvider = "styletts2" | "60db-sync";
