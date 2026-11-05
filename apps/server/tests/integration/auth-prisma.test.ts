import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaAuthRepository } from '../../src/modules/auth/services/repository.js';

describe.skipIf(!process.env.AUTH_DATABASE_URL)(
  'Auth Prisma mapping on existing PostgreSQL schema',
  () => {
    let prisma: PrismaClient;
    let repository: PrismaAuthRepository;
    const email = `auth-test-${randomUUID()}@example.test`;
    beforeAll(() => {
      prisma = new PrismaClient({
        datasources: { db: { url: process.env.AUTH_DATABASE_URL! } },
      });
      repository = new PrismaAuthRepository(prisma);
    });
    afterAll(async () => {
      await prisma.user.deleteMany({ where: { email } });
      await prisma.$disconnect();
    });
    it('creates a student, reads the password internally and excludes it from public users', async () => {
      const user = await repository.createStudent({
        email,
        name: 'Auth Test',
        passwordHash: 'test-only-not-a-login-hash',
      });
      expect(user.role).toBe('STUDENT');
      expect(user).not.toHaveProperty('passwordHash');
      expect((await repository.findByEmail(email))?.passwordHash).toBe(
        'test-only-not-a-login-hash',
      );
      expect(await repository.findById(user.id)).toEqual(user);
      await expect(
        repository.createStudent({
          email,
          name: 'Duplicate',
          passwordHash: 'unused',
        }),
      ).rejects.toMatchObject({ code: 'EMAIL_TAKEN', status: 409 });
    });
  },
);
