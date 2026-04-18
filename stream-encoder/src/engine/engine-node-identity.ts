import { randomUUID } from 'node:crypto';
import * as os from 'node:os';

/**
 * Định danh runtime của instance encoder (lease/heartbeat/đăng ký VPS).
 * Ưu tiên: HOSTNAME (Docker) → os.hostname() → ngẫu nhiên.
 * Không gắn vai trò main/backup — vai trò livestream chọn lúc start trên BE.
 */
export function resolveEngineNodeIdentity(): string {
  const fromDocker = process.env.HOSTNAME?.trim();
  if (fromDocker) return fromDocker;

  const fromOs = os.hostname()?.trim();
  if (fromOs) return fromOs;

  return `node-${randomUUID().slice(0, 8)}`;
}
