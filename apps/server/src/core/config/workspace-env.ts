import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function findWorkspaceEnv(moduleUrl: string): string | undefined {
  let directory = dirname(fileURLToPath(moduleUrl));
  while (true) {
    if (existsSync(join(directory, 'pnpm-workspace.yaml')))
      return join(directory, '.env');
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}
