/**
 * Real Browser Terminal — xterm.js + node-pty + proot Ubuntu 22.04
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = process.env.PORT || 7860;

const BIN_DIR    = path.join(__dirname, 'bin');
const PROOT_PATH = path.join(BIN_DIR, 'proot');
const ROOTFS_DIR = path.join(__dirname, 'rootfs');
const ARCHIVE    = path.join(__dirname, 'rootfs.tar.gz');

const PROOT_URLS = [
  'https://proot.gitlab.io/proot/bin/proot',
  'https://raw.githubusercontent.com/proot-me/proot-static-build/master/proot-x86_64'
];
const ROOTFS_URLS = [
  'https://cdimage.ubuntu.com/ubuntu-base/releases/jammy/release/ubuntu-base-22.04-base-amd64.tar.gz'
];

function log(level, msg) {
  const t = new Date().toISOString().slice(11,19);
  console.log(`[${t}] [${level.toUpperCase()}] ${msg}`);
}

function download(urls, dest, i = 0) {
  return new Promise((resolve, reject) => {
    if (i >= urls.length) return reject(new Error('All sources failed'));
    const url = urls[i];
    log('info', `Downloading from source ${i+1}/${urls.length}: ${url}`);
    const client = url.startsWith('https') ? https : http;
    client.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return download([res.headers.location, ...urls.slice(i+1)], dest, 0).then(resolve).catch(reject);
      if (res.statusCode !== 200) {
        log('warn', `HTTP ${res.statusCode}, trying next`);
        return download(urls, dest, i+1).then(resolve).catch(reject);
      }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => { out.close(); resolve(); });
    }).on('error', err => {
      log('warn', `Error: ${err.message}`);
      download(urls, dest, i+1).then(resolve).catch(reject);
    });
  });
}

async function setup() {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  if (!fs.existsSync(PROOT_PATH)) {
    log('info', 'Fetching proot...');
    await download(PROOT_URLS, PROOT_PATH);
    fs.chmodSync(PROOT_PATH, 0o755);
    log('info', 'proot ready');
  }
  const bash = path.join(ROOTFS_DIR, 'bin', 'bash');
  if (fs.existsSync(ROOTFS_DIR) && !fs.existsSync(bash)) {
    log('warn', 'Incomplete rootfs, purging...');
    fs.rmSync(ROOTFS_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(ROOTFS_DIR, { recursive: true });
  if (!fs.existsSync(bash)) {
    log('info', 'Fetching Ubuntu 22.04 rootfs...');
    await download(ROOTFS_URLS, ARCHIVE);
    log('info', 'Extracting...');
    await new Promise((resolve, reject) => {
      const tar = spawn('tar', ['-xzf', ARCHIVE, '-C', ROOTFS_DIR]);
      tar.on('close', code => code === 0 ? resolve() : reject(new Error(`tar exited ${code}`)));
    });
    try { fs.unlinkSync(ARCHIVE); } catch(_) {}
    log('info', 'rootfs ready');
  } else {
    log('info', 'rootfs already present');
  }
}

// ── HTML with xterm.js ────────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Terminal</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.min.css">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    background: #0c0c0c;
    height: 100%;
    overflow: hidden;
    font-family: monospace;
  }
  #titlebar {
    height: 32px;
    background: #1a1a1a;
    border-bottom: 1px solid #2a2a2a;
    display: flex;
    align-items: center;
    padding: 0 12px;
    gap: 8px;
    flex-shrink: 0;
  }
  .dot { width: 12px; height: 12px; border-radius: 50%; cursor: pointer; }
  .dot-r { background: #ff5f57; }
  .dot-y { background: #febc2e; }
  .dot-g { background: #28c840; }
  #tab {
    margin-left: 8px;
    background: #2a2a2a;
    border-radius: 4px;
    padding: 3px 12px;
    font-size: 12px;
    color: #aaa;
  }
  #status {
    margin-left: auto;
    font-size: 11px;
    color: #555;
  }
  #status.live { color: #28c840; }
  #status.dead { color: #ff5f57; }
  #terminal-container {
    width: 100%;
    height: calc(100vh - 32px);
    padding: 4px;
  }
  .xterm { height: 100%; }
  .xterm-viewport { border-radius: 0 !important; }
</style>
</head>
<body>
<div id="titlebar">
  <div class="dot dot-r"></div>
  <div class="dot dot-y"></div>
  <div class="dot dot-g"></div>
  <div id="tab">bash — ubuntu 22.04</div>
  <span id="status">connecting...</span>
</div>
<div id="terminal-container"></div>

<script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xterm-addon-web-links@0.9.0/lib/xterm-addon-web-links.min.js"></script>
<script>
  const statusEl = document.getElementById('status');

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: '"JetBrains Mono", "Cascadia Code", "Fira Code", Menlo, monospace',
    theme: {
      background:      '#0c0c0c',
      foreground:      '#cccccc',
      cursor:          '#ffffff',
      cursorAccent:    '#000000',
      black:           '#000000',
      red:             '#cc0000',
      green:           '#4e9a06',
      yellow:          '#c4a000',
      blue:            '#3465a4',
      magenta:         '#75507b',
      cyan:            '#06989a',
      white:           '#d3d7cf',
      brightBlack:     '#555753',
      brightRed:       '#ef2929',
      brightGreen:     '#8ae234',
      brightYellow:    '#fce94f',
      brightBlue:      '#729fcf',
      brightMagenta:   '#ad7fa8',
      brightCyan:      '#34e2e2',
      brightWhite:     '#eeeeec',
      selectionBackground: '#44475a',
    },
    allowTransparency: false,
    scrollback: 5000,
    convertEol: false,
  });

  const fitAddon = new FitAddon.FitAddon();
  const webLinksAddon = new WebLinksAddon.WebLinksAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(webLinksAddon);
  term.open(document.getElementById('terminal-container'));
  fitAddon.fit();

  // Resize observer
  const ro = new ResizeObserver(() => fitAddon.fit());
  ro.observe(document.getElementById('terminal-container'));

  // WebSocket
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const ws = new WebSocket(proto + location.host);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    statusEl.textContent = '● connected';
    statusEl.className = 'live';
    // Send initial size
    const dims = { type: 'resize', cols: term.cols, rows: term.rows };
    ws.send(JSON.stringify(dims));
  };

  ws.onmessage = e => {
    if (e.data instanceof ArrayBuffer) {
      term.write(new Uint8Array(e.data));
    } else {
      try {
        const d = JSON.parse(e.data);
        if (d.type === 'reload') { location.reload(); return; }
      } catch(_) {}
      term.write(e.data);
    }
  };

  ws.onclose = () => {
    statusEl.textContent = '● disconnected';
    statusEl.className = 'dead';
    term.write('\r\n\x1b[31mConnection closed. Refresh to reconnect.\x1b[0m\r\n');
  };

  // Input → server
  term.onData(data => {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'input', data }));
  });

  // Resize → server
  term.onResize(({ cols, rows }) => {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  });
</script>
</body>
</html>`;

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
});

const wss = new WebSocket.Server({ server });

function spawnShell(cols, rows) {
  // Try node-pty first, fall back to plain spawn
  try {
    const pty = require('node-pty');
    return {
      type: 'pty',
      proc: pty.spawn('/bin/bash', ['--login'], {
        name: 'xterm-256color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: '/root',
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          HOME: '/root',
          USER: 'root',
          SHELL: '/bin/bash',
          PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        }
      })
    };
  } catch(_) {
    // node-pty not available, use proot + plain spawn
    const proc = spawn(PROOT_PATH, [
      '-r', ROOTFS_DIR, '-0', '-w', '/',
      '-b', '/proc', '-b', '/dev', '-b', '/sys',
      '/bin/bash', '--login'
    ], {
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        HOME: '/root',
        USER: 'root',
        SHELL: '/bin/bash',
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      }
    });
    return { type: 'spawn', proc };
  }
}

wss.on('connection', ws => {
  log('info', 'Client connected');

  // DNS
  try {
    const etc = path.join(ROOTFS_DIR, 'etc');
    fs.mkdirSync(etc, { recursive: true });
    fs.writeFileSync(path.join(etc, 'resolv.conf'), 'nameserver 8.8.8.8\nnameserver 1.1.1.1\n');
  } catch(_) {}

  let shell = spawnShell(80, 24);
  log('info', `Shell type: ${shell.type}`);

  function bindShell(s) {
    if (s.type === 'pty') {
      s.proc.onData(data => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      });
      s.proc.onExit(({ exitCode }) => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(`\r\n\x1b[31m[process exited: ${exitCode}]\x1b[0m\r\n`);
      });
    } else {
      s.proc.stdout.on('data', d => { if (ws.readyState === WebSocket.OPEN) ws.send(d.toString()); });
      s.proc.stderr.on('data', d => { if (ws.readyState === WebSocket.OPEN) ws.send(d.toString()); });
      s.proc.on('close', code => {
        if (ws.readyState === WebSocket.OPEN && code !== null)
          ws.send(`\r\n\x1b[31m[process exited: ${code}]\x1b[0m\r\n`);
      });
    }
  }

  bindShell(shell);

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'input') {
        if (shell.type === 'pty') shell.proc.write(msg.data);
        else if (shell.proc.stdin.writable) shell.proc.stdin.write(msg.data);
      } else if (msg.type === 'resize') {
        if (shell.type === 'pty') shell.proc.resize(msg.cols, msg.rows);
      } else if (msg.type === 'reload') {
        if (shell.type === 'pty') shell.proc.kill();
        else shell.proc.kill();
        shell = spawnShell(80, 24);
        bindShell(shell);
        ws.send(JSON.stringify({ type: 'reload' }));
      }
    } catch(_) {
      if (shell.type === 'pty') shell.proc.write(raw.toString());
      else if (shell.proc.stdin.writable) shell.proc.stdin.write(raw.toString());
    }
  });

  ws.on('close', () => {
    log('info', 'Client disconnected');
    try {
      if (shell.type === 'pty') shell.proc.kill();
      else shell.proc.kill();
    } catch(_) {}
  });
});

setup().then(() => {
  server.listen(PORT, () => log('info', `Listening on port ${PORT}`));
}).catch(err => {
  log('error', `Setup failed: ${err.message}`);
  process.exit(1);
});
