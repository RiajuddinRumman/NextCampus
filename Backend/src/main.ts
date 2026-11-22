import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { SESSION_COOKIE } from './modules/auth/auth.constants';

/**
 * Starts the HTTP server. Everything the application does lives behind one
 * prefix (`/api` by default), and there is no second auth surface: sign-up,
 * sign-in and the mailed-token routes are ordinary Nest controllers, which is
 * what puts them in the docs below.
 *
 * `NestExpressApplication` rather than `INestApplication` because two things
 * here are Express methods the generic interface does not declare: the
 * `set('trust proxy', …)` below and the middleware `use()` adds.
 */
async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // The only place the body size can be set: Nest registers its own parser when
  // the application is created, so a `json()`/`urlencoded()` middleware added
  // afterwards never sees a body that is already parsed.
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });

  const config = app.get(ConfigService);
  const prefix = config.get<string>('API_PREFIX', 'api');
  const port = config.get<number>('PORT', 3000);
  const nodeEnv = config.get<string>('NODE_ENV');
  const origins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  // `credentials: true` is what lets a browser send the session cookie to a
  // front end on a different port. Without an origin listed here, the browser
  // blocks the response, not the request.
  app.enableCors({ origin: origins, credentials: true });
  app.setGlobalPrefix(prefix);

  // Every rate limit and the `ipAddress` on a session row read `req.ip`, which
  // is the socket's peer address unless this says how many proxies stand in
  // front. Left at `0`, `X-Forwarded-For` is ignored: a header any caller can
  // type is not an identity.
  app.set('trust proxy', config.get<number>('TRUST_PROXY_HOPS', 0));

  // The headers a browser needs even for a JSON-only API: `nosniff` so a stored
  // string is never read as a script, `X-Frame-Options` and `Referrer-Policy`
  // so an iframe or a Referer cannot leak a signed-in session, and HSTS.
  // `Content-Security-Policy` is the one helmet header left off: the only HTML
  // this process renders is the Swagger page below, which styles itself with
  // inline `<style>` blocks that a `default-src 'self'` policy drops — the docs
  // page or the header, not both. A CSP for the real front end belongs to
  // whatever serves it. helmet removes `X-Powered-By` itself; the explicit
  // `disable()` below keeps it gone even if this middleware is ever reordered.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.disable('x-powered-by');

  // The docs describe every route, admin ones included, and let you call them —
  // worth having while the platform is being built, not worth an attacker
  // reading in production.
  const docsServed = nodeEnv !== 'production';
  if (docsServed) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Student Community & Service Platform API')
      .setDescription('Student-exclusive listings, inquiries, moderation and administration APIs')
      .setVersion('0.1.0')
      .addCookieAuth(SESSION_COOKIE, undefined, 'session')
      .addGlobalResponse({
        status: 400,
        description: 'Validation failed or the request was rejected',
      })
      .addServer(`http://localhost:${port}/${prefix}`)
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${prefix}/docs`, app, document);
  }

  await app.listen(port);
  logger.log(
    `API ready at http://localhost:${port}/${prefix}` +
      (docsServed ? ` (docs at /${prefix}/docs)` : ' (docs are not served in production)'),
  );
}

// A rejected `bootstrap()` is a process that never came up. Node already treats
// an unhandled rejection as fatal, so this handler is only about the shape of
// the failure: one `Logger` line matching the rest of the boot output, and an
// exit code a script can assert on.
bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');
  logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
