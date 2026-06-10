![alt text](thumbnail.png)

[Part 1](https://www.youtube.com/watch?v=48A-E-xJPMo)
[Part 2](https://www.youtube.com/watch?v=9kkcaPiNjHU)

[Discord and more](https://www.andreastrolle.com/)

## Overview

Hi 🤙 In this video, you'll build a full-stack ElevenLabs clone with text-to-speech, voice conversion, and audio generation. Instead of external API services, you'll self-host three AI models (StyleTTS2, Seed-VC, and Make-An-Audio) from GitHub, fine-tune them to specific voices, then containerize them with Docker and expose inference endpoints via FastAPI. The AI backend will be built using Python and PyTorch. You'll create a Next.js application where users can use the AI models to generate audio, and also switch between voices and view previously generated audio files, stored in an S3 bucket. The project includes user authentication, a credit system, and an Inngest queue to prevent overloading of the server hosting the AI models. The web application is built on the T3 Stack with Next.js, React, Tailwind, and Auth.js. Follow along for the entire process from development to deployment.

Features:

- 🔊 Text-to-speech synthesis with StyleTTS2
- 🎭 Voice conversion with Seed-VC
- 🎵 Audio generation from text with Make-An-Audio
- 🤖 Custom voice fine-tuning capabilities
- 🐳 Docker containerization of AI models
- 🚀 FastAPI backend endpoints
- 📊 User credit management system
- 🔄 Inngest queue to prevent server overload
- 💾 AWS S3 for audio file storage
- 👥 Multiple pre-trained voice models
- 📱 Responsive Next.js web interface
- 🔐 User authentication with Auth.js
- 🎛️ Voice picker
- 📝 Generated audio history
- 🎨 Modern UI with Tailwind CSS

## Models Used in Video

- Voice-to-voice: [seed-vc](https://github.com/Plachtaa/seed-vc)
- Text-to-speech fine-tuning: [StyleTTS2FineTune](https://github.com/IIEleven11/StyleTTS2FineTune)
- Text-to-speech: [StyleTTS2](https://github.com/yl4579/StyleTTS2)
- Text-to-SFX: [Make-an-audio](https://github.com/Text-to-Audio/Make-An-Audio)

## Setup

Follow these steps to install and set up the project.

### Clone the Repository

```bash
git clone https://github.com/Andreaswt/elevenlabs-clone.git
```

### Navigate to the Project Directory

```bash
cd elevenlabs-clone
```

### Install Python

Download and install Python if not already installed. Use the link below for guidance on installation:
[Python Download](https://www.python.org/downloads/)

Create a virtual environment for each folder, except elevenlabs-clone-frontend, with **Python 3.10**.

### Dependencies

Next.js frontend:

```bash
cd elevenlabs-clone-frontend
npm i
```

Folders with AI models:

```bash
cd seed-vc # For example
pip install -r requirements.txt
```

### IAM users and roles required

1. User: styletts2-api
   Required to upload audio files to an S3 bucket for voice conversion, and getting S3 items.

Add custom policy:

```
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:GetObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::elevenlabs-clone",
                "arn:aws:s3:::elevenlabs-clone/*"
            ]
        }
    ]
}
```

2. Role: elevenlabs-clone-ec2
   Attach to an EC2 instance to be allowed to interact with S3 and ECR.

Permissions:

- AmazonEC2ContainerRegistryFullAccess
- AmazonS3FullAccess

Add custom policy:

```
{
	"Version": "2012-10-17",
	"Statement": [
		{
			"Effect": "Allow",
			"Action": [
				"s3:PutObject",
				"s3:GetObject",
				"s3:ListBucket"
			],
			"Resource": [
				"arn:aws:s3:::elevenlabs-clone",
				"arn:aws:s3:::elevenlabs-clone/*"
			]
		}
	]
}
```

## 60db TTS Provider (cloud, alongside StyleTTS2)

The frontend can route text-to-speech requests to either the self-hosted **StyleTTS2** container or the cloud **60db** API. Three 60db surfaces are wired in:

| Surface | Endpoint | UX |
|---|---|---|
| Sync REST | `POST https://api.60db.ai/tts-synthesize` | Same flow as StyleTTS2 — job queued through Inngest, audio uploaded to S3 under `sixtydb-output/`, shown in history. |
| NDJSON Stream | `POST https://api.60db.ai/tts-stream` | Browser fetches `/api/tts/stream`, audio plays back chunk-by-chunk via MediaSource. |
| WebSocket | `wss://api.60db.ai/ws/tts` | Browser opens `ws://…3001/tts` (sidecar), full bidirectional realtime. |

### Routing

Routing is driven by the **voice catalog** in `src/server/tts/voice-catalog.ts`:

- Each voice declares its `provider` (`styletts2` or `60db-sync`).
- Server actions call `resolveProvider(voiceId)`; the result becomes `GeneratedAudioClip.service`.
- Inngest fans out to the right backend on that column.
- `DEFAULT_TTS_PROVIDER` env var is the fallback for voices the catalog doesn't recognise.

### Required env vars

Append to `.env`:

```
SIXTYDB_API_KEY=sk_...                        # mandatory
SIXTYDB_API_BASE=https://api.60db.ai          # optional, default shown
DEFAULT_TTS_PROVIDER=styletts2                # styletts2 | 60db-sync
WS_PROXY_SECRET=<random 32+ char secret>      # mandatory if you use WS
NEXT_PUBLIC_WS_PROXY_URL=ws://localhost:3001/tts   # public-side URL
```

### Running the WebSocket sidecar

The sidecar lives in `ws-proxy/` (separate Node process) so the Next.js app stays deployable to any host, including Vercel. From `elevenlabs-clone-frontend/`:

```bash
# one-time: install sidecar deps (auto-done by the scripts below)
npm run ws-proxy        # production (node server.js)
npm run ws-proxy:dev    # auto-reload on edits
```

The sidecar requires `SIXTYDB_API_KEY`, `WS_PROXY_SECRET`, and (optionally) `PORT` / `SIXTYDB_API_BASE` in its environment.
