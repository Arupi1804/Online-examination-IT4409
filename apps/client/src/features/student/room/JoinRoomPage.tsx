/**
 * Trang nhập mã phòng thi.
 * Tuần 3: ô nhập 6 ký tự [A-HJ-NP-Z2-9], gọi room:join qua Socket.IO.
 */
export default function JoinRoomPage() {
  return (
    <div className="flex flex-col items-center gap-6 py-16">
      <h1 className="text-2xl font-bold">Vào phòng thi</h1>
      <p className="text-muted-foreground text-sm">
        Nhập mã phòng thi — sẽ xây dựng ở Tuần 3
      </p>
    </div>
  );
}

