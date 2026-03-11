const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface ApiResponse<T> {
  data: T;
  meta?: {
    page: number;
    limit: number;
    total: number;
  };
  requestId: string;
}

interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  timestamp: string;
  path: string;
  requestId: string;
}

interface ApiFetchOptions extends Omit<RequestInit, 'headers'> {
  token?: string;
  headers?: Record<string, string>;
}

async function apiFetch<T>(path: string, options?: ApiFetchOptions): Promise<T> {
  const { token, headers: customHeaders, ...fetchOptions } = options || {};
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(customHeaders || {}),
  };

  const res = await fetch(`${API_BASE}${path}`, { ...fetchOptions, headers });

  if (!res.ok) {
    const error: ApiError | { message: string } = await res.json().catch(() => ({
      message: res.statusText,
    }));
    throw new Error('message' in error ? error.message : 'Erro na requisição');
  }

  return res.json() as Promise<T>;
}

async function apiFetchMultipart<T>(
  path: string,
  formData: FormData,
  options?: { token?: string },
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(
      'message' in (error as Record<string, unknown>)
        ? (error as { message: string }).message
        : 'Erro na requisição',
    );
  }

  return res.json() as Promise<T>;
}

async function apiFetchBlob(
  path: string,
  options?: ApiFetchOptions,
): Promise<Blob> {
  const { token, headers: customHeaders, ...fetchOptions } = options || {};
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(customHeaders || {}),
  };

  const res = await fetch(`${API_BASE}${path}`, { ...fetchOptions, headers });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(
      'message' in (error as Record<string, unknown>)
        ? (error as { message: string }).message
        : 'Erro na requisição',
    );
  }

  return res.blob();
}

export const api = {
  get: <T>(path: string, token?: string) =>
    apiFetch<ApiResponse<T>>(path, { method: 'GET', token }),

  post: <T>(path: string, body: unknown, token?: string) =>
    apiFetch<ApiResponse<T>>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      token,
    }),

  patch: <T>(path: string, body: unknown, token?: string) =>
    apiFetch<ApiResponse<T>>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
      token,
    }),

  delete: <T>(path: string, token?: string) =>
    apiFetch<ApiResponse<T>>(path, { method: 'DELETE', token }),

  upload: <T>(path: string, formData: FormData, token?: string) =>
    apiFetchMultipart<ApiResponse<T>>(path, formData, { token }),

  downloadBlob: (path: string, body: unknown, token?: string) =>
    apiFetchBlob(path, {
      method: 'POST',
      body: JSON.stringify(body),
      token,
    }),
};

export type { ApiResponse, ApiError };
