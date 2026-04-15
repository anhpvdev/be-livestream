# encoder-monitor

Service giám sát độc lập để theo dõi CPU/RAM usage của `encoder-primary` và `encoder-backup`.

## Chức năng chính

- Poll định kỳ `docker stats --no-stream`
- Có 2 chế độ lưu sample:
  - `COLLECT_MODE=always`: luôn lưu sample (khuyến nghị để monitor bắt được ngay cả khi khởi động sau stream)
  - `COLLECT_MODE=active`: chỉ lưu khi CPU >= `ACTIVE_CPU_THRESHOLD`
- Trả metric hiện tại và thống kê min/max/avg theo cửa sổ phút
- Không phụ thuộc module nghiệp vụ của `be-livestream`

## API

- `GET /health`
- `GET /metrics/current`
- `GET /metrics/avg?minutes=5`

## Chạy nhanh

```bash
cp .env.example .env
yarn
docker compose up -d --build
```

Mặc định API monitor: `http://localhost:8090`.

## Cấu hình chính

- `POLL_INTERVAL_MS`: chu kỳ poll metric
- `WINDOW_MINUTES`: cửa sổ AVG mặc định
- `TARGET_CONTAINERS`: danh sách container cần theo dõi
- `COLLECT_MODE`: `always` hoặc `active`
- `ACTIVE_CPU_THRESHOLD`: ngưỡng CPU để coi là có stream active

## Remove nhanh

```bash
docker compose down -v
```

hoặc xóa toàn bộ thư mục `encoder-monitor`.
