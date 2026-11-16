import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Paged, type PageMeta } from '../dto/pagination';

export interface Envelope<T> {
  data: T;
  meta?: PageMeta;
}

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<Envelope<unknown>> {
    return next
      .handle()
      .pipe(
        map((value) =>
          value instanceof Paged
            ? { data: value.items, meta: value.meta }
            : { data: value ?? null },
        ),
      );
  }
}
