import { z } from 'zod';
import { apiFetch } from '../../../services/api.ts';
import { connectRoom } from '../../../socket/index.ts';
import {
  examJoinInfoSchema,
  roomCodeSchema,
  type RoomService,
} from './room-model.ts';

export function createApiRoomService(): RoomService {
  return {
    async lookup(code) {
      const roomCode = roomCodeSchema.parse(code);
      const response = z.object({ data: examJoinInfoSchema }).parse(
        await apiFetch<unknown>('/api/v1/exams/join', {
          method: 'POST',
          body: JSON.stringify({ roomCode }),
        }),
      );
      return { ...response.data, roomCode };
    },
    connect: connectRoom,
  };
}
