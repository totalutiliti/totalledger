import { createHash } from 'crypto';

/**
 * Calcula o hash SHA-256 de um buffer de arquivo.
 * Usado para deduplicação de uploads — arquivos idênticos geram o mesmo hash.
 */
export function computeFileHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
