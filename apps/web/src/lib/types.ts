export interface User {
  id: string;
  nome: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'SUPERVISOR' | 'ANALISTA';
  tenantId: string;
  mustChangePassword: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface LoginResponse {
  tokens: AuthTokens;
  user: User;
}

export interface DashboardResumo {
  totalUploads: number;
  processados: number;
  pendentesRevisao: number;
  validados: number;
  erros: number;
}

export interface Empresa {
  id: string;
  tenantId: string;
  razaoSocial: string;
  cnpj: string;
  nomeFantasia: string | null;
  ativa: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Funcionario {
  id: string;
  tenantId: string;
  empresaId: string;
  nome: string;
  cpf: string;
  matricula: string | null;
  cargo: string | null;
  ativo: boolean;
  empresa?: Empresa;
  createdAt: string;
  updatedAt: string;
}

export type UploadStatus =
  | 'AGUARDANDO'
  | 'PROCESSANDO'
  | 'PROCESSADO'
  | 'PROCESSADO_PARCIAL'
  | 'ERRO'
  | 'VALIDADO'
  | 'EXPORTADO';

export interface Upload {
  id: string;
  tenantId: string;
  empresaId: string;
  nomeArquivo: string;
  mesReferencia: string;
  status: UploadStatus;
  totalPaginas: number | null;
  paginasProcessadas: number | null;
  erroMensagem: string | null;
  empresa?: Empresa;
  createdAt: string;
  updatedAt: string;
}

// Admin types
export interface Tenant {
  id: string;
  nome: string;
  cnpj: string;
  plano: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  ativo: boolean;
  suspenso: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUser {
  id: string;
  tenantId: string;
  email: string;
  nome: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'SUPERVISOR' | 'ANALISTA';
  ativo: boolean;
  lastLoginAt: string | null;
  tenant?: Tenant;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  tenantId: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  tenant?: { nome: string };
  user?: { nome: string; email: string };
  createdAt: string;
}

export interface GlobalDashboard {
  totalTenants: number;
  totalUsers: number;
  totalUploads: number;
  totalCartoes: number;
  statusBreakdown: { status: string; count: number }[];
  uploadsByTenant: { tenantNome: string; count: number }[];
}

export interface UsageMetrics {
  periodo: { de: string; ate: string };
  documentIntelligence: {
    totalPaginas: number;
    custoEstimadoUsd: number;
    precoPor1000: number;
  };
  gptMini: {
    chamadas: number;
    tokensIn: number;
    tokensOut: number;
    custoUsd: number;
  };
  gpt52: {
    chamadas: number;
    tokensIn: number;
    tokensOut: number;
    custoUsd: number;
  };
  gpt4oMini: {
    chamadas: number;
    tokensIn: number;
    tokensOut: number;
    custoUsd: number;
  };
  custoTotalUsd: number;
  totalUploadsProcessados: number;
}

export type RevisaoStatus = 'PENDENTE' | 'EM_REVISAO' | 'APROVADO' | 'REJEITADO';

export interface CartaoPontoRevisao {
  id: string;
  tenantId: string;
  uploadId: string;
  funcionarioId: string | null;
  paginaPdf: number;
  nomeExtraido: string | null;
  cargoExtraido: string | null;
  mesExtraido: string | null;
  empresaExtraida: string | null;
  cnpjExtraido: string | null;
  horarioContratual: string | null;
  tipoCartao: string;
  statusRevisao: RevisaoStatus;
  confiancaGeral: number | null;
  prioridadeRevisao: number | null;
  prioridadeMotivos: string[] | null;
  upload?: {
    id: string;
    nomeArquivo: string;
    mesReferencia: string;
    blobUrl?: string;
    empresa?: {
      id: string;
      razaoSocial: string;
      nomeFantasia: string | null;
    };
  };
  batidas?: Batida[];
  createdAt: string;
}

export interface ConsistencyIssue {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  penalty: number;
  message: string;
  affectedFields: string[];
}

export interface OutlierFlag {
  campo: string;
  valor: string;
  dia: number;
  zScore: number;
  severity: 'warning' | 'error';
  penalty: number;
  message: string;
}

export interface OcrFeedbackItem {
  id: string;
  campo: string;
  valorDi: string | null;
  valorGpt: string | null;
  valorFinal: string | null;
  valorHumano: string | null;
  concordaDiGpt: boolean | null;
}

export interface Batida {
  id: string;
  cartaoPontoId: string;
  dia: number;
  diaSemana: string | null;
  entradaManha: string | null;
  saidaManha: string | null;
  entradaTarde: string | null;
  saidaTarde: string | null;
  entradaExtra: string | null;
  saidaExtra: string | null;
  entradaManhaCorrigida: string | null;
  saidaManhaCorrigida: string | null;
  entradaTardeCorrigida: string | null;
  saidaTardeCorrigida: string | null;
  entradaExtraCorrigida: string | null;
  saidaExtraCorrigida: string | null;
  confianca: Record<string, number> | null;
  isManuscrito: boolean;
  isInconsistente: boolean;
  isFaltaDia: boolean;
  gptFailed?: boolean;
  consistencyIssues?: ConsistencyIssue[] | null;
  outlierFlags?: OutlierFlag[] | null;
  ocrFeedback?: OcrFeedbackItem[];
}

export interface OcrAccuracy {
  totalGroundTruthRecords: number;
  globalAccuracy: { di: number; gpt: number; sanitizer: number };
  byField: Array<{ campo: string; total: number; acuraciaDi: number; acuraciaGpt: number }>;
  byTipoCartao: Record<string, { di: number; gpt: number; total: number }>;
  totalCorrections: number;
  correctionsByUser: Array<{ userId: string; nome: string; email: string; count: number }>;
}

export interface CorrectionRecord {
  id: string;
  campo: string;
  valorAnterior: string | null;
  valorNovo: string | null;
  createdAt: string;
  user: { nome: string; email: string };
  cartaoPonto: {
    id: string;
    paginaPdf: number;
    nomeExtraido: string | null;
    upload: { id: string; nomeArquivo: string };
  };
}
