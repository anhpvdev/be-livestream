# Live Stream System

Tổng quan hệ thống livestream tách thành 2 service độc lập  `be-livestream` + `stream-encoder`.

## Các service trong workspace

- `be-livestream`: control-plane API, quản lý account/media/profile/livestream
- `stream-encoder`: worker encode, poll DB và push RTMP (primary + backup)
- `encoder-monitor` (optional): theo dõi AVG CPU/RAM của 2 encoder

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

### 3) (Tuỳ chọn) Khởi động monitor  (để do cpu/ram usage)

```bash
cd ../encoder-monitor
cp .env.example .env
```
check và gán docker container id của 2 encoder container vào biêns TARGET_CONTAINERS
```bash
yarn install
yarn start:dev
```

## URLs mặc định

- Backend API: `http://localhost:3000/api`
- Swagger: `http://localhost:3000/api/docs`
- Encoder primary health: `http://localhost:8081/health`
- Encoder backup health: `http://localhost:8082/health`
- Encoder monitor: `http://localhost:8090/metrics/avg?minutes=5`

## Quy trình livestream tối thiểu

1. Add Google account credential (oauth 2.0)
2. Upload file media lên media storage
3. Tạo profile (chưa các file media cần livesteam)
4. Chạy `preflight` để test xem các encoder service đã hoạt động chưa
5. Start livestream bằng `googleAccountId` + `profileId`
6. Theo dõi status/health
7. Stop livestream

## Tắt toàn bộ

```bash
cd be-livestream && docker compose down
cd ../stream-encoder && docker compose down
```
