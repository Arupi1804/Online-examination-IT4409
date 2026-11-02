/**
 * Socket.IO client — kết nối realtime với server.
 * Sẽ triển khai khi WS event contract (#3) được chốt payload.
 *
 * Các event liên quan đến student:
 * - room:join / room:state        → vào phòng, nhận trạng thái
 * - participant:joined/left       → cập nhật danh sách phòng chờ
 * - exam:started / exam:ended     → bắt đầu / kết thúc kỳ thi
 * - timer:sync                    → đồng bộ đồng hồ (endTime + serverTime)
 * - attempt:rejoin / attempt:state → khôi phục bài làm khi reconnect
 * - attempt:submitted             → xác nhận đã nộp bài
 * - proctor:heartbeat             → gửi mỗi 5-10 giây khi đang thi
 * - proctor:violation             → báo vi phạm (TAB_BLUR, FULLSCREEN_EXIT...)
 * - session:replaced              → phiên bị thay thế (đăng nhập nơi khác)
 */

// Sẽ cài socket.io-client và setup ở đây khi bắt đầu Tuần 3
export {};

