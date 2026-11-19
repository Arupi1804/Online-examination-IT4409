import { ApiError } from '../../../services/api.ts';
import { roomCodeSchema, type RoomService } from './room-model.ts';

export function createMockRoomService(): RoomService {
  return {
    async lookup(code) {
      const roomCode = roomCodeSchema.parse(code);
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (!navigator.onLine) throw new TypeError('Offline');
      if (roomCode === 'ENDED2') throw new ApiError(422, 'Ended', 'EXAM_ENDED');
      if (!['K7M2QX', 'RUN2AB'].includes(roomCode))
        throw new ApiError(404, 'Not found', 'ROOM_NOT_FOUND');
      const running = roomCode === 'RUN2AB';
      return {
        examId: running
          ? 'c9ec68a2-0000-4000-8000-000000000002'
          : 'c9ec68a2-0000-4000-8000-000000000001',
        roomCode,
        title: 'Kiểm tra kiến thức Công nghệ Web',
        status: running ? 'RUNNING' : 'SCHEDULED',
        durationSec: 2700,
        questionCount: 30,
        startTime: running ? new Date().toISOString() : null,
        endTime: running ? new Date(Date.now() + 2700000).toISOString() : null,
        serverTime: new Date().toISOString(),
        maxAttempts: 1,
        attemptsUsed: 0,
        activeAttemptId: null,
      };
    },
    connect(room, callbacks) {
      callbacks.onConnection('connecting');
      function sync() {
        if (!navigator.onLine) {
          callbacks.onConnection('reconnecting');
          return;
        }
        callbacks.onState({
          ...room,
          participantCount: 8,
          serverTime: new Date().toISOString(),
        });
      }
      const timer = setTimeout(sync, 300);
      const offline = () => callbacks.onConnection('reconnecting');
      window.addEventListener('online', sync);
      window.addEventListener('offline', offline);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('online', sync);
        window.removeEventListener('offline', offline);
      };
    },
  };
}
