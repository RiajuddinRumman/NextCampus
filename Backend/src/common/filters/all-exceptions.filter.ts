import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorBody {
  statusCode: number;
  error: string;
  code?: string;
  message: string | string[];
  details?: unknown;
  path: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorBody = {
      statusCode: status,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
      path: request.url,
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        body = { statusCode: status, error: exception.name, message: payload, path: request.url };
      } else {
        const record = payload as Record<string, any>;
        body = {
          statusCode: status,
          error: record.error ?? exception.name,
          code: record.code,
          message: record.message ?? exception.message,
          details: record.details,
          path: request.url,
        };
      }
    } else if (exception instanceof Error) {
      this.logger.error(`${exception.name}: ${exception.message}`, exception.stack);
    }

    response.status(status).json(body);
  }
}
