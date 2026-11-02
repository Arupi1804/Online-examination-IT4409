import { useParams } from "react-router-dom";

/**
 * Giao diện làm bài thi.
 * Tuần 4: đồng hồ đếm ngược, câu hỏi + lựa chọn, điều hướng câu,
 *         đánh dấu câu, autosave đáp án.
 * Tuần 5: phát hiện chuyển tab, thoát fullscreen.
 */
export default function ExamPage() {
  const { examId } = useParams<{ examId: string }>();

  return (
    <div className="flex flex-col items-center gap-6 py-16">
      <h1 className="text-2xl font-bold">Làm bài thi</h1>
      <p className="text-muted-foreground text-sm">
        Exam: {examId} — sẽ xây dựng ở Tuần 4
      </p>
    </div>
  );
}

