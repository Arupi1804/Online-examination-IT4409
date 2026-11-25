import { createApiRoomService } from './api-room-service';
import type { RoomService } from './room-model';

export const isRoomMock =
  import.meta.env.DEV && import.meta.env.VITE_USE_MOCK === 'true';
export const roomService: RoomService = isRoomMock
  ? (await import('./mock-room-service')).createMockRoomService()
  : createApiRoomService();
