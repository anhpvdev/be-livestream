import 'dotenv/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express, { type Request, type Response } from 'express';

const execFileAsync = promisify(execFile);

type MetricSample = {
  container: string;
  containerId: string;
  containerName: string;
  ts: number;
  cpuPercent: number;
  gpuPercent: number | null;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  bitrateMbps: number | null;
  netIoTotalBytes: number;
};

const app = express();
const port = Number(process.env.PORT ?? 8090);
const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? 10_000);
const defaultWindowMinutes = Number(process.env.WINDOW_MINUTES ?? 5);
const activeCpuThreshold = Number(process.env.ACTIVE_CPU_THRESHOLD ?? 0.2);
const collectModeRaw = (process.env.COLLECT_MODE ?? 'always').trim().toLowerCase();
const collectMode = collectModeRaw === 'active' ? 'active' : 'always';
const targetContainers = (process.env.TARGET_CONTAINERS ?? 'encoder-primary,encoder-backup')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const samplesByContainer = new Map<string, MetricSample[]>();
const latestByContainer = new Map<string, MetricSample>();
const lastNetByContainer = new Map<string, { ts: number; totalBytes: number }>();

const parsePercent = (raw: string): number => {
  const normalized = raw.replace('%', '').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseMemoryBytes = (raw: string): number => {
  const trimmed = raw.trim();
  const match = trimmed.match(/^([\d.]+)\s*([kmgt]?i?)?b?$/i);
  if (!match) {
    return 0;
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return 0;
  }

  const unit = (match[2] ?? '').toLowerCase();
  const unitMultiplier: Record<string, number> = {
    '': 1,
    k: 1000,
    m: 1000 ** 2,
    g: 1000 ** 3,
    t: 1000 ** 4,
    ki: 1024,
    mi: 1024 ** 2,
    gi: 1024 ** 3,
    ti: 1024 ** 4,
  };

  return Math.round(value * (unitMultiplier[unit] ?? 1));
};

const parseUsageAndLimit = (
  raw: string,
): { usageBytes: number; limitBytes: number } => {
  const [usageRaw, limitRaw] = raw.split('/').map((value) => value.trim());
  return {
    usageBytes: parseMemoryBytes(usageRaw ?? '0'),
    limitBytes: parseMemoryBytes(limitRaw ?? '0'),
  };
};

const parseNetIoTotalBytes = (raw: string): number => {
  const [rxRaw, txRaw] = raw.split('/').map((value) => value.trim());
  return parseMemoryBytes(rxRaw ?? '0') + parseMemoryBytes(txRaw ?? '0');
};

const toMb = (bytes: number): number => Number((bytes / (1024 * 1024)).toFixed(2));

const readGpuPercent = async (): Promise<number | null> => {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', [
      '--query-gpu=utilization.gpu',
      '--format=csv,noheader,nounits',
    ]);
    const values = stdout
      .split('\n')
      .map((line) => Number(line.trim()))
      .filter((value) => Number.isFinite(value));
    if (!values.length) {
      return null;
    }
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
  } catch {
    return null;
  }
};

const trimOldSamples = (container: string, nowTs: number): void => {
  const maxWindowMs = Math.max(defaultWindowMinutes, 60) * 60_000;
  const kept = (samplesByContainer.get(container) ?? []).filter(
    (sample) => nowTs - sample.ts <= maxWindowMs,
  );
  samplesByContainer.set(container, kept);
};

