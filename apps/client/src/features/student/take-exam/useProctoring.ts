import { useEffect, useRef, useState } from 'react';
import type { ProctorEvent } from './exam-model';
import { observeExamDocument } from './proctor-observer';

export function useProctoring(
  enabled: boolean,
  report: (type: ProctorEvent, clientAt: string) => Promise<void>,
) {
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [fullscreenError, setFullscreenError] = useState('');
  const [observed, setObserved] = useState(0);
  const [confirmed, setConfirmed] = useState(0);
  const [unconfirmed, setUnconfirmed] = useState(0);
  const [lastEvent, setLastEvent] = useState<ProctorEvent | null>(null);
  const reporter = useRef(report);
  reporter.current = report;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const alive = useRef(true);
  const ownedFullscreen = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (ownedFullscreen.current && document.fullscreenElement)
        void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    return observeExamDocument(
      document,
      (type) => {
        if (!enabledRef.current) return;
        setObserved((value) => value + 1);
        setLastEvent(type);
        // Never buffer an uncertain log for replay: the contract has no event
        // idempotency key, and the server rejects reports after the deadline.
        void reporter
          .current(type, new Date().toISOString())
          .then(() => {
            if (alive.current) setConfirmed((value) => value + 1);
          })
          .catch(() => {
            if (alive.current) setUnconfirmed((value) => value + 1);
          });
      },
      setFullscreen,
    );
  }, [enabled]);

  async function enterFullscreen() {
    setFullscreenError('');
    if (
      !document.fullscreenEnabled ||
      !document.documentElement.requestFullscreen
    ) {
      setFullscreenError(
        'Trình duyệt hoặc thiết bị chưa hỗ trợ toàn màn hình. Hãy làm theo hướng dẫn của giáo viên.',
      );
      return;
    }
    try {
      await document.documentElement.requestFullscreen();
      ownedFullscreen.current = true;
      if (!alive.current || !enabledRef.current) {
        if (document.fullscreenElement) await document.exitFullscreen();
        ownedFullscreen.current = false;
        return;
      }
      setFullscreen(true);
    } catch {
      if (alive.current)
        setFullscreenError(
          'Chưa thể bật toàn màn hình. Bạn có thể thử lại bằng nút bên dưới.',
        );
    }
  }
  return {
    fullscreen,
    fullscreenError,
    observed,
    confirmed,
    unconfirmed,
    lastEvent,
    enterFullscreen,
  };
}
