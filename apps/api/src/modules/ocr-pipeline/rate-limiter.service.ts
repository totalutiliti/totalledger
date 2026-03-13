import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Pool types for rate limiting different API endpoints.
 */
export type RateLimitPool = 'mini' | 'gpt52';

interface PoolState {
  current: number;
  max: number;
  queue: Array<() => void>;
}

/**
 * Counting semaphore for controlling concurrent API calls.
 * Prevents overwhelming Azure OpenAI rate limits when processing
 * multiple pages in parallel.
 */
@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly pools: Map<RateLimitPool, PoolState>;

  constructor(configService: ConfigService) {
    const miniMax = configService.get<number>('OCR_MINI_CONCURRENCY', 8);
    const gpt52Max = configService.get<number>('OCR_GPT52_CONCURRENCY', 3);

    this.pools = new Map<RateLimitPool, PoolState>([
      ['mini', { current: 0, max: miniMax, queue: [] }],
      ['gpt52', { current: 0, max: gpt52Max, queue: [] }],
    ]);

    this.logger.log('Rate limiter initialized', {
      miniConcurrency: miniMax,
      gpt52Concurrency: gpt52Max,
    });
  }

  /**
   * Acquire a slot in the specified pool.
   * Blocks (via Promise) until a slot is available.
   */
  async acquire(pool: RateLimitPool): Promise<void> {
    const state = this.getPool(pool);

    if (state.current < state.max) {
      state.current++;
      return;
    }

    // Queue is full — wait for a slot
    return new Promise<void>((resolve) => {
      state.queue.push(() => {
        state.current++;
        resolve();
      });
    });
  }

  /**
   * Release a slot back to the pool.
   * Unblocks the next waiting caller if any.
   */
  release(pool: RateLimitPool): void {
    const state = this.getPool(pool);

    if (state.queue.length > 0) {
      // Give slot to next waiter (current stays the same)
      const next = state.queue.shift();
      if (next) {
        next();
        return;
      }
    }

    state.current = Math.max(0, state.current - 1);
  }

  /**
   * Get current usage stats for a pool.
   */
  getStats(pool: RateLimitPool): { current: number; max: number; waiting: number } {
    const state = this.getPool(pool);
    return {
      current: state.current,
      max: state.max,
      waiting: state.queue.length,
    };
  }

  private getPool(pool: RateLimitPool): PoolState {
    const state = this.pools.get(pool);
    if (!state) {
      throw new Error(`Unknown rate limit pool: ${pool}`);
    }
    return state;
  }
}
