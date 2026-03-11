declare namespace Express {
  interface Request {
    user?: {
      sub: string;
      tenantId: string;
      email: string;
      role: string;
    };
    requestId?: string;
  }
}
