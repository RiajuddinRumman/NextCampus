import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { SESSION_COOKIE } from './modules/auth/auth.constants';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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

  app.enableCors({ origin: origins, credentials: true });
  app.setGlobalPrefix(prefix);

  app.set('trust proxy', config.get<number>('TRUST_PROXY_HOPS', 0));

  app.use(helmet({ contentSecurityPolicy: false }));
  app.disable('x-powered-by');

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

bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');
  logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
