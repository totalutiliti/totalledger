import { z } from 'zod';

export const updateFuncionarioSchema = z.object({
  nome: z.string().min(2).max(200).optional(),
  cargo: z.string().max(100).optional(),
  cpf: z.string().regex(/^\d{11}$/, 'CPF deve ter 11 dígitos').optional(),
  matricula: z.string().max(50).optional(),
  ativo: z.boolean().optional(),
});

export type UpdateFuncionarioDto = z.infer<typeof updateFuncionarioSchema>;
