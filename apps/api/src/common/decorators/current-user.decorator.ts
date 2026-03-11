import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
}

export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext): JwtPayload | string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as JwtPayload | undefined;

    if (!user) {
      throw new Error('User not found in request. Is JwtAuthGuard applied?');
    }

    if (data) {
      return user[data];
    }

    return user;
  },
);
