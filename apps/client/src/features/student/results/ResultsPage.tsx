import { useParams } from "react-router-dom";

/**
 * Trang kết quả cá nhân sau khi nộp bài.
 * Tuần 5: hiển thị điểm, số câu đúng/sai, chi tiết từng câu.
 */
export default function ResultsPage() {
  const { examId } = useParams<{ examId: string }>();

  return (
    <div className="flex flex-col items-center gap-6 py-16">
      <h1 className="text-2xl font-bold">Kết quả</h1>
      <p className="text-muted-foreground text-sm">
        Exam: {examId} — sẽ xây dựng ở Tuần 5
      </p>
    </div>
  );
}

