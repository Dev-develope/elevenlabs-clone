import { type NextRequest } from "next/server";
import { env } from "~/env";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

// POST /api/tts/stream
// Body: { text: string, voice_id: string }
//
// Auth: NextAuth session cookie. We never hand SIXTYDB_API_KEY to the browser;
// this route is the proxy. The upstream returns newline-delimited JSON
// ({"type":"chunk","audioContent":"<base64>"} | {"type":"complete"} | …);
// we forward that same NDJSON stream byte-for-byte so the client can decode
// chunks as they arrive.
//
// Credits are deducted once up front based on character count. If the
// upstream errors mid-stream the user keeps the deduction — same trade-off
// as the existing Inngest path (no partial refunds).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: { text?: string; voice_id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const text = (body.text ?? "").trim();
  const voiceId = body.voice_id ?? "";
  if (!text) return new Response("Missing text", { status: 400 });
  if (text.length > 5000)
    return new Response("Text too long (max 5000)", { status: 400 });
  if (!voiceId) return new Response("Missing voice_id", { status: 400 });

  // Charge 50 credits like every other generation. If the user is broke we
  // refuse before touching the upstream so we don't pay for compute they
  // can't afford to pay back.
  const user = await db.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { credits: true },
  });
  if (user.credits < 50) {
    return new Response("Insufficient credits", { status: 402 });
  }
  await db.user.update({
    where: { id: session.user.id },
    data: { credits: { decrement: 50 } },
  });

  const upstream = await fetch(`${env.SIXTYDB_API_BASE}/tts-stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.SIXTYDB_API_KEY}`,
    },
    body: JSON.stringify({
      text,
      voice_id: voiceId,
      output_format: "mp3",
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const errBody = await upstream.text().catch(() => "");
    return new Response(
      `60db /tts-stream ${upstream.status}: ${errBody.slice(0, 300)}`,
      { status: 502 },
    );
  }

  // Pass the NDJSON straight through. application/x-ndjson keeps proxies
  // from buffering, and we explicitly disable nginx buffering via the
  // X-Accel-Buffering hint for self-hosted deployments.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
