import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { Request } from 'express';

interface StandardResponse {
  data: unknown;
  meta?: Record<string, unknown>;
  requestId: string;
}

function hasDataKey(value: unknown): value is { data: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value
  );
}

@Injectable()
export class ResponseTransformInterceptor implements NestInterceptor {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<StandardResponse> {
    const request = context.switchToHttp().getRequest<Request>();
    const requestId = request.requestId ?? 'unknown';

    return next.handle().pipe(
      map((responseData: unknown) => {
        if (hasDataKey(responseData)) {
          const resp = responseData as Record<string, unknown>;
          return {
            data: resp.data,
            meta: (resp.meta as Record<string, unknown> | undefined) ?? undefined,
            requestId,
          };
        }

        return {
          data: responseData,
          requestId,
        };
      }),
    );
  }
}
