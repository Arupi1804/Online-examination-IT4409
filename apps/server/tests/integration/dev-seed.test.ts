import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  seedDevelopmentAccounts,
} from '../../prisma/seed.js';
import { bcryptPasswords } from '../../src/modules/auth/services/password.js';

describe.skipIf(!process.env.AUTH_DATABASE_URL)(
  'development account seed',
  () => {
    const schema = `seed_test_${randomUUID().replaceAll('-', '')}`;
    const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const passwords = bcryptPasswords();
    let admin: PrismaClient;
    let prisma: PrismaClient;

    beforeAll(async () => {
      const url = new URL(process.env.AUTH_DATABASE_URL!);
      const sourceSchema = url.searchParams.get('schema') ?? 'public';
      admin = new PrismaClient({ datasources: { db: { url: url.href } } });
      await admin.$executeRawUnsafe(`CREATE SCHEMA ${identifier(schema)}`);
      await admin.$executeRawUnsafe(
        `CREATE TABLE ${identifier(schema)}.users (LIKE ${identifier(sourceSchema)}.users INCLUDING ALL)`,
      );
      url.searchParams.set('schema', schema);
      prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
    });

    beforeEach(async () => {
      await prisma.user.deleteMany();
    });

    afterAll(async () => {
      await prisma?.$disconnect();
      if (admin) {
        await admin.$executeRawUnsafe(
          `DROP SCHEMA IF EXISTS ${identifier(schema)} CASCADE`,
        );
        await admin.$disconnect();
      }
    });

    it('creates a teacher and student with passwords accepted by Auth', async () => {
      const users = await seedDevelopmentAccounts(prisma, 'dev');
      expect(users).toHaveLength(2);
      expect(users).toEqual(
        DEMO_ACCOUNTS.map(({ email, role }) => ({
          id: expect.any(String),
          email,
          role,
        })),
      );
      for (const account of DEMO_ACCOUNTS) {
        const stored = await prisma.user.findUniqueOrThrow({
          where: { email: account.email },
        });
        expect(stored.name).toBe(account.name);
        expect(stored.passwordHash).not.toBe(DEMO_PASSWORD);
        expect(await passwords.verify(DEMO_PASSWORD, stored.passwordHash)).toBe(
          true,
        );
      }
      expect(users[0]).not.toHaveProperty('passwordHash');
    });

    it('preserves existing ids, names and passwords when run again', async () => {
      await seedDevelopmentAccounts(prisma, 'dev');
      await prisma.user.update({
        where: { email: DEMO_ACCOUNTS[0].email },
        data: {
          name: 'Tên đã đổi',
          passwordHash: await passwords.hash('Changed-password-2026'),
        },
      });
      const before = await prisma.user.findMany({ orderBy: { email: 'asc' } });
      await seedDevelopmentAccounts(prisma, 'dev');
      expect(await prisma.user.findMany({ orderBy: { email: 'asc' } })).toEqual(
        before,
      );
      expect(await prisma.user.count()).toBe(2);
    });

    it('rolls back new accounts if an existing demo email has the wrong role', async () => {
      const existing = await prisma.user.create({
        data: {
          ...DEMO_ACCOUNTS[1],
          role: 'ADMIN',
          passwordHash: 'existing-hash',
        },
      });
      await expect(seedDevelopmentAccounts(prisma, 'dev')).rejects.toThrow(
        'role khác',
      );
      expect(await prisma.user.findMany()).toEqual([existing]);
      expect(
        await prisma.user.findUnique({
          where: { email: DEMO_ACCOUNTS[0].email },
        }),
      ).toBeNull();
    });

    it.each([undefined, 'staging', 'prod'])(
      'refuses APP_ENV=%s before writing',
      async (environment) => {
        await expect(
          seedDevelopmentAccounts(prisma, environment),
        ).rejects.toThrow('APP_ENV=dev');
        expect(await prisma.user.count()).toBe(0);
      },
    );
  },
);
