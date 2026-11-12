import { compare, hash } from 'bcryptjs';
import { createHash } from 'node:crypto';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, digest: string): Promise<boolean>;
}

export function bcryptPasswords(rounds = 12): PasswordHasher {
  const extendedPrefix = 'bcrypt-sha256$';
  const digest = (password: string) =>
    createHash('sha256').update(password, 'utf8').digest('base64');
  return {
    // OpenAPI limits characters, not bytes. Do not truncate valid Unicode passwords.
    hash: async (password) =>
      Buffer.byteLength(password, 'utf8') > 72
        ? extendedPrefix + (await hash(digest(password), rounds))
        : hash(password, rounds),
    verify: async (password, storedHash) => {
      if (storedHash.startsWith(extendedPrefix)) {
        return compare(
          digest(password),
          storedHash.slice(extendedPrefix.length),
        );
      }
      const tooLong = Buffer.byteLength(password, 'utf8') > 72;
      // Still perform bcrypt work for invalid long input and the unknown-account dummy hash.
      const valid = await compare(
        tooLong ? digest(password) : password,
        storedHash,
      );
      return !tooLong && valid;
    },
  };
}
