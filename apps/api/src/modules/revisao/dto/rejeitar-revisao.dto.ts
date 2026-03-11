import { z } from 'zod';

export const rejeitarRevisaoSchema = z.object({
  motivo: z
    .string()
    .min(1, 'Motivo é obrigatório')
    .max(1000, 'Motivo deve ter no máximo 1000 caracteres'),
});

export type RejeitarRevisaoDto = z.infer<typeof rejeitarRevisaoSchema>;
