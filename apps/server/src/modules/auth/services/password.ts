import { compare, hash } from 'bcryptjs';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, digest: string): Promise<boolean>;
}

export function bcryptPasswords(rounds = 12): PasswordHasher {
  return {
    hash: (password) => hash(password, rounds),
    verify: (password, digest) => compare(password, digest),
  };
}
