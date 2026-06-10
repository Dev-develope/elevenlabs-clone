import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "~/env";

// One-shot REST call to 60db's POST /tts-synthesize.
// Returns the synthesized audio as a Buffer + the encoding 60db chose,
// so the caller (Inngest worker) can decide where to persist it.
export interface SixtyDbSyncResult {
  audio: Buffer;
  outputFormat: string; // "mp3" | "wav" | "ogg" | "flac"
  sampleRate: number;
  durationSeconds: number;
}

export async function synthesizeWithSixtyDb(args: {
  text: string;
  voiceId: string;
}): Promise<SixtyDbSyncResult> {
  const res = await fetch(`${env.SIXTYDB_API_BASE}/tts-synthesize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.SIXTYDB_API_KEY}`,
    },
    body: JSON.stringify({
      text: args.text,
      voice_id: args.voiceId,
      enhance: true,
      speed: 1,
      stability: 50,
      similarity: 75,
      // mp3 = universal browser support + smallest payload.
      // Matches the rest of the clone's persisted clips.
      output_format: "mp3",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`60db /tts-synthesize ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    success: boolean;
    message?: string;
    audio_base64: string;
    sample_rate: number;
    duration_seconds: number;
    encoding: string;
    output_format: string;
  };

  if (!data.success || !data.audio_base64) {
    throw new Error(`60db /tts-synthesize returned no audio: ${data.message ?? "unknown"}`);
  }

  return {
    audio: Buffer.from(data.audio_base64, "base64"),
    outputFormat: data.output_format,
    sampleRate: data.sample_rate,
    durationSeconds: data.duration_seconds,
  };
}

// Persist a synthesized buffer to S3 under the 60db-specific prefix so the
// history page can list it next to StyleTTS2/Seed-VC clips.
const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

export async function uploadSixtyDbAudio(args: {
  audio: Buffer;
  outputFormat: string;
  audioId: string;
}): Promise<{ s3Key: string }> {
  const ext = args.outputFormat || "mp3";
  const contentTypeMap: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    flac: "audio/flac",
  };
  const s3Key = `sixtydb-output/${args.audioId}.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: s3Key,
      Body: args.audio,
      ContentType: contentTypeMap[ext] ?? "application/octet-stream",
    }),
  );

  return { s3Key };
}
