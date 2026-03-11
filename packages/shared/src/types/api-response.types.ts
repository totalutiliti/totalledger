export interface PaginationMeta {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface ApiResponse<T> {
  readonly data: T;
  readonly meta?: PaginationMeta;
  readonly requestId: string;
}

export interface ApiErrorResponse {
  readonly statusCode: number;
  readonly error: string;
  readonly message: string;
  readonly timestamp: string;
  readonly path: string;
  readonly requestId: string;
}
