import { z } from 'zod';

export const createUploadSchema = z.object({
  empresaId: z.string().min(1, 'empresaId é obrigatório'),
  mesReferencia: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'mesReferencia deve estar no formato YYYY-MM'),
});

export type CreateUploadDto = z.infer<typeof createUploadSchema>;
