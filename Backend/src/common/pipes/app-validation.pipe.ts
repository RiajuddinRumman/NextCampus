import { BadRequestException, Injectable, PipeTransform, ValidationPipe } from '@nestjs/common';
import type { ArgumentMetadata, ValidationError } from '@nestjs/common';
import {
  describeValidationErrors,
  type ValidationIssue,
} from '../validators/validation-errors';

/** Nest labels the part of the request a pipe is looking at; this reads better in an error. */
const SOURCE_NAMES: Record<string, string> = {
  body: 'body',
  query: 'query string',
  param: 'route parameter',
  custom: 'request',
};

/**
 * The one validation rule-set for every route, registered globally in
 * `app.module.ts` — controllers never mention it, they only declare a DTO type.
 *
 * `transform` hands handlers a real DTO instance, so `?page=2` arrives as the
 * number 2 instead of the string '2'. `whitelist` drops fields a DTO does not
 * declare, and `forbidNonWhitelisted` rejects the request instead of dropping
 * quietly — a typo like `subjetcts` then fails loudly rather than being ignored.
 *
 * Failures keep this API's existing error shape (`code: VALIDATION_FAILED` plus
 * `details[].path`) because clients branch on `code` and the dotted path is how
 * a form highlights the offending input.
 */
@Injectable()
export class AppValidationPipe implements PipeTransform {
  // One inner pipe per request part, so the message can name what went wrong.
  private readonly pipes = new Map<string, ValidationPipe>();

  transform(value: unknown, metadata: ArgumentMetadata) {
    return this.forSource(metadata.type).transform(value, metadata);
  }

  private forSource(source: string): ValidationPipe {
    let pipe = this.pipes.get(source);
    if (!pipe) {
      pipe = new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        exceptionFactory: (errors: ValidationError[]) => {
          const details: ValidationIssue[] = describeValidationErrors(errors);
          return new BadRequestException({
            code: 'VALIDATION_FAILED',
            message: `Invalid request ${SOURCE_NAMES[source] ?? 'request'}`,
            details,
          });
        },
      });
      this.pipes.set(source, pipe);
    }
    return pipe;
  }
}
