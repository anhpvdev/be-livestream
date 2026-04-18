# Live Stream System

Hệ thống gồm 2 service chính:

- `be-livestream`: **control-plane**
- `stream-encoder`: **playback-plane worker**

Mục tiêu kiến trúc: sau khi BE tạo job `running`, encoder tự vận hành playlist/failover theo DB.  
Nếu `be-livestream` sập tạm thời nhưng DB vẫn sống, stream vẫn chạy.

## Kiến trúc runtime

### `be-livestream` (control-plane)

- Quản lý account/media/profile/vps/livestream
- Tạo hoặc stop job trong `encoder_jobs`
- Cập nhật profile/media (nguồn playlist)
- Quan sát health/progress (không trigger failover playback)

### `stream-encoder` (playback-plane)

- Poll `encoder_jobs` từ DB
- Tự load profile media list từ DB và phát liên tục
- Tự xử lý ownership lease (`owner_node`, `owner_epoch`, `lease_until`)
- Tự quyết định chuyển bài, loop, takeover khi node khác mất lease
- Ghi runtime state về DB (`current_video_index`, `current_media_id`, timestamp, active_node...)

## Khởi động nhanh

### 1) Chạy BE + Postgres

```bash
cd be-livestream
cp .env.example .env
docker compose up -d
yarn install
yarn start:dev
```

### 2) Chạy encoder worker

```bash
cd ../stream-encoder
cp .env.example .env
docker compose up -d --build
```

Hoặc deploy từng node theo port:

```bash
./deploy.sh 8002
./deploy.sh 8003
```

## URL mặc định

- Backend API: `http://localhost:3000/api`
- Swagger: `http://localhost:3000/api/docs`
- Encoder health ví dụ:
  - `http://localhost:8001/health`
  - `http://localhost:8002/health`

## Quy trình vận hành cơ bản

1. Tạo Google account
2. Upload media
3. Tạo profile (danh sách media)
4. Preflight
5. Start livestream
6. Theo dõi status
7. Stop livestream

## Ghi chú kỹ thuật quan trọng

- BE không được reset runtime cursor playlist khi stream đang chạy.
- Runtime playback state là worker ownership.
- `seek_mode` chỉ dùng cho command explicit; path normal phát từ đầu clip mới.

## Tắt toàn bộ

```bash
cd be-livestream && docker compose down
cd ../stream-encoder && docker compose down
```
