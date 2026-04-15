# System Architecture

This project is an automation livestream backend built with NestJS, orchestrating YouTube Live Streaming with DB-driven encoder workers.

## Main Structure

```text
src/
  app.module.ts
  app.controller.ts
  main.ts
  core/
    config/
    database/
    health/
  common/
    utils/
  feature/
    google-account/
    media/
    livestream/
      youtube/
    encoder/
```

## Folder Roles

- `src/`: All application source code.
- `src/core/`: Shared infrastructure modules (database, health, config).
- `src/common/`: Cross-cutting utilities (encryption).
- `src/feature/`: Business domain modules.
- `src/feature/google-account/`: Manual Google credential management with token encryption and refresh.
- `src/feature/media/`: Media upload (video/audio/image), storage (shared volume), metadata extraction (FFprobe).
- `src/feature/livestream/`: Livestream orchestration, YouTube API integration, runtime config, start/stop/resume.
- `src/feature/livestream/youtube/`: YouTube Live Streaming API v3 wrapper.
- `src/feature/encoder/`: Encoder job control plane (`encoder_jobs`) and health/failover helpers.
- `infra/postgres/init/`: PostgreSQL initialization scripts.
- `docs/`: Project documentation.

## Key Flows

1. **Credential Flow**: User -> Backend CRUD account -> Encrypt token/client secret -> Store in DB
2. **Upload Flow**: User -> Backend (Multer) -> shared media volume -> FFprobe metadata -> DB
3. **Start Livestream**: Backend -> YouTube API (broadcast + stream + bind) -> Upsert `encoder_jobs` = running
4. **Encoder Worker Loop**: `encoder-primary` and `encoder-backup` poll DB and race advisory lock; lock owner streams to YouTube.
5. **Backend Down Scenario**: lock owner encoder keeps streaming because run-state is in DB and worker loop is inside encoder container.
