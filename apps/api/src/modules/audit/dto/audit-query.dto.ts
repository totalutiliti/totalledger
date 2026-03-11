import { z } from 'zod';
import { paginationSchema } from '../../../common/dto/pagination.dto';

export const auditQuerySchema = paginationSchema.extend({
  tenantId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  action: z.string().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

export type AuditQueryDto = z.infer<typeof auditQuerySchema>;
