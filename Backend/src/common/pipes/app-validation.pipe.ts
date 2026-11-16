import { BadRequestException, Injectable, PipeTransform, ValidationPipe } from '@nestjs/common';
import type { ArgumentMetadata, ValidationError } from '@nestjs/common';
import { describeValidationErrors, type ValidationIssue } from '../validators/validation-errors';

const SOURCE_NAMES: Record<string, string> = {
  body: 'body',
  query: 'query string',
  param: 'route parameter',
  custom: 'request',
};

@Injectable()
export class AppValidationPipe implements PipeTransform {
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
