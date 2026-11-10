/**
 * HTTP client gọi REST API backend.
 * Dùng fetch + cookie session (credentials: "include").
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

/**
 * Gọi API với fetch, tự động gửi cookie và xử lý lỗi.
 */
export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  // Tách headers ra để merge đúng cách (không bị options ghi đè)
  const { headers: customHeaders, ...restOptions } = options;

  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...restOptions,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...customHeaders,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.message || res.statusText);
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

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
