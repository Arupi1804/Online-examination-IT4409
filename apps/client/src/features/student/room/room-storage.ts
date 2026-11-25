import { z } from 'zod';
import { roomCodeSchema } from './room-model.ts';

type RoomStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const savedRoomSchema = z.object({
  examId: z.string().uuid(),
  roomCode: roomCodeSchema,
});
const keyFor = (userId: string) => `oe:student:waiting-room:${userId}`;

// Cache only a lookup key, never authorization, exam status or an attempt.
export function saveRoom(
  userId: string,
  room: z.infer<typeof savedRoomSchema>,
  storage?: RoomStorage,
) {
  try {
    (storage ?? sessionStorage).setItem(
      keyFor(userId),
      JSON.stringify(savedRoomSchema.parse(room)),
    );
  } catch {
    // The current navigation can still carry the room code when storage is blocked.
  }
}

export function readRoomCode(
  userId: string,
  examId: string,
  storage?: RoomStorage,
): string | null {
  try {
    const raw = (storage ?? sessionStorage).getItem(keyFor(userId));
    if (!raw) return null;
    const saved = savedRoomSchema.parse(JSON.parse(raw));
    return saved.examId === examId ? saved.roomCode : null;
  } catch {
    return null;
  }
}

export function forgetRoom(userId: string, storage?: RoomStorage) {
  try {
    (storage ?? sessionStorage).removeItem(keyFor(userId));
  } catch {
    /* Storage may be disabled. */
  }
}
