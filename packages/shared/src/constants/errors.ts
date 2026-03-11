export const ERROR_MESSAGES = {
  // Auth
  AUTH_INVALID_CREDENTIALS: 'Credenciais invalidas.',
  AUTH_TOKEN_EXPIRED: 'Token expirado.',
  AUTH_TOKEN_INVALID: 'Token invalido.',
  AUTH_UNAUTHORIZED: 'Nao autorizado.',
  AUTH_FORBIDDEN: 'Acesso negado.',
  AUTH_PASSWORD_CHANGE_REQUIRED: 'Alteracao de senha obrigatoria.',
  AUTH_PASSWORD_MISMATCH: 'Senhas nao coincidem.',
  AUTH_PASSWORD_TOO_WEAK: 'Senha muito fraca. Minimo 8 caracteres, incluindo maiuscula, minuscula, numero e caractere especial.',

  // Tenant
  TENANT_NOT_FOUND: 'Tenant nao encontrado.',
  TENANT_CNPJ_ALREADY_EXISTS: 'CNPJ ja cadastrado para outro tenant.',
  TENANT_SUSPENDED: 'Tenant suspenso. Entre em contato com o suporte.',
  TENANT_INACTIVE: 'Tenant inativo.',

  // Empresa
  EMPRESA_NOT_FOUND: 'Empresa nao encontrada.',
  EMPRESA_CNPJ_ALREADY_EXISTS: 'CNPJ ja cadastrado para outra empresa neste tenant.',

  // Funcionario
  FUNCIONARIO_NOT_FOUND: 'Funcionario nao encontrado.',
  FUNCIONARIO_CPF_ALREADY_EXISTS: 'CPF ja cadastrado para outro funcionario nesta empresa.',

  // Upload
  UPLOAD_NOT_FOUND: 'Upload nao encontrado.',
  UPLOAD_FILE_TOO_LARGE: 'Arquivo excede o tamanho maximo permitido.',
  UPLOAD_INVALID_FILE_TYPE: 'Tipo de arquivo invalido. Somente PDF e permitido.',
  UPLOAD_ALREADY_PROCESSING: 'Upload ja esta sendo processado.',
  UPLOAD_CANNOT_REPROCESS: 'Upload nao pode ser reprocessado no status atual.',

  // OCR Pipeline
  OCR_PROCESSING_FAILED: 'Falha no processamento OCR.',
  OCR_DOCUMENT_INTELLIGENCE_ERROR: 'Erro ao comunicar com Azure Document Intelligence.',
  OCR_AI_FILTER_ERROR: 'Erro ao comunicar com Azure OpenAI.',
  OCR_CARD_PARSE_ERROR: 'Erro ao interpretar cartao de ponto.',

  // Revisao
  REVISAO_CARTAO_NOT_FOUND: 'Cartao de ponto nao encontrado para revisao.',
  REVISAO_BATIDA_NOT_FOUND: 'Batida nao encontrada.',
  REVISAO_ALREADY_APPROVED: 'Cartao de ponto ja foi aprovado.',
  REVISAO_INVALID_TIME_FORMAT: 'Formato de horario invalido. Use HH:MM.',

  // Export
  EXPORT_NO_DATA: 'Nenhum dado disponivel para exportacao.',
  EXPORT_NOT_FOUND: 'Exportacao nao encontrada.',

  // Generic
  VALIDATION_ERROR: 'Erro de validacao.',
  INTERNAL_SERVER_ERROR: 'Erro interno do servidor.',
  NOT_FOUND: 'Recurso nao encontrado.',
  CONFLICT: 'Conflito com o estado atual do recurso.',
} as const;

export type ErrorMessageKey = keyof typeof ERROR_MESSAGES;
