# stream-encoder

Worker encoder độc lập (NestJS + FFmpeg). Service này đọc job từ DB và tự encode/push RTMP lên YouTube theo desired state.

## Chức năng chính

- Poll bảng `encoder_jobs` từ PostgreSQL
- Chạy FFmpeg stream theo job hiện tại
- Gửi heartbeat/progress về DB
- Prefetch media kế tiếp vào cache cục bộ (tránh tải lặp nếu đã có sẵn)
- Tự dọn cache khi media bị xoá khỏi profile
- API vận hành:
  - `GET /health`
  - `POST /probe-media`
  - `POST /stop`

## Chạy local

```bash
cp .env.example .env
yarn
yarn start:dev
```

## Chạy bằng Docker Compose (khuyến nghị)

```bash
cp .env.example .env
docker compose up -d --build
```

Compose này chạy 2 node:
- `encoder-primary` tại `http://localhost:8081`
- `encoder-backup` tại `http://localhost:8082`

## Yêu cầu trước khi chạy

- `be-livestream` đã chạy PostgreSQL và đã migrate schema
- Thư mục media được mount đúng vào `/data/media`
- Cấu hình DB trong `.env` trỏ đúng host/port của Postgres
- Cấu hình prefetch (tuỳ chọn):
  - `ENGINE_PREFETCH_ENABLED=true`
  - `ENGINE_PREFETCH_LOG_SKIPS=false` (mặc định tắt log spam “Prefetch skip”)
  - `ENGINE_CACHE_DIR=/tmp/encoder-cache`
