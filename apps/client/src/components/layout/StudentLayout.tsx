import { useState } from 'react';
import { Link, Navigate, Outlet } from 'react-router-dom';
import { GraduationCap, LoaderCircle, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/useAuth';
import { getAuthErrorMessage } from '@/features/auth/auth-errors';
import { isAuthMock } from '@/features/auth/auth-service';

export default function StudentLayout() {
  const { user, checking, sessionError, retrySession, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  if (checking)
    return (
      <main
        className="flex min-h-svh items-center justify-center gap-3 text-sm text-muted-foreground"
        role="status"
      >
        <LoaderCircle
          className="size-5 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        Đang kiểm tra phiên đăng nhập...
      </main>
    );
  if (sessionError)
    return (
      <main className="flex min-h-svh items-center justify-center p-5">
        <div className="max-w-md space-y-4 rounded-xl border bg-card p-6">
          <p role="alert" className="text-sm leading-6 text-destructive">
            {sessionError}
          </p>
          <Button onClick={retrySession}>Thử lại</Button>
          <Link
            className="ml-4 text-sm text-primary underline underline-offset-4"
            to="/login"
          >
            Về đăng nhập
          </Link>
        </div>
      </main>
    );
  if (!user || user.role !== 'STUDENT') return <Navigate to="/login" replace />;
  async function handleLogout() {
    setLoggingOut(true);
    setLogoutError('');
    try {
      await logout();
    } catch (error) {
      setLogoutError(getAuthErrorMessage(error));
    } finally {
      setLoggingOut(false);
    }
  }
  return (
    <div className="min-h-svh bg-background">
      {isAuthMock && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">
          Bản xem thử · Phiên đăng nhập mô phỏng trên trình duyệt
        </div>
      )}
      <header className="border-b bg-card">
        <div className="mx-auto flex min-h-20 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link
            to="/join"
            aria-label="Online Examination"
            className="flex items-center gap-2.5 rounded-md font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            <GraduationCap className="size-7 text-primary" aria-hidden="true" />
            <span className="hidden sm:inline">Online Examination</span>
          </Link>
          <div className="flex min-w-0 items-center gap-3 sm:gap-5">
            <span className="truncate text-sm" title={user.name}>
              <span className="hidden text-muted-foreground sm:inline">
                Xin chào,{' '}
              </span>
              <strong className="font-medium">{user.name}</strong>
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              disabled={loggingOut}
              aria-label="Đăng xuất"
            >
              <LogOut aria-hidden="true" />
              <span className="hidden sm:inline">
                {loggingOut ? 'Đang đăng xuất...' : 'Đăng xuất'}
              </span>
            </Button>
          </div>
        </div>
      </header>
      {logoutError && (
        <p
          role="alert"
          className="mx-auto mt-5 max-w-7xl px-5 text-sm text-destructive"
        >
          {logoutError}
        </p>
      )}
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <Outlet />
      </main>
    </div>
  );
}
