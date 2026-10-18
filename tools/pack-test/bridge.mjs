// A JSON-RPC client for REDbridge over stdio, for the pack test.
import { spawn } from 'node:child_process';

/** A JSON-RPC client over stdio, Content-Length framed like a language server. */
export function bridge(path, args = []) {
  const child = spawn(path, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', (d) => process.stderr.write(`[bridge] ${d}`));
  let buf = Buffer.alloc(0);
  let next = 1;
  const waiting = new Map();
  child.stdout.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      const len = Number(/Content-Length: *(\d+)/i.exec(buf.subarray(0, end).toString())?.[1]);
      if (buf.length < end + 4 + len) return;
      const msg = JSON.parse(buf.subarray(end + 4, end + 4 + len).toString('utf8'));
      buf = buf.subarray(end + 4 + len);
      const w = waiting.get(msg.id);
      if (!w) continue;
      waiting.delete(msg.id);
      msg.error ? w.reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? '')})`)) : w.resolve(msg.result);
    }
  });
  child.on('exit', (code) => {
    for (const w of waiting.values()) w.reject(new Error(`REDbridge exited with ${code}`));
  });
  return {
    call(method, params) {
      const id = next++;
      const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }), 'utf8');
      child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
      child.stdin.write(body);
      return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
    },
    close() {
      child.stdin.end();
    },
  };
}
