# Live Stream System

Tổng quan hệ thống livestream tách thành 2 service độc lập  `be-livestream` + `stream-encoder`.

## Các service trong workspace

- `be-livestream`: control-plane API, quản lý account/media/profile/livestream
- `stream-encoder`: worker encode, poll DB và push RTMP (primary + backup)

## Khởi chạy dự án


### 1) Khởi động backend + CSDL

```bash
cd be-livestream
cp .env.example .env
docker compose up -d

yarn install
yarn start:dev
```

### 2) Khởi động encoder nodes

```bash
cd ../stream-encoder
cp .env.example .env
docker compose up -d --build
```

## URLs mặc định

- Backend API: `http://localhost:3000/api`
- Swagger: `http://localhost:3000/api/docs`
- Encoder primary health: `http://localhost:8081/health`
- Encoder backup health: `http://localhost:8082/health`

## Quy trình livestream tối thiểu

1. Add Google account credential (oauth 2.0)
2. Upload file media lên media storage
3. Tạo profile (chưa các file media cần livesteam)
4. Chạy `preflight` để test xem các encoder service đã hoạt động chưa
5. Start livestream bằng `googleAccountId` + `profileId`
6. Theo dõi status/health
7. Stop livestream

## Định hướng kiến trúc encoder HA (không loạn playlist)

Mục tiêu vận hành dài hạn:

- Playlist phải chạy đúng thứ tự tuyệt đối: `1 -> 2 -> 3 -> ... -> n -> 1`
- Không có tình trạng 2 encoder tranh quyền đổi bài gây loạn stream
- Khi 1 node chết, node còn lại takeover mà không làm gián đoạn luồng phát

### Ý tưởng cốt lõi

- Tách vai trò thành 2 lớp:
  - **Playback Authority**: node duy nhất được quyền quyết định cursor playlist (`current_video_index`, `current_media_id`)
  - **Uploader Follower**: node còn lại chỉ follow state đã được authority công bố
- Dùng cơ chế **ownership lease** trong DB:
  - `owner_node` + `lease_until`
  - chỉ owner mới được cập nhật cursor playlist
  - khi owner chết (quá lease timeout), follower takeover và trở thành owner mới
- Dùng **generation/version** cho mỗi lần chuyển bài:
  - mỗi lần sang bài mới tăng `generation`
  - update có điều kiện theo generation để tránh ghi đè race-condition

### Đổi tên node để phản ánh đúng vai trò

- Dùng tên trung lập:
  - `encoder-node-1`
  - `encoder-node-2`
- Vai trò owner/follower là trạng thái runtime (qua lease), không gắn cứng vào tên.
- Ban đầu có thể ưu tiên `node-1` là owner; nếu `node-1` chết thì `node-2` takeover.
- Khi `node-1` quay lại, nó chạy ở follower mode, không giành quyền ngay.

### Nguyên tắc an toàn

- Chỉ một writer cho playlist cursor tại mọi thời điểm
- Follower không tự advance playlist dù local process vừa complete
- Mọi thao tác chuyển bài phải idempotent và có transaction lock
- Failover phải đổi owner trước, rồi mới cho phép node mới cập nhật cursor

### Spec kỹ thuật triển khai (phase 1)

#### 1) Ownership lease trên `encoder_jobs`

Thêm các field:

- `owner_node` (varchar)
- `owner_epoch` (int)
- `lease_until` (timestamptz)

`stream-encoder` tự đảm bảo cột tồn tại khi startup (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) để rollout an toàn.

#### 2) Quy tắc acquire/renew ownership

Mỗi vòng poll, node sẽ chạy update có điều kiện:

- Nếu đang là owner hiện tại -> gia hạn lease
- Nếu chưa có owner hoặc lease đã hết -> takeover
- Nếu owner còn lease hợp lệ và là node khác -> không được ghi quyền

Lease mặc định:

- `ENGINE_OWNER_LEASE_MS=6000`

#### 3) Quyền cập nhật cursor playlist

Chỉ owner mới được:

- advance `current_video_index`
- ghi `current_media_id` về DB

Follower chỉ đọc cursor và phát theo. Khi owner chết và lease timeout, follower takeover và mới được phép ghi cursor.

#### 4) Fencing token

`owner_epoch` tăng khi đổi owner, dùng làm token chống split-brain ở các phase tiếp theo (write có điều kiện theo epoch).

#### 6) Phase 2 (đã triển khai): epoch-fenced write path

- Các thao tác cập nhật playlist cursor (`current_video_index`, `current_media_id`) bắt buộc đi qua điều kiện:
  - `owner_node = <this_node>`
  - `owner_epoch = <epoch_đã_claim>`
- Nếu update cursor không qua được fencing condition thì node tự hạ về follower mode cho vòng poll đó.
- Heartbeat chỉ được phép ghi đè `current_media_id` khi fencing condition còn hợp lệ.
- Mục tiêu: node mất ownership không thể ghi nhầm cursor dù process vẫn còn chạy.

#### 7) Phase 3 (đã triển khai): playlist_generation compare-and-swap

- Thêm `playlist_generation` trên `encoder_jobs` (default `0`).
- Mỗi lần owner advance playlist, update cursor theo CAS:
  - chỉ update nếu `playlist_generation` hiện tại đúng bằng `expected_generation`.
- Nếu CAS fail (generation đã bị thay đổi), node dừng quyền controller ở vòng poll đó và fallback follower mode.
- Kết quả: chuyển bài theo cơ chế exactly-once ở cấp DB state, tránh double-advance do race.

#### 5) Behavior khi clip hoàn tất

- Node owner phát hiện `completed` -> advance đúng 1 bước theo modulo danh sách
- Node follower không tự advance
- Bài mới luôn start từ `seek=00:00:00.000` để tránh carry seek cũ

## Tắt toàn bộ

```bash
cd be-livestream && docker compose down
cd ../stream-encoder && docker compose down
```
