import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExamDisconnection, ProctorEvent } from './exam-model';
import { observeExamDocument } from './proctor-observer';

export function useProctoring(
  enabled: boolean,
  report: (type: ProctorEvent, clientAt: string) => Promise<void>,
  connected: boolean,
  disconnection: ExamDisconnection | null,
) {
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [fullscreenError, setFullscreenError] = useState('');
  const [observed, setObserved] = useState(0);
  const [confirmed, setConfirmed] = useState(0);
  const [unconfirmed, setUnconfirmed] = useState(0);
  const [lastEvent, setLastEvent] = useState<ProctorEvent | null>(null);
  const [pendingDisconnect, setPendingDisconnect] = useState(false);
  const pending = useRef<ExamDisconnection | null>(null);
  const handledDisconnect = useRef(0);
  const reporter = useRef(report);
  reporter.current = report;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const alive = useRef(true);
  const ownedFullscreen = useRef(false);
  const send = useCallback((type: ProctorEvent, clientAt: string) => {
    // An emitted log with a missing ACK is never retried: the wire contract
    // has no idempotency key and the server may already have saved it.
    void reporter
      .current(type, clientAt)
      .then(() => {
        if (alive.current) setConfirmed((value) => value + 1);
      })
      .catch(() => {
        if (alive.current) setUnconfirmed((value) => value + 1);
      });
  }, []);
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
        send(type, new Date().toISOString());
      },
      setFullscreen,
      (event) => {
        const content = document.querySelector('[data-exam-content]');
        if (!content) return false;
        if (event.type === 'paste')
          return event.target instanceof Node && content.contains(event.target);
        const selection = document.getSelection();
        // Inspect only selection boundaries, never clipboard contents/text.
        return (
          !!selection &&
          !selection.isCollapsed &&
          content.contains(selection.anchorNode) &&
          content.contains(selection.focusNode)
        );
      },
    );
  }, [enabled, send]);
  useEffect(() => {
    if (!enabled) {
      handledDisconnect.current = disconnection?.sequence ?? 0;
      if (pending.current) {
        pending.current = null;
        setPendingDisconnect(false);
        setUnconfirmed((value) => value + 1);
      }
      return;
    }
    if (disconnection && disconnection.sequence > handledDisconnect.current) {
      handledDisconnect.current = disconnection.sequence;
      setObserved((value) => value + 1);
      setLastEvent('DISCONNECT');
      pending.current = disconnection;
      setPendingDisconnect(true);
    }
    if (connected && pending.current) {
      const observation = pending.current;
      // This observation has never been emitted while offline. Send once,
      // only after rejoin has confirmed IN_PROGRESS and the server deadline.
      pending.current = null;
      setPendingDisconnect(false);
      send('DISCONNECT', observation.clientAt);
    }
  }, [enabled, connected, disconnection, send]);

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
    pendingDisconnect,
    enterFullscreen,
  };
}
