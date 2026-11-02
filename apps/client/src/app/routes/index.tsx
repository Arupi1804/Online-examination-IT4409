import { Routes, Route, Navigate } from "react-router-dom";
import StudentLayout from "@/components/layout/StudentLayout";
import LoginPage from "@/features/auth/LoginPage";
import JoinRoomPage from "@/features/student/room/JoinRoomPage";
import WaitingRoomPage from "@/features/student/waiting-room/WaitingRoomPage";
import ExamPage from "@/features/student/take-exam/ExamPage";
import ResultsPage from "@/features/student/results/ResultsPage";

export default function AppRoutes() {
  return (
    <Routes>
      {/* Auth - không cần layout */}
      <Route path="/login" element={<LoginPage />} />

      {/* Student pages - dùng chung StudentLayout */}
      <Route element={<StudentLayout />}>
        <Route path="/join" element={<JoinRoomPage />} />
        <Route path="/exam/:examId/waiting" element={<WaitingRoomPage />} />
        <Route path="/exam/:examId/take" element={<ExamPage />} />
        <Route path="/exam/:examId/results" element={<ResultsPage />} />
      </Route>

      {/* Mặc định chuyển về login */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

