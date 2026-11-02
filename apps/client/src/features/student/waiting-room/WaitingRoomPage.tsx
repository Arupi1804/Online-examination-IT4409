import { useParams } from "react-router-dom";

/**
 * Phòng chờ — hiển thị sau khi vào phòng, chờ giáo viên bắt đầu.
 * Tuần 3: danh sách người tham gia, trạng thái phòng, lắng nghe exam:started.
 */
export default function WaitingRoomPage() {
  const { examId } = useParams<{ examId: string }>();

  return (
    <div className="flex flex-col items-center gap-6 py-16">
      <h1 className="text-2xl font-bold">Phòng chờ</h1>
      <p className="text-muted-foreground text-sm">
        Exam: {examId} — sẽ xây dựng ở Tuần 3
      </p>
    </div>
  );
}

