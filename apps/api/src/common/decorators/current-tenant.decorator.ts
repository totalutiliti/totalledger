import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user;

    if (!user?.tenantId) {
      throw new Error('tenantId not found in JWT payload. Is JwtAuthGuard applied?');
    }

    return user.tenantId;
  },
);
