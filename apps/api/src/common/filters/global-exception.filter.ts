import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string;
  timestamp: string;
  path: string;
  requestId: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const requestId =
      (request.headers['x-request-id'] as string | undefined) ?? uuidv4();

    let statusCode: number;
    let message: string;
    let error: string;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const resp = exceptionResponse as Record<string, unknown>;
        message = Array.isArray(resp.message)
          ? resp.message.join(', ')
          : String(resp.message ?? exception.message);
      } else {
        message = exception.message;
      }

      error = HttpStatus[statusCode] ?? 'Unknown Error';
    } else {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
      error = 'Internal Server Error';

      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(
        `Unhandled exception: ${err.message}`,
        err.stack,
        JSON.stringify({ requestId, path: request.url, method: request.method }),
      );
    }

    if (statusCode >= 500) {
      const err = exception instanceof Error ? exception : undefined;
      this.logger.error(
        `${request.method} ${request.url} ${statusCode} - ${message}`,
        err?.stack,
        JSON.stringify({ requestId }),
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} ${statusCode} - ${message}`,
        JSON.stringify({ requestId }),
      );
    }

    const body: ErrorResponseBody = {
      statusCode,
      error,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId,
    };

    response.status(statusCode).json(body);
  }
}
