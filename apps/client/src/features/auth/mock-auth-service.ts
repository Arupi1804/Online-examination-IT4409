import { ApiError } from '../../services/api.ts';
import { loginFormSchema, registrationFormSchema } from './auth-schema.ts';
import type { AuthService, AuthUser } from './auth-model.ts';

type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface MockOptions {
  storage?: SessionStorage;
  delayMs?: number;
  isOnline?: () => boolean;
}
const SESSION_KEY = 'oe:dev:mock-auth-user';

async function digest(password: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(password),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function createMockAuthService({
  storage = window.sessionStorage,
  delayMs = 500,
  isOnline = () => navigator.onLine,
}: MockOptions = {}): AuthService {
  const student: AuthUser = {
    id: '96ed2849-40c0-4e85-85d4-a85f3aff1f01',
    email: 'student1@test.com',
    name: 'Nguyễn Minh Anh',
    role: 'STUDENT',
  };
  const teacher: AuthUser = {
    id: '96ed2849-40c0-4e85-85d4-a85f3aff1f02',
    email: 'teacher@test.com',
    name: 'Giáo viên dùng thử',
    role: 'TEACHER',
  };
  const accounts = new Map<
    string,
    { user: AuthUser; passwordHash: Promise<string> }
  >(
    [student, teacher].map((user) => [
      user.email,
      { user, passwordHash: digest('Test@1234') },
    ]),
  );
  async function wait() {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (!isOnline()) throw new TypeError('Offline');
  }
  return {
    async me() {
      await wait();
      const email = storage.getItem(SESSION_KEY);
      return email ? (accounts.get(email)?.user ?? null) : null;
    },
    async login(input) {
      await wait();
      const { email, password } = loginFormSchema.parse({
        ...input,
        email: input.email.trim(),
      });
      const account = accounts.get(email);
      if (
        !account ||
        (await account.passwordHash) !== (await digest(password))
      ) {
        throw new ApiError(
          401,
          'Invalid credentials',
          'AUTH_INVALID_CREDENTIALS',
        );
      }
      storage.setItem(SESSION_KEY, email);
      return account.user;
    },
    async register(input) {
      await wait();
      const { email, name, password } = registrationFormSchema.parse({
        ...input,
        name: input.name.trim(),
        email: input.email.trim(),
      });
      if (accounts.has(email))
        throw new ApiError(409, 'Email already used', 'EMAIL_TAKEN');
      const user: AuthUser = {
        id: crypto.randomUUID(),
        name,
        email,
        role: 'STUDENT',
      };
      accounts.set(email, { user, passwordHash: digest(password) });
    },
    async logout() {
      await wait();
      storage.removeItem(SESSION_KEY);
    },
  };
}
