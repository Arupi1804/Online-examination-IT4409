import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { ApiError } from '@/services/api';
import { AuthLayout } from './AuthLayout';
import { PasswordField } from './PasswordField';
import { useAuth } from './useAuth';
import { isAuthMock } from './auth-service';
import { getAuthErrorMessage } from './auth-errors';
import { validateAuthForm } from './validation';
import type {
  AuthFieldErrors,
  AuthFieldName,
  AuthFormValues,
  AuthMode,
} from './auth-model';

function AuthForm({
  mode,
  initialEmail,
  notice,
  onSwitch,
  onRegistered,
}: {
  mode: AuthMode;
  initialEmail: string;
  notice: string;
  onSwitch(): void;
  onRegistered(email: string): void;
}) {
  const { login, register, checking, sessionError, retrySession } = useAuth();
  const [values, setValues] = useState<AuthFormValues>({
    name: '',
    email: initialEmail,
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const registering = mode === 'register';
  const busy = checking || submitting;

  function updateField(field: AuthFieldName, value: string) {
    const next = { ...values, [field]: value };
    setValues(next);
    setSubmitError('');
    setErrors((previous) => {
      const validated = validateAuthForm(mode, next);
      const updated = { ...previous };
      if (previous[field]) updated[field] = validated[field];
      if (field === 'password' && previous.confirmPassword)
        updated.confirmPassword = validated.confirmPassword;
      return updated;
    });
  }
  function validateField(field: AuthFieldName) {
    setErrors((previous) => ({
      ...previous,
      [field]: validateAuthForm(mode, values)[field],
    }));
  }
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || busy) return;
    const nextErrors = validateAuthForm(mode, values);
    setErrors(nextErrors);
    setSubmitError('');
    const firstInvalid = Array.from(
      formRef.current?.querySelectorAll('input') ?? [],
    ).find((input) => nextErrors[input.name as AuthFieldName]);
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const email = values.email.trim().toLowerCase();
      if (registering) {
        await register({
          name: values.name.trim(),
          email,
          password: values.password,
        });
        onRegistered(email);
      } else {
        await login({ email, password: values.password });
      }
    } catch (error) {
      setSubmitError(getAuthErrorMessage(error));
      if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
        const fieldErrors: AuthFieldErrors = {};
        for (const detail of error.details) {
          if (
            detail.field in values &&
            (registering || ['email', 'password'].includes(detail.field))
          ) {
            fieldErrors[detail.field as AuthFieldName] =
              'Thông tin này chưa hợp lệ. Bạn hãy kiểm tra lại.';
          }
        }
        setErrors(fieldErrors);
      }
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }
  function fillDemo() {
    setValues({
      name: '',
      email: 'student1@test.com',
      password: 'Test@1234',
      confirmPassword: '',
    });
    setErrors({});
    setSubmitError('');
    formRef.current?.querySelector<HTMLInputElement>('#email')?.focus();
  }
  return (
    <>
      <div className="mb-8">
        <p className="mb-3 text-xs font-semibold tracking-[0.15em] text-primary">
          {registering ? 'BẮT ĐẦU TẠI ĐÂY' : 'CHÀO MỪNG TRỞ LẠI'}
        </p>
        <h1 className="text-[30px] leading-tight font-semibold tracking-tight sm:text-[34px]">
          {registering ? 'Tạo tài khoản' : 'Đăng nhập'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {registering
            ? 'Tạo tài khoản thí sinh để tham gia các bài thi trên Online Examination.'
            : 'Đăng nhập tài khoản của bạn để tiếp tục.'}
        </p>
      </div>
      {notice && (
        <div
          role="status"
          className="mb-6 flex items-start gap-2.5 rounded-lg border border-success/20 bg-success/5 p-3.5 text-sm leading-6 text-success"
        >
          <CircleCheck className="mt-1 size-4 shrink-0" aria-hidden="true" />
          {notice}
        </div>
      )}
      {sessionError && (
        <div
          role="alert"
          className="mb-5 rounded-lg border border-destructive/20 bg-destructive/5 p-3.5 text-sm leading-6 text-destructive"
        >
          {sessionError}
          <Button
            type="button"
            variant="link"
            size="sm"
            className="mt-1 px-0"
            onClick={retrySession}
            disabled={checking}
          >
            Kiểm tra kết nối lại
          </Button>
        </div>
      )}
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        noValidate
        aria-busy={busy}
        className="space-y-5"
      >
        {submitError && (
          <div
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/5 p-3.5 text-sm leading-6 text-destructive outline-none focus-visible:ring-2 focus-visible:ring-destructive"
          >
            <CircleAlert className="mt-1 size-4 shrink-0" aria-hidden="true" />
            {submitError}
          </div>
        )}
        {registering && (
          <FormField
            id="name"
            name="name"
            label="Họ và tên"
            autoComplete="name"
            placeholder="Nguyễn Minh Anh"
            required
            disabled={busy}
            value={values.name}
            error={errors.name}
            onChange={(event) => updateField('name', event.target.value)}
            onBlur={() => validateField('name')}
          />
        )}
        <FormField
          id="email"
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="ban@example.com"
          required
          disabled={busy}
          value={values.email}
          error={errors.email}
          onChange={(event) => updateField('email', event.target.value)}
          onBlur={() => validateField('email')}
        />
        <PasswordField
          id="password"
          name="password"
          label="Mật khẩu"
          autoComplete={registering ? 'new-password' : 'current-password'}
          placeholder={registering ? 'Tạo mật khẩu của bạn' : 'Nhập mật khẩu'}
          hint={registering ? 'Sử dụng từ 8 đến 72 ký tự.' : undefined}
          required
          disabled={busy}
          value={values.password}
          error={errors.password}
          onChange={(event) => updateField('password', event.target.value)}
          onBlur={() => validateField('password')}
        />
        {registering && (
          <PasswordField
            id="confirmPassword"
            name="confirmPassword"
            label="Xác nhận mật khẩu"
            autoComplete="new-password"
            placeholder="Nhập lại mật khẩu"
            required
            disabled={busy}
            value={values.confirmPassword}
            error={errors.confirmPassword}
            onChange={(event) =>
              updateField('confirmPassword', event.target.value)
            }
            onBlur={() => validateField('confirmPassword')}
          />
        )}
        <Button type="submit" className="mt-2 w-full" disabled={busy}>
          {busy ? (
            <>
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              {checking ? 'Đang kiểm tra phiên...' : 'Đang xử lý...'}
            </>
          ) : (
            <>
              {registering ? 'Tạo tài khoản' : 'Đăng nhập'}
              <ArrowRight aria-hidden="true" />
            </>
          )}
        </Button>
      </form>
      <p className="mt-7 flex flex-wrap items-center justify-center gap-x-1 text-sm text-muted-foreground">
        {registering ? 'Đã có tài khoản?' : 'Chưa có tài khoản?'}
        <Button
          type="button"
          variant="link"
          className="h-auto min-h-9 px-1 font-semibold"
          disabled={busy}
          onClick={onSwitch}
        >
          {registering ? 'Đăng nhập' : 'Đăng ký ngay'}
        </Button>
      </p>
      {isAuthMock && (
        <details className="mt-8 rounded-xl border border-dashed bg-background p-4 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">
            Tài khoản dùng thử
          </summary>
          <div className="mt-3 space-y-2 leading-5">
            <p>
              Email:{' '}
              <span className="font-medium text-foreground">
                student1@test.com
              </span>
              <br />
              Mật khẩu:{' '}
              <span className="font-medium text-foreground">Test@1234</span>
            </p>
            <p>
              Dữ liệu mô phỏng trên trình duyệt. Tài khoản mới mất khi tải lại
              trang.
            </p>
            {!registering && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={fillDemo}
                disabled={busy}
                className="mt-1 w-full bg-card"
              >
                Điền tài khoản thí sinh
              </Button>
            )}
          </div>
        </details>
      )}
    </>
  );
}

