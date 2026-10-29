import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { databaseOptions } from './config';
@Injectable()
export class Database extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaPg({
        ...databaseOptions(),
        max: 20,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
      }),
    });
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
  async onModuleInit() {
    if (process.env.NODE_ENV !== 'production') return;
    const roles = await this.$queryRaw<
      { unsafe: boolean }[]
    >`SELECT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication
      OR has_schema_privilege(current_user, 'public', 'CREATE')
      OR has_database_privilege(current_user, current_database(), 'CREATE,TEMPORARY')
      OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r' AND pg_has_role(current_user,c.relowner,'USAGE')))
      AS unsafe FROM pg_roles r WHERE r.rolname=current_user`;
    if (roles.length !== 1 || roles[0].unsafe)
      throw new Error('Unsafe runtime database privileges');
  }
}
@Global()
@Module({ providers: [Database], exports: [Database] })
export class DatabaseModule {}
