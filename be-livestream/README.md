# be-livestream

Backend control-plane cho hệ thống livestream.

## Trách nhiệm chính

- Quản lý Google account, media, profile, livestream, encoder VPS
- Tạo/stop encoder job trong DB (`encoder_jobs`)
- Cung cấp API status/quan sát
- Không điều phối playback runtime của worker (không orchestrate failover playback)

## Khởi động local

```bash
cp .env.example .env
docker compose up -d
yarn install
yarn start:dev
```

## Kiến trúc control-plane vs playback-plane

- `be-livestream`: ghi control state
  - `desired_state`, profile/media mapping, vps mapping, ingest config
- `stream-encoder`: ghi runtime playback state
  - `current_video_index`, `current_media_id`, timestamps, ownership lease, active node

Mục tiêu: nếu BE down tạm thời, worker vẫn phát bình thường miễn DB còn sống.
