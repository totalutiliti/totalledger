import { Role } from '../constants/roles';

export interface JwtPayload {
  readonly sub: string;
  readonly tenantId: string;
  readonly email: string;
  readonly role: Role;
  readonly iat: number;
  readonly exp: number;
}

export interface LoginDto {
  readonly email: string;
  readonly password: string;
}

export interface TokenResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}
