export enum Plano {
  STARTER = 'STARTER',
  PROFESSIONAL = 'PROFESSIONAL',
  ENTERPRISE = 'ENTERPRISE',
}

export interface CreateTenantDto {
  readonly nome: string;
  readonly cnpj: string;
  readonly plano?: Plano;
}

export interface UpdateTenantDto {
  readonly nome?: string;
  readonly plano?: Plano;
  readonly ativo?: boolean;
  readonly suspenso?: boolean;
}

export interface TenantResponse {
  readonly id: string;
  readonly nome: string;
  readonly cnpj: string;
  readonly plano: Plano;
  readonly ativo: boolean;
  readonly suspenso: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}
