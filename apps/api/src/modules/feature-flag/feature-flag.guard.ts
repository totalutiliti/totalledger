import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlagService } from './feature-flag.service';

export const FEATURE_FLAG_KEY = 'feature_flag';
export const FeatureFlag = (feature: string) =>
  SetMetadata(FEATURE_FLAG_KEY, feature);

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlagService: FeatureFlagService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<string | undefined>(
      FEATURE_FLAG_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!feature) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: { tenantId?: string } }>();
    const tenantId = request.user?.tenantId;

    if (!tenantId) {
      throw new ForbiddenException('Tenant não identificado');
    }

    const enabled = await this.featureFlagService.isEnabled(tenantId, feature);

    if (!enabled) {
      throw new ForbiddenException(
        `Funcionalidade "${feature}" não está habilitada para este tenant`,
      );
    }

    return true;
  }
}
