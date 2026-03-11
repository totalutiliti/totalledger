import { z } from 'zod';

export const exportRequestSchema = z.object({
  empresaId: z.string().uuid('empresaId deve ser um UUID valido'),
  mesReferencia: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'mesReferencia deve estar no formato YYYY-MM'),
});

export type ExportRequestDto = z.infer<typeof exportRequestSchema>;
