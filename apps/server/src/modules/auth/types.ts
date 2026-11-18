import type { AuthUser } from '@online-exam/shared';

export interface AuthRepository {
  findByEmail(
    email: string,
  ): Promise<(AuthUser & { passwordHash: string }) | null>;
  findById(id: string): Promise<AuthUser | null>;
  createStudent(input: {
    email: string;
    name: string;
    passwordHash: string;
  }): Promise<AuthUser>;
}

export type Principal = Pick<AuthUser, 'id' | 'role'> & {
  userId: string;
  sid: string;
};

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    role?: AuthUser['role'];
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express exposes Request augmentation through this global namespace.
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}
