import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { createDatabase } from '@pachi/database';

@Controller('health')
export class HealthController {
  @Get('live')
  live() { return { status: 'ok' as const }; }

  @Get('ready')
  async ready() {
    const { client } = createDatabase();
    try {
      await client`select 1`;
      return { status: 'ok' as const, database: 'ok' as const };
    } catch {
      throw new ServiceUnavailableException({ status: 'not_ready', database: 'unavailable' });
    } finally {
      await client.end();
    }
  }
}
