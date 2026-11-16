import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * One error response. Every field except `code` and `details` is always
 * present, so a client can rely on them without optional chaining.
 */
interface ErrorBody {
  statusCode: number;
  error: string;
  code?: string;
  message: string | string[];
  details?: unknown;
  path: string;
}

/**
 * The only place a failure is turned into JSON, registered once in `main.ts`
 * with `app.useGlobalFilters()` so no controller has to think about it.
 *
 * Two rules make this file worth reading before you write a new route:
 *
 * 1. Anything thrown that is *not* an `HttpException` becomes a 500 with the
 *    same generic body. A bug, a dead database connection and a forgotten
 *    `await` all look identical to the client, and none of them leak a
 *    stack trace, a SQL fragment or an env var name. The real message goes to
 *    the log instead (see the `logger.error` below) — read the server output,
 *    not the response, when you are debugging.
 *
 * 2. `@Catch()` with no arguments is what makes it a catch-all. Nest only
 *    routes an exception here if no narrower filter handles it first, so this
 *    is the safety net, not the normal path.
 *
 * The `{ statusCode, error, code, message, details, path }` shape is the same
 * one `AppValidationPipe` and every guard produce, so a client can parse one
 * error format for the whole API. `code` is the part a front end should branch
 * on — it never gets translated, unlike `message`.
 */
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
      // `new BadRequestException('nope')` gives a bare string;
      // `new BadRequestException({ code, message })` — the form used here —
      // gives an object. Both have to produce the same body.
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
