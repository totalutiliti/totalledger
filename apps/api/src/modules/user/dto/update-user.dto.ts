import { z } from 'zod';

export const updateUserSchema = z
  .object({
    nome: z.string().min(2).max(200).optional(),
    role: z.enum(['ADMIN', 'SUPERVISOR', 'ANALISTA']).optional(),
    ativo: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Pelo menos um campo deve ser informado para atualização',
  });

export type UpdateUserDto = z.infer<typeof updateUserSchema>;
