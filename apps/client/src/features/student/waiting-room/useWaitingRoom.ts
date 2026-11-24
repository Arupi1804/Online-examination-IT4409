import { useEffect, useState } from 'react';
import { RoomError } from '../room/room-errors';
import {
  latestClock,
  type ExamClock,
  type JoinedRoom,
  type RoomConnectionStatus,
  type RoomState,
} from '../room/room-model';
import { roomService } from '../room/room-service';
import { readRoomCode, saveRoom } from '../room/room-storage';

interface WaitingState {
  loading: boolean;
  exam: JoinedRoom | null;
  clock: ExamClock | null;
  room: RoomState | null;
  connection: RoomConnectionStatus;
  error: unknown;
}
const initialState: WaitingState = {
  loading: true,
  exam: null,
  clock: null,
  room: null,
  connection: 'connecting',
  error: null,
};

export function useWaitingRoom(
  userId: string,
  examId: string,
  navigationCode?: string,
) {
  const [state, setState] = useState(initialState);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let disconnect: (() => void) | undefined;
    setState(initialState);
    const code = navigationCode || readRoomCode(userId, examId);
    if (!code) {
      setState({
        ...initialState,
        loading: false,
        connection: 'failed',
        error: new RoomError('ROOM_NOT_SAVED'),
      });
      return;
    }
    roomService
      .lookup(code)
      .then((exam) => {
        if (!active) return;
        if (exam.examId !== examId) throw new RoomError('ROOM_MISMATCH');
        saveRoom(userId, exam);
        setState({ ...initialState, loading: false, exam });
        disconnect = roomService.connect(exam, {
          onState(room) {
            if (active)
              setState((current) => ({
                ...current,
                room,
                clock: latestClock(current.clock, room),
                connection: 'connected',
                error: null,
              }));
          },
          onClock(clock) {
            if (active)
              setState((current) => ({
                ...current,
                clock: latestClock(current.clock, clock),
              }));
          },
          onConnection(connection) {
            if (active) setState((current) => ({ ...current, connection }));
          },
          onError(error) {
            if (active)
              setState((current) => ({
                ...current,
                connection: 'failed',
                error,
              }));
          },
        });
      })
      .catch((error: unknown) => {
        if (active)
          setState((current) => ({
            ...current,
            loading: false,
            connection: 'failed',
            error,
          }));
      });
    return () => {
      active = false;
      disconnect?.();
    };
  }, [userId, examId, navigationCode, attempt]);

  return { ...state, retry: () => setAttempt((value) => value + 1) };
}
