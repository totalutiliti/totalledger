import { z } from 'zod';

export const createUserSchema = z.object({
  tenantId: z.string().uuid(),
  email: z.string().email(),
  nome: z.string().min(2).max(200),
  role: z.enum(['ADMIN', 'SUPERVISOR', 'ANALISTA']),
  password: z
    .string()
    .min(8)
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/,
      'Senha deve conter ao menos: 1 minúscula, 1 maiúscula, 1 dígito, 1 caractere especial (@$!%*?&)',
    ),
});

export type CreateUserDto = z.infer<typeof createUserSchema>;
