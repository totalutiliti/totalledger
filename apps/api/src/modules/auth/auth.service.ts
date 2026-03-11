import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { HashingService } from './hashing/hashing.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface LoginResponse {
  tokens: TokenPair;
  user: {
    id: string;
    email: string;
    nome: string;
    role: string;
    tenantId: string;
    mustChangePassword: boolean;
  };
}

interface JwtPayloadData {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly hashingService: HashingService,
    private readonly configService: ConfigService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResponse> {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, ativo: true },
      include: { tenant: { select: { id: true, ativo: true, suspenso: true } } },
    });

    if (!user) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    if (!user.tenant.ativo || user.tenant.suspenso) {
      throw new ForbiddenException('Tenant suspenso ou inativo');
    }

    const isPasswordValid = await this.hashingService.verify(
      user.passwordHash,
      dto.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    // Update lastLoginAt
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.generateTokenPair({
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    });

    this.logger.log('User logged in', { userId: user.id, tenantId: user.tenantId });

    return {
      tokens,
      user: {
        id: user.id,
        email: user.email,
        nome: user.nome,
        role: user.role,
        tenantId: user.tenantId,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    try {
      const refreshSecret = this.configService.get<string>('JWT_SECRET') + '-refresh';
      const payload = this.jwtService.verify<JwtPayloadData>(refreshToken, {
        secret: refreshSecret,
      });

      const user = await this.prisma.user.findFirst({
        where: { id: payload.sub, ativo: true },
        select: { id: true, tenantId: true, email: true, role: true },
      });

      if (!user) {
        throw new UnauthorizedException('Usuário não encontrado ou inativo');
      }

      return this.generateTokenPair({
        sub: user.id,
        tenantId: user.tenantId,
        email: user.email,
        role: user.role,
      });
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Refresh token inválido ou expirado');
    }
  }

  async changePassword(
    userId: string,
    tenantId: string,
    dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, ativo: true },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    const isCurrentValid = await this.hashingService.verify(
      user.passwordHash,
      dto.currentPassword,
    );

    if (!isCurrentValid) {
      throw new BadRequestException('Senha atual incorreta');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('Nova senha deve ser diferente da atual');
    }

    const newHash = await this.hashingService.hash(dto.newPassword);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newHash,
        mustChangePassword: false,
        updatedAt: new Date(),
      },
    });

    this.logger.log('Password changed', { userId, tenantId });

    return { message: 'Senha alterada com sucesso' };
  }

  private async generateTokenPair(payload: JwtPayloadData): Promise<TokenPair> {
    const expiresIn = this.configService.get<string>('JWT_EXPIRES_IN', '8h');
    const refreshExpiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');
    const refreshSecret = this.configService.get<string>('JWT_SECRET') + '-refresh';

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, { expiresIn }),
      this.jwtService.signAsync(payload, {
        secret: refreshSecret,
        expiresIn: refreshExpiresIn,
      }),
    ]);

    return { accessToken, refreshToken, expiresIn };
  }
}
