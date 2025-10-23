# Audio Service

This service provides Speech-to-Text (STT) and Text-to-Speech (TTS) capabilities for the microservices-based cafe application. It acts as a bridge between the frontend and the Speaches service.

## Features

- **Speech-to-Text (STT)**: Converts audio recordings to text using Speaches AI
- **Text-to-Speech (TTS)**: Converts text responses to natural-sounding speech
- **Voice Ordering**: Complete voice-based ordering workflow integration

## API Endpoints

### POST /api/stt
Converts audio to text.

**Request:**
- `Content-Type: multipart/form-data`
- Body: `audio` file (webm, ogg, wav, etc.)

**Response:**
```json
{
  "text": "I'd like a large cappuccino please",
  "language": "en"
}
```

### POST /api/tts
Converts text to speech.

**Request:**
```json
{
  "text": "Your order has been added to the cart",
  "voice": "af_sky"
}
```

**Response:**
- `Content-Type: audio/wav`
- Body: Audio file (WAV format)

### POST /api/voice-order
Complete voice order processing (STT only, chat processing happens in frontend).

**Request:**
- `Content-Type: multipart/form-data`
- Body: `audio` file

**Response:**
```json
{
  "text": "Two espressos and a latte",
  "language": "en"
}
```

## Environment Variables

- `PORT`: Service port (default: 8001)
- `SPEACHES_SERVICE_URL`: URL of the Speaches service (default: http://speaches-service:8000)

## Dependencies

- Express.js for HTTP server
- Multer for file uploads
- Axios for HTTP requests to Speaches service
- Form-data for multipart/form-data handling

## Usage in Docker Compose

The service is already configured in `docker-compose.yml`:

```yaml
audio-service:
  build:
    context: ./src/audio-service
  ports:
    - "8001:8001"
  environment:
    - SPEACHES_SERVICE_URL=http://speaches-service:8000
  depends_on:
    - speaches-service
```

## Development

To run locally:

```bash
cd src/audio-service
npm install
npm run dev
```

## Architecture

The audio service follows this flow:

1. **Frontend** → Records audio using browser MediaRecorder API
2. **Frontend** → Sends audio to `/audio/stt` endpoint (proxied through frontend)
3. **Frontend Router** → Forwards to audio-service
4. **Audio Service** → Forwards to speaches-service for transcription
5. **Audio Service** → Returns transcribed text
6. **Frontend** → Processes text through chat-service for order understanding
7. **Frontend** → Receives response and optionally converts to speech via `/audio/tts`

This architecture keeps the frontend simple while allowing the audio-service to handle the complexity of interacting with the Speaches AI service.

