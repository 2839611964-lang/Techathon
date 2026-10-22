import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import localtunnel from 'localtunnel';

const port = Number(process.env.PORT || 4173);
const localHost = Object.values(networkInterfaces()).flat().find((address) => address?.family === 'IPv4' && !address.internal && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address.address))?.address || '127.0.0.1';
const preferredSubdomain = process.env.SHARE_SUBDOMAIN || 'marie-ai-beauty-companion';
const server = spawn(process.execPath, ['server.js'], { env: process.env, stdio: 'inherit' });
let tunnel = null;
let closing = false;

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (server.exitCode != null) throw new Error(`Marie 服务启动失败（退出码 ${server.exitCode}）`);
    try {
      const response = await fetch(`http://${localHost}:${port}/`);
      if (response.ok) return;
    } catch { /* wait for startup */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Marie 服务启动超时');
}

async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  try { await tunnel?.close(); } catch { /* best effort */ }
  if (server.exitCode == null) server.kill('SIGINT');
  process.exit(code);
}

try {
  await waitForServer();
  try {
    tunnel = await localtunnel({ port, local_host: localHost, subdomain: preferredSubdomain });
  } catch {
    tunnel = await localtunnel({ port, local_host: localHost });
  }
  let password = '';
  try {
    const response = await fetch('https://loca.lt/mytunnelpassword');
    if (response.ok) password = (await response.text()).trim();
  } catch { /* password page is optional */ }
  console.log('\nMarie 外网演示已启动');
  console.log(`链接：${tunnel.url}`);
  if (password) console.log(`首次访问若出现 Tunnel Password，请输入：${password}`);
  console.log('保持这个窗口运行；按 Ctrl+C 结束分享。\n');
  tunnel.on('close', () => shutdown(0));
  server.on('exit', (code) => { if (!closing) shutdown(code || 1); });
} catch (error) {
  console.error(`无法建立外网演示：${error.message}`);
  await shutdown(1);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
await new Promise(() => {});
