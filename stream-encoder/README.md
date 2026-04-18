# stream-encoder

Worker encoder độc lập (NestJS + FFmpeg). Service này đọc job từ DB và tự encode/push RTMP lên YouTube theo desired state.

## Chức năng chính

- Poll bảng `encoder_jobs` từ PostgreSQL
- Chạy FFmpeg stream theo job hiện tại
- Gửi heartbeat/progress về DB
- Tự quản lý ownership lease và runtime playlist cursor
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

Compose chạy đồng thời 3 container (`node-1` … `node-3`), mỗi cổng:
- `http://localhost:8081`
- `http://localhost:8082`
- `http://localhost:8083`

## Deploy nhanh 1 encoder theo port

Chạy 1 container stream-encoder với port tùy ý:

```bash
npm run deploy -- 5000
```

Hoặc script tắt theo port cố định:

```bash
npm run 5000
```

Bạn cũng có thể dùng script shell:

```bash
./deploy.sh 5000
```

Mỗi port sẽ có project compose riêng (`stream-encoder-<port>`), nên có thể chạy nhiều node song song.

### Định danh và vai trò node

- Mỗi container có `hostname` riêng (`encoder-node-1` …). Process dùng `HOSTNAME` làm định danh runtime (lease/heartbeat, webhook đăng ký VPS).
- Vai trò main/backup là runtime theo từng livestream: node owner đẩy URL primary, follower đẩy backup theo DB state.
- Không cần cấu hình role cố định trong env.

### Boundary với BE (quan trọng)

- `be-livestream` chỉ là control-plane: tạo/stop job, update profile/media.
- `stream-encoder` là playback-plane: tự quyết định phát/lặp/chuyển bài/takeover.
- Khi job đã `running`, BE có thể down tạm thời mà stream vẫn chạy nếu DB còn hoạt động.

## Yêu cầu trước khi chạy

- `be-livestream` đã chạy PostgreSQL và đã migrate schema
- Thư mục media được mount đúng vào `/data/media`
- Cấu hình DB trong `.env` trỏ đúng host/port của Postgres
- Cấu hình prefetch (tuỳ chọn):
  - `ENGINE_PREFETCH_ENABLED=true`
  - `ENGINE_PREFETCH_LOG_SKIPS=false` (mặc định tắt log spam “Prefetch skip”)
  - `ENGINE_CACHE_DIR=/tmp/encoder-cache`
