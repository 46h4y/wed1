import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 Starting Wedding Portal full-stack development environment...');

const server = spawn(process.execPath, ['server/index.js'], {
  stdio: 'inherit',
  cwd: __dirname
});

const viteBin = path.join(__dirname, 'node_modules', 'vite', 'bin', 'vite.js');
const client = spawn(process.execPath, [viteBin], {
  stdio: 'inherit',
  cwd: __dirname
});

const killProcess = (child) => {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch (e) {}
};

const cleanup = () => {
  console.log('\n🛑 Shutting down backend and frontend servers...');
  killProcess(server);
  killProcess(client);
  process.exit();
};

server.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`Backend exited with code ${code}`);
  }
});

client.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`Vite exited with code ${code}`);
  }
});

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);
