# Kiến trúc hệ thống

```text
React client ── HTTPS / WSS ── Express + Socket.IO ── PostgreSQL
                                      │
                                      └────────────── Redis
```

- REST API quản lý xác thực, đề thi, câu hỏi, bài làm, kết quả và báo cáo.
- Socket.IO quản lý phòng thi, đồng bộ thời gian, presence, giám sát và khôi phục kết nối.
- PostgreSQL là nguồn dữ liệu bền vững, gồm trạng thái kỳ thi và `end_time`; Redis giữ session, cache timer, presence và hàng đợi job theo `redis-key-schema.md`.
- Chấm điểm, xác nhận hết giờ và nộp bài chỉ diễn ra tại server.
