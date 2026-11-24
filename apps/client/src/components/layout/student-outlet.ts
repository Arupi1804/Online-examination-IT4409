import type { MutableRefObject } from 'react';

export interface StudentOutletContext {
  beforeLogout: MutableRefObject<(() => Promise<boolean>) | null>;
}
