import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';

@Injectable()
export class HashingService {
  private readonly logger = new Logger(HashingService.name);
  private readonly pepper: string;

  constructor(private readonly configService: ConfigService) {
    const pepper = this.configService.get<string>('PEPPER_SECRET');
    if (!pepper) {
      throw new Error('PEPPER_SECRET is required');
    }
    this.pepper = pepper;
  }

  async hash(password: string): Promise<string> {
    const pepperedPassword = `${password}${this.pepper}`;
    return argon2.hash(pepperedPassword, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    const pepperedPassword = `${password}${this.pepper}`;
    try {
      return await argon2.verify(hash, pepperedPassword);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Password verification failed: ${message}`);
      return false;
    }
  }
}