const collectMetrics = async (): Promise<void> => {
  const format = '{{json .}}';
  const gpuPercent = await readGpuPercent();
  let stdout = '';
  try {
    const result = await execFileAsync('docker', [
      'stats',
      '--no-stream',
      '--format',
      format,
      ...targetContainers,
    ]);
    stdout = result.stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Không crash monitor nếu container chưa tồn tại/chưa chạy.
    if (message.includes('No such container')) {
      return;
    }
    throw error;
  }

  const nowTs = Date.now();
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const currentBatch = new Map<string, MetricSample>();
  for (const line of lines) {
    const parsed = JSON.parse(line) as {
      ID: string;
      Name: string;
      CPUPerc: string;
      MemPerc: string;
      MemUsage: string;
      NetIO?: string;
    };

    const { usageBytes, limitBytes } = parseUsageAndLimit(parsed.MemUsage ?? '0 / 0');
    const netIoTotalBytes = parseNetIoTotalBytes(parsed.NetIO ?? '0B / 0B');
    const previousNet = lastNetByContainer.get(parsed.ID);
    let bitrateMbps: number | null = null;
    if (previousNet && nowTs > previousNet.ts && netIoTotalBytes >= previousNet.totalBytes) {
      const deltaBytes = netIoTotalBytes - previousNet.totalBytes;
      const deltaSec = (nowTs - previousNet.ts) / 1000;
      const bitsPerSec = deltaSec > 0 ? (deltaBytes * 8) / deltaSec : 0;
      bitrateMbps = Number((bitsPerSec / 1_000_000).toFixed(3));
    }
    lastNetByContainer.set(parsed.ID, { ts: nowTs, totalBytes: netIoTotalBytes });

    const sample: MetricSample = {
      container: parsed.Name,
      containerId: parsed.ID,
      containerName: parsed.Name,
      ts: nowTs,
      cpuPercent: parsePercent(parsed.CPUPerc ?? '0%'),
      gpuPercent,
      memoryPercent: parsePercent(parsed.MemPerc ?? '0%'),
      memoryUsageBytes: usageBytes,
      memoryLimitBytes: limitBytes,
      bitrateMbps,
      netIoTotalBytes,
    };

    for (const target of targetContainers) {
      const isNameMatch = parsed.Name === target;
      const isIdExactMatch = parsed.ID === target;
      const isIdPrefixMatch = parsed.ID.startsWith(target);
      if (!isNameMatch && !isIdExactMatch && !isIdPrefixMatch) {
        continue;
      }

      currentBatch.set(target, {
        ...sample,
        // Trả về đúng key mà người dùng cấu hình để dễ map API.
        container: target,
      });
    }
  }

  const shouldCollect =
    collectMode === 'always' ||
    Array.from(currentBatch.values()).some(
      (sample) => sample.cpuPercent >= activeCpuThreshold,
    );
  if (!shouldCollect) {
    return;
  }

  for (const sample of currentBatch.values()) {
    latestByContainer.set(sample.container, sample);
    const history = samplesByContainer.get(sample.container) ?? [];
    history.push(sample);
    samplesByContainer.set(sample.container, history);
    trimOldSamples(sample.container, nowTs);
  }
};

