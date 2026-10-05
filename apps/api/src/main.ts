import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';
import { requestIdMiddleware } from './logging.js';
import { OrganizationExceptionFilter } from './organization-exception.filter.js';

const config = loadConfig();
const app = await NestFactory.create(AppModule, { logger: false });
app.use(requestIdMiddleware);
app.useGlobalFilters(new OrganizationExceptionFilter(app.getHttpAdapter()));
app.setGlobalPrefix('v1');
await app.listen(config.API_PORT, '0.0.0.0');
console.log(JSON.stringify({ event: 'api_started', port: config.API_PORT, environment: config.NODE_ENV }));
