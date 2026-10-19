# WebSocket event contract

Socket.IO xác thực session ở handshake và kiểm tra quyền trên từng event.

| Event | Chiều | Mục đích |
| --- | --- | --- |
| `room:join` / `room:state` | Client → Server / Server → Client | Vào và cập nhật phòng thi |
| `participant:joined` / `participant:left` | Server → Room | Thay đổi người tham gia |
| `exam:start` / `exam:started` | Teacher → Server → Room | Bắt đầu kỳ thi |
| `exam:extend` / `exam:extended` | Teacher → Server → Room | Gia hạn thời gian |
| `timer:sync` / `exam:ended` | Server → Room | Đồng bộ thời gian, kết thúc thi |
| `attempt:rejoin` / `attempt:state` | Student → Server → Student | Khôi phục bài làm |
| `attempt:force_submit` / `attempt:submitted` | Teacher → Server / Server → Client | Buộc nộp và thông báo nộp |
| `proctor:heartbeat` / `proctor:violation` | Student → Server | Presence và vi phạm |
| `monitor:student_update` | Server → Monitor room | Cập nhật dashboard giám sát |
| `session:replaced` | Server → Client | Thông báo phiên bị thay thế |

Mỗi event triển khai phải bổ sung payload, ACK, mã lỗi, role và room nhận sự kiện vào tài liệu này.