function SignedInPanel() {
  const { user, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function handleLogout() {
    setBusy(true);
    try {
      await logout();
    } catch (reason) {
      setError(getAuthErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <CircleCheck className="size-10 text-success" aria-hidden="true" />
      <h1 className="text-3xl font-semibold tracking-tight">
        Đăng nhập thành công
      </h1>
      <p className="leading-7 text-muted-foreground">
        Xin chào, <strong className="text-foreground">{user?.name}</strong>.
        <br />
        Vai trò: {user?.role === 'TEACHER' ? 'Giáo viên' : 'Quản trị viên'}.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button variant="outline" onClick={handleLogout} disabled={busy}>
        {busy ? 'Đang đăng xuất...' : 'Đăng xuất'}
      </Button>
    </div>
  );
}

export default function LoginPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode: AuthMode =
    searchParams.get('mode') === 'register' ? 'register' : 'login';
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [notice, setNotice] = useState('');
  const { user } = useAuth();
  useEffect(() => {
    document.title = `${mode === 'register' ? 'Đăng ký' : 'Đăng nhập'} | Online Examination`;
  }, [mode]);
  if (user?.role === 'STUDENT') return <Navigate to="/join" replace />;
  function switchMode() {
    setNotice('');
    setSearchParams(mode === 'login' ? { mode: 'register' } : {});
  }
  function registered(email: string) {
    setRegisteredEmail(email);
    setNotice('Tạo tài khoản thành công. Bạn hãy đăng nhập để tiếp tục.');
    setSearchParams({}, { replace: true });
  }
  return (
    <AuthLayout>
      {user ? (
        <SignedInPanel />
      ) : (
        <AuthForm
          key={mode}
          mode={mode}
          initialEmail={registeredEmail}
          notice={mode === 'login' ? notice : ''}
          onSwitch={switchMode}
          onRegistered={registered}
        />
      )}
    </AuthLayout>
  );
}
