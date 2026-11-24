/**
 * HTTP client gọi REST API backend.
 * Dùng fetch + cookie session (credentials: "include").
 */

const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export interface ApiErrorDetail {
  field: string;
  issue: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Gọi API với fetch, tự động gửi cookie và xử lý lỗi.
 */
export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  // Tách headers ra để merge đúng cách (không bị options ghi đè)
  const { headers: customHeaders, ...restOptions } = options;
  const headers = new Headers(customHeaders);
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...restOptions,
    credentials: 'include',
    headers,
  });

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const error = isRecord(body) && isRecord(body.error) ? body.error : {};
    const details = Array.isArray(error.details)
      ? error.details.filter(
          (item): item is ApiErrorDetail =>
            isRecord(item) &&
            typeof item.field === 'string' &&
            typeof item.issue === 'string',
        )
      : [];
    throw new ApiError(
      res.status,
      typeof error.message === 'string' ? error.message : res.statusText,
      typeof error.code === 'string' ? error.code : undefined,
      details,
    );
  }

  // 204 No Content → không có body
  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}

/** Lỗi từ API, kèm HTTP status code. */
export class ApiError extends Error {
  status: number;
  code?: string;
  details: ApiErrorDetail[];

  constructor(
    status: number,
    message: string,
    code?: string,
    details: ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
