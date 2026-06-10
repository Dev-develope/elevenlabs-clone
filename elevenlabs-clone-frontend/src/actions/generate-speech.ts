"use server";

import { revalidatePath } from "next/cache";
import { inngest } from "~/inngest/client";
import { getPresignedUrl, getUploadUrl } from "~/lib/s3";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { resolveProvider, serviceForProvider } from "~/server/tts/providers";
import { ServiceType } from "~/types/services";

export async function generateTextToSpeech(text: string, voice: string) {
  const session = await auth();
  if (!session?.user.id) {
    throw new Error("User not authenticated");
  }

  // Route the request: voice catalog wins, env default fills in for
  // voices the catalog doesn't know about. Result is persisted on the
  // clip row so the Inngest worker fans out to the right backend.
  const provider = resolveProvider(voice);
  const service = serviceForProvider(provider);

  const audioClipJob = await db.generatedAudioClip.create({
    data: {
      text: text,
      voice: voice,
      user: {
        connect: {
          id: session.user.id,
        },
      },
      service,
    },
  });

  await inngest.send({
    name: "generate.request",
    data: {
      audioClipId: audioClipJob.id,
      userId: session.user.id,
    },
  });

  return {
    audioId: audioClipJob.id,
    shouldShowThrottleAlert: await shouldShowThrottleAlert(session.user.id),
  };
}

export async function generateSpeechToSpeech(
  originalVoiceS3Key: string,
  voice: string,
) {
  const session = await auth();
  if (!session?.user.id) {
    throw new Error("User not authenticated");
  }

  const audioClipJob = await db.generatedAudioClip.create({
    data: {
      originalVoiceS3Key: originalVoiceS3Key,
      voice: voice,
      user: {
        connect: {
          id: session.user.id,
        },
      },
      service: "seedvc",
    },
  });

  await inngest.send({
    name: "generate.request",
    data: {
      audioClipId: audioClipJob.id,
      userId: session.user.id,
    },
  });

  return {
    audioId: audioClipJob.id,
    shouldShowThrottleAlert: await shouldShowThrottleAlert(session.user.id),
  };
}

export async function generateSoundEffect(prompt: string) {
  const session = await auth();
  if (!session?.user.id) {
    throw new Error("User not authenticated");
  }

  const audioClipJob = await db.generatedAudioClip.create({
    data: {
      text: prompt,
      user: {
        connect: {
          id: session.user.id,
        },
      },
      service: "make-an-audio",
    },
  });

  await inngest.send({
    name: "generate.request",
    data: {
      audioClipId: audioClipJob.id,
      userId: session.user.id,
    },
  });

  return {
    audioId: audioClipJob.id,
    shouldShowThrottleAlert: await shouldShowThrottleAlert(session.user.id),
  };
}

const shouldShowThrottleAlert = async (userId: string) => {
  const oneMinuteAgo = new Date();
  oneMinuteAgo.setMinutes(oneMinuteAgo.getMinutes() - 1);

  const count = await db.generatedAudioClip.count({
    where: {
      userId: userId,
      createdAt: {
        gte: oneMinuteAgo,
      },
    },
  });

  return count > 3;
};

export async function generationStatus(
  audioId: string,
): Promise<{ success: boolean; audioUrl: string | null }> {
  const session = await auth();

  const audioClip = await db.generatedAudioClip.findFirstOrThrow({
    where: { id: audioId, userId: session?.user.id },
    select: {
      id: true,
      failed: true,
      s3Key: true,
      service: true,
    },
  });

  if (audioClip.failed) {
    revalidateBasedOnService(audioClip.service as ServiceType);
    return { success: false, audioUrl: null };
  }

  if (audioClip.s3Key) {
    revalidateBasedOnService(audioClip.service as ServiceType);
    return {
      success: true,
      audioUrl: await getPresignedUrl({ key: audioClip.s3Key }),
    };
  }

  return {
    success: true,
    audioUrl: null,
  };
}

const revalidateBasedOnService = async (service: ServiceType) => {
  switch (service) {
    case "styletts2":
    case "60db-sync":
      // Both TTS engines feed the same history page — keep them in sync.
      revalidatePath("/app/speech-synthesis/text-to-speech");
      break;
    case "seedvc":
      revalidatePath("/app/speech-synthesis/speech-to-speech");
      break;
    case "make-an-audio":
      revalidatePath("/app/sound-effects/history");
      break;
  }
};

export async function generateUploadUrl(fileType: string) {
  const session = await auth();
  if (!session?.user.id) {
    throw new Error("User not authenticated");
  }

  return await getUploadUrl(fileType);
}
