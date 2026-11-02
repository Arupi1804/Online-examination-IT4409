import { Outlet } from "react-router-dom";

/**
 * Layout chung cho các trang thí sinh (sau khi đăng nhập).
 * Tuần 2 sẽ thêm header, navigation, và kiểm tra auth.
 */
export default function StudentLayout() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header sẽ thêm ở Tuần 2 */}
      <main className="container mx-auto px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}

