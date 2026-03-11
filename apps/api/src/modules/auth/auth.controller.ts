import {
  Controller,
  Post,
  Put,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  UsePipes,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, loginSchema } from './dto/login.dto';
import { ChangePasswordDto, changePasswordSchema } from './dto/change-password.dto';
import { RefreshTokenDto, refreshTokenSchema } from './dto/refresh-token.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 900000 } }) // 5 attempts per 15 min
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(refreshTokenSchema))
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async logout() {
    // JWT is stateless — client discards token
    // In the future, we could add token blacklisting
    return { message: 'Logout realizado com sucesso' };
  }

  @Put('change-password')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ZodValidationPipe(changePasswordSchema))
  async changePassword(
    @CurrentUser('sub') userId: string,
    @CurrentTenant() tenantId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, tenantId, dto);
  }
}
