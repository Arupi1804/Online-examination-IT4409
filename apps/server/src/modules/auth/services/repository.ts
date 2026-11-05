import type { PrismaClient } from '@prisma/client';
import { AuthUser } from '@online-exam/shared';
import { AuthError } from '../errors.js';
import type { AuthRepository } from '../types.js';

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmail(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    return user
      ? { ...AuthUser.parse(user), passwordHash: user.passwordHash }
      : null;
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    return user ? AuthUser.parse(user) : null;
  }

  async createStudent(input: {
    email: string;
    name: string;
    passwordHash: string;
  }) {
    try {
      return AuthUser.parse(
        await this.prisma.user.create({ data: { ...input, role: 'STUDENT' } }),
      );
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new AuthError(409, 'EMAIL_TAKEN', 'Email is already registered');
      }
      throw error;
    }
  }
}
