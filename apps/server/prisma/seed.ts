import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { bcryptPasswords } from '../src/modules/auth/services/password.js';

export const DEMO_PASSWORD = 'Test@1234';
export const DEMO_ACCOUNTS = [
  { email: 'teacher@test.com', name: 'Giáo viên demo', role: 'TEACHER' },
  { email: 'student1@test.com', name: 'Thí sinh demo', role: 'STUDENT' },
] as const;

class SeedError extends Error {}

export async function seedDevelopmentAccounts(
  prisma: PrismaClient,
  environment: string | undefined,
) {
  if (environment !== 'dev') {
    throw new SeedError('Seed demo yêu cầu APP_ENV=dev.');
  }

  const passwordHash = await bcryptPasswords().hash(DEMO_PASSWORD);
  return prisma.$transaction(async (tx) => {
    const users = [];
    for (const account of DEMO_ACCOUNTS) {
      const user = await tx.user.upsert({
        where: { email: account.email },
        update: {},
        create: { ...account, passwordHash },
        select: { id: true, email: true, role: true },
      });
      if (user.role !== account.role) {
        throw new SeedError(
          `Tài khoản ${account.email} đã tồn tại với role khác; không thay đổi tài khoản nào.`,
        );
      }
      users.push(user);
    }
    return users;
  });
}

async function main() {
  config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
  const prisma = new PrismaClient();
  try {
    const users = await seedDevelopmentAccounts(prisma, process.env.APP_ENV);
    console.table(users);
    console.log(
      'Seed hoàn tất. Tài khoản đã có được giữ nguyên, kể cả mật khẩu.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof SeedError
        ? error.message
        : 'Seed thất bại. Kiểm tra DATABASE_URL, kết nối PostgreSQL và các file SQL init.',
    );
    process.exitCode = 1;
  });
}
