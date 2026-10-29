import {
  Controller,
  Get,
  Module,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/security';
import { Database } from '../infrastructure/database';
@Public()
@ApiTags('Health')
@Controller('health')
class HealthController {
  constructor(private readonly db: Database) {}
  @Get('live') live() {
    return { status: 'ok', simulation: true };
  }
  @Get('ready') async ready() {
    try {
      await this.db.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
  }
}
@Module({ controllers: [HealthController] })
export class HealthModule {}
