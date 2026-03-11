import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../modules/prisma/prisma.service';

interface JwtUser {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
}

@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as JwtUser | undefined;

    if (!user) {
      throw new ForbiddenException('No authenticated user found');
    }

    // SUPER_ADMIN bypasses tenant restriction
    if (user.role === 'SUPER_ADMIN') {
      this.logger.debug('SUPER_ADMIN bypass: tenant RLS not set');
      return true;
    }

    if (!user.tenantId) {
      throw new ForbiddenException('No tenantId in JWT payload');
    }

    // Validate UUID format to prevent SQL injection
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(user.tenantId) && !/^tenant-[\w-]+$/.test(user.tenantId)) {
      throw new ForbiddenException('Invalid tenantId format');
    }

    // Set PostgreSQL RLS variable for this transaction — using parameterized query
    await this.prisma.$executeRaw`SELECT set_config('app.current_tenant', ${user.tenantId}, true)`;

    this.logger.debug(`Tenant context set: ${user.tenantId}`);

    return true;
  }
}
