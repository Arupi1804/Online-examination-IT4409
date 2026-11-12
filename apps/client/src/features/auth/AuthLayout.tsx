import type { ReactNode } from 'react';
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  FlaskConical,
  GraduationCap,
  PencilLine,
} from 'lucide-react';
import { isAuthMock } from './auth-service';

function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`flex size-11 items-center justify-center rounded-xl ${light ? 'bg-white/[0.12] text-white' : 'bg-primary text-primary-foreground'}`}
      >
        <GraduationCap className="size-6" aria-hidden="true" />
      </span>
      <p className="text-base font-semibold tracking-tight">
        Online Examination
      </p>
    </div>
  );
}

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-svh lg:grid lg:grid-cols-[minmax(360px,0.95fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden min-h-svh flex-col overflow-hidden bg-brand-panel p-10 text-white lg:flex xl:px-16 xl:py-12">
        <div
          className="auth-grid pointer-events-none absolute inset-0"
          aria-hidden="true"
        />
        <div className="relative">
          <Brand light />
        </div>
        <div className="relative my-auto py-12">
          <p className="mb-5 flex items-center gap-2 text-xs font-medium tracking-[0.18em] text-blue-200">
            <span className="size-1.5 rounded-full bg-blue-300" /> KHÔNG GIAN
            THI TRỰC TUYẾN
          </p>
          <h2 className="max-w-lg text-4xl leading-[1.16] font-semibold tracking-tight xl:text-[3.25rem]">
            Một khởi đầu tốt
            <br />
            cho mỗi bài thi
          </h2>
          <p className="mt-5 max-w-sm text-[15px] leading-7 text-blue-100/80">
            Chuẩn bị sẵn sàng, tập trung làm bài và thể hiện những điều bạn đã
            học
          </p>
          <div
            className="relative mx-auto mt-12 max-w-[340px] pb-7"
            aria-hidden="true"
          >
            <div className="absolute inset-x-5 top-5 bottom-4 rotate-6 rounded-2xl border border-white/15 bg-white/[0.08]" />
            <div className="relative -rotate-3 rounded-2xl bg-white p-6 text-slate-800 shadow-2xl shadow-black/15 xl:p-7">
              <div className="mb-6 flex items-center justify-between border-b border-slate-100 pb-4">
                <span className="flex items-center gap-2 text-xs font-semibold">
                  <PencilLine className="size-4 text-primary" /> Bài thi của bạn
                </span>
                <span className="size-7 rounded-full bg-blue-50 p-1.5 text-primary">
                  <CheckCheck className="size-4" />
                </span>
              </div>
              <div className="mb-5 space-y-2">
                <div className="h-2.5 w-4/5 rounded-full bg-slate-200" />
                <div className="h-2 w-1/2 rounded-full bg-slate-100" />
              </div>
              {[false, true, false].map((selected, index) => (
                <div
                  key={index}
                  className={`mt-2.5 flex h-10 items-center gap-3 rounded-lg border px-3 ${selected ? 'border-blue-200 bg-blue-50' : 'border-slate-100'}`}
                >
                  <span
                    className={`flex size-4 items-center justify-center rounded-full border ${selected ? 'border-primary bg-primary text-white' : 'border-slate-300'}`}
                  >
                    {selected && <Check className="size-3" />}
                  </span>
                  <span
                    className={`h-1.5 rounded-full ${selected ? 'w-2/3 bg-blue-200' : 'w-1/2 bg-slate-100'}`}
                  />
                </div>
              ))}
              <div className="mt-5 flex items-center justify-between text-[10px] font-medium text-slate-400">
                <span>Từng câu hỏi - Từng bước tiến.</span>
                <ArrowUpRight className="size-4 text-primary" />
              </div>
            </div>
          </div>
          <div className="mt-8 flex max-w-sm items-center justify-between gap-2 text-xs text-blue-100/80">
            {['Đăng nhập', 'Vào phòng', 'Làm bài'].map((step, index) => (
              <div key={step} className="flex items-center gap-2.5">
                <span className="flex size-6 items-center justify-center rounded-full border border-white/20 text-[10px]">
                  0{index + 1}
                </span>
                {step}
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-blue-100/[0.55]">
          Học tập mọi lúc - Kiểm tra nghiêm túc
        </p>
      </aside>
      <section className="flex min-h-svh flex-col bg-card px-5 py-6 sm:px-10 lg:px-12 xl:px-20">
        <header className="flex min-h-11 items-center justify-between gap-3">
          <div className="lg:hidden">
            <Brand />
          </div>
          <span className="hidden text-xs font-medium tracking-wider text-muted-foreground lg:inline">
            CỔNG THI TRỰC TUYẾN
          </span>
          {isAuthMock && (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">
              <FlaskConical className="size-3.5" aria-hidden="true" /> Bản xem
              thử
            </span>
          )}
        </header>
        <div className="flex flex-1 items-center justify-center py-10 sm:py-12">
          <div className="w-full max-w-[420px]">{children}</div>
        </div>
      </section>
    </main>
  );
}
