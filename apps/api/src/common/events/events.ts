export const AppEvents = {
  UPLOAD_CRIADO: 'upload.criado',
  CARTAO_PONTO_PROCESSADO: 'cartao-ponto.processado',
  CARTAO_PONTO_VALIDADO: 'cartao-ponto.validado',
  CARTAO_PONTO_REJEITADO: 'cartao-ponto.rejeitado',
  EXPORT_GERADO: 'export.gerado',
} as const;

export interface UploadCriadoEvent {
  tenantId: string;
  uploadId: string;
  userId: string;
  empresaId: string;
  mesReferencia: string;
}

export interface CartaoPontoProcessadoEvent {
  tenantId: string;
  uploadId: string;
  cartaoPontoId: string;
  confiancaGeral: number;
  needsReview: boolean;
}

export interface CartaoPontoValidadoEvent {
  tenantId: string;
  cartaoPontoId: string;
  uploadId: string;
  userId: string;
}

export interface CartaoPontoRejeitadoEvent {
  tenantId: string;
  cartaoPontoId: string;
  uploadId: string;
  userId: string;
  motivo: string;
}

export interface ExportGeradoEvent {
  tenantId: string;
  empresaId: string;
  mesReferencia: string;
  formato: 'csv' | 'xlsx';
  totalRegistros: number;
}
