import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Paged, type PageMeta } from '../dto/pagination';

export interface Envelope<T> {
  data: T;
  meta?: PageMeta;
}

/**
 * What a successful response looks like, everywhere — one shape for success,
 * the twin of `AllExceptionsFilter`'s one shape for failure:
 *
 * ```json
 * { "data": { ... } }                                  // one object
 * { "data": [ ... ], "meta": { "total": 42, ... } }    // a page
 * { "data": null }                                     // nothing to return
 * ```
 *
 * `value ?? null` is what turns a `DELETE` that returns `undefined` into valid
 * JSON instead of a 200 with no bytes, which breaks client code calling
 * `.json()`. The `instanceof Paged` test is why services return
 * `new Paged(...)` rather than hand-building `{ items, meta }`: the interceptor
 * recognises the class and splits it into those two top-level keys.
 */
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
