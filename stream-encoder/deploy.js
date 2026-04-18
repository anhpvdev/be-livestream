#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const portArg = process.argv[2];
if (!portArg) {
  console.error('Usage: node deploy.js <port>');
  console.error('Example: node deploy.js 5000');
  process.exit(1);
}

if (!/^\d+$/.test(portArg)) {
  console.error(`Invalid port: ${portArg}. Port must be numeric.`);
  process.exit(1);
}

const port = Number(portArg);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid port: ${portArg}. Port must be in range 1..65535.`);
  process.exit(1);
}

const cwd = __dirname;
const projectName = `stream-encoder-${port}`;
const encoderNodeId = process.env.ENCODER_NODE_ID || `encoder-node-${port}`;
const encoderDisplayName = process.env.ENCODER_VPS_DISPLAY_NAME || `encoder-${port}`;
const encoderPublicHost = process.env.ENCODER_PUBLIC_HOST || 'host.docker.internal';
const encoderPublicBaseUrl =
  process.env.ENCODER_PUBLIC_BASE_URL || `http://${encoderPublicHost}:${port}`;
const backendRegisterUrl =
  process.env.BACKEND_ENCODER_VPS_REGISTER_URL ||
  'http://host.docker.internal:3000/api/webhooks/encoder-vps/register';

const ensurePortAvailable = (targetPort) =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err) => {
      reject(err);
    });
    server.once('listening', () => {
      server.close(() => resolve());
    });
    server.listen(targetPort, '0.0.0.0');
  });

const run = async () => {
  try {
    await ensurePortAvailable(port);
  } catch (error) {
    console.error(`Port ${port} is already in use on this machine.`);
    console.error('Choose another port, or stop the process that is using this port.');
    process.exit(1);
  }

  console.log(`Deploying stream-encoder on port ${port}`);
  console.log(`Project name: ${projectName}`);
  console.log(`Public base url: ${encoderPublicBaseUrl}`);

  const env = {
    ...process.env,
    HOST_PORT: String(port),
    ENCODER_NODE_ID: encoderNodeId,
    ENCODER_VPS_DISPLAY_NAME: encoderDisplayName,
    ENCODER_PUBLIC_BASE_URL: encoderPublicBaseUrl,
    BACKEND_ENCODER_VPS_REGISTER_URL: backendRegisterUrl,
  };

  if (!env.BACKEND_ENCODER_VPS_REGISTER_SECRET) {
    console.warn(
      'WARNING: BACKEND_ENCODER_VPS_REGISTER_SECRET is empty. Encoder will skip VPS registration webhook.',
    );
  }

  const composeArgs = [
    'compose',
    '-f',
    'docker-compose.deploy.yml',
    '-p',
    projectName,
    'up',
    '-d',
    '--build',
  ];

  const result = spawnSync('docker', composeArgs, {
    cwd,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    console.error(`Failed to run docker compose: ${result.error.message}`);
    process.exit(1);
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }

  console.log(`Done. Health check: http://localhost:${port}/health`);
};

void run();