const toSummary = (
  container: string,
  windowMinutes: number,
): {
  container_id: string;
  container_name: string;
  ts: number;
  windowMinutes: number;
  samples: number;
  cpu_percen: number;
  cpu_max: number;
  cpu_min: number;
  ram_percen: number;
  ram_usage: number;
  gpu_percent: number | null;
  gpu_max: number | null;
  gpu_min: number | null;
  bitrate_mbps: number | null;
} => {
  const now = Date.now();
  const minTs = now - windowMinutes * 60_000;
  const data = (samplesByContainer.get(container) ?? []).filter((sample) => sample.ts >= minTs);

  if (data.length === 0) {
    return {
      container_id: container,
      container_name: container,
      ts: now,
      windowMinutes,
      samples: 0,
      cpu_percen: 0,
      cpu_max: 0,
      cpu_min: 0,
      ram_percen: 0,
      ram_usage: 0,
      gpu_percent: null,
      gpu_max: null,
      gpu_min: null,
      bitrate_mbps: null,
    };
  }

  const sum = data.reduce(
    (acc, item) => {
      return {
        cpu: acc.cpu + item.cpuPercent,
        memPercent: acc.memPercent + item.memoryPercent,
        memUsage: acc.memUsage + item.memoryUsageBytes,
      };
    },
    { cpu: 0, memPercent: 0, memUsage: 0 },
  );

  const cpuValues = data.map((item) => item.cpuPercent);
  const memUsageValues = data.map((item) => item.memoryUsageBytes);
  const memPercentValues = data.map((item) => item.memoryPercent);
  const gpuValues = data
    .map((item) => item.gpuPercent)
    .filter((value): value is number => value !== null);
  const bitrateValues = data
    .map((item) => item.bitrateMbps)
    .filter((value): value is number => value !== null);
  const latest = data[data.length - 1];

  return {
    container_id: latest.containerId,
    container_name: latest.containerName,
    ts: latest.ts,
    windowMinutes,
    samples: data.length,
    cpu_percen: Number((sum.cpu / data.length).toFixed(2)),
    cpu_max: Number(Math.max(...cpuValues).toFixed(2)),
    cpu_min: Number(Math.min(...cpuValues).toFixed(2)),
    ram_percen: Number((sum.memPercent / data.length).toFixed(2)),
    ram_usage: toMb(Math.round(sum.memUsage / data.length)),
    gpu_percent: gpuValues.length
      ? Number((gpuValues.reduce((acc, value) => acc + value, 0) / gpuValues.length).toFixed(2))
      : null,
    gpu_max: gpuValues.length ? Number(Math.max(...gpuValues).toFixed(2)) : null,
    gpu_min: gpuValues.length ? Number(Math.min(...gpuValues).toFixed(2)) : null,
    bitrate_mbps: bitrateValues.length
      ? Number((bitrateValues.reduce((acc, value) => acc + value, 0) / bitrateValues.length).toFixed(2))
      : null,
  };
};

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'encoder-monitor',
    targets: targetContainers,
    pollIntervalMs,
    collectMode,
    activeCpuThreshold,
  });
});

app.get('/metrics/current', (_req: Request, res: Response) => {
  const metrics = targetContainers.map((container) => {
    const latest = latestByContainer.get(container);
    if (!latest) {
      return {
        container_id: container,
        container_name: container,
        ts: Date.now(),
        cpu_percen: 0,
        cpu_max: 0,
        cpu_min: 0,
        ram_percen: 0,
        ram_usage: 0,
        gpu_percent: null,
        gpu_max: null,
        gpu_min: null,
        bitrate_mbps: null,
      };
    }
    return {
      container_id: latest.containerId,
      container_name: latest.containerName,
      ts: latest.ts,
      cpu_percen: latest.cpuPercent,
      cpu_max: latest.cpuPercent,
      cpu_min: latest.cpuPercent,
      ram_percen: latest.memoryPercent,
      ram_usage: toMb(latest.memoryUsageBytes),
      gpu_percent: latest.gpuPercent,
      gpu_max: latest.gpuPercent,
      gpu_min: latest.gpuPercent,
      bitrate_mbps: latest.bitrateMbps,
    };
  });
  res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    metrics,
  });
});

app.get('/metrics/avg', (req: Request, res: Response) => {
  const minutes = Number(req.query.minutes ?? defaultWindowMinutes);
  const windowMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : defaultWindowMinutes;
  const metrics = targetContainers.map((container) => toSummary(container, windowMinutes));

  res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    metrics,
  });
});

const boot = async (): Promise<void> => {
  try {
    await collectMetrics();
  } catch (error) {
    console.error('[monitor] initial collect failed:', error);
  }

  setInterval(async () => {
    try {
      await collectMetrics();
    } catch (error) {
      console.error('[monitor] collect failed:', error);
    }
  }, pollIntervalMs);

  app.listen(port, () => {
    console.log(`[monitor] running at http://localhost:${port}`);
    console.log(`[monitor] targets: ${targetContainers.join(', ')}`);
  });
};

void boot();
