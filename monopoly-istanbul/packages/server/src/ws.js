// Minimal WebSocket sunucusu (RFC 6455) - bagimlilik yok. Metin mesajlari, ping/pong, kapatma.
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 1 << 20; // 1 MB

export class WSConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frag = null; // parcali mesaj birikimi
    this.open = true;
    this.alive = true;
    socket.on('data', (d) => this.#onData(d));
    socket.on('close', () => this.#closed(1006));
    socket.on('error', () => this.#closed(1006));
    socket.setNoDelay(true);
  }

  send(text) {
    if (!this.open) return;
    this.#write(0x1, Buffer.from(String(text), 'utf8'));
  }
  ping() { if (this.open) this.#write(0x9, Buffer.alloc(0)); }
  close(code = 1000) {
    if (!this.open) return;
    const b = Buffer.alloc(2);
    b.writeUInt16BE(code);
    this.#write(0x8, b);
    this.open = false;
    this.socket.end();
    this.emit('close', code);
  }

  #write(opcode, payload) {
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | opcode, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    try { this.socket.write(Buffer.concat([head, payload])); } catch { /* kapali */ }
  }

  #closed(code) {
    if (!this.open) return;
    this.open = false;
    this.emit('close', code);
  }

  #onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_PAYLOAD)) return this.close(1009);
        len = Number(big); off = 10;
      }
      if (len > MAX_PAYLOAD) return this.close(1009);
      if (!masked) return this.close(1002); // istemci cerceveleri maskeli olmali
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const data = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      this.#frame(fin, opcode, data);
      if (!this.open) return;
    }
  }

  #frame(fin, opcode, data) {
    if (opcode === 0x8) { this.close(1000); return; }
    if (opcode === 0x9) { this.#write(0xa, data); return; }
    if (opcode === 0xa) { this.alive = true; return; }
    if (opcode === 0x1 || opcode === 0x2) {
      if (!fin) { this.frag = { op: opcode, parts: [data], size: data.length }; return; }
      this.#message(opcode, data);
    } else if (opcode === 0x0 && this.frag) {
      this.frag.parts.push(data);
      this.frag.size += data.length;
      if (this.frag.size > MAX_PAYLOAD) return this.close(1009);
      if (fin) { const f = this.frag; this.frag = null; this.#message(f.op, Buffer.concat(f.parts)); }
    }
  }
  #message(opcode, data) {
    if (opcode === 0x1) this.emit('message', data.toString('utf8'));
  }
}

// http 'upgrade' olayi icin: el sikismayi tamamlar, WSConnection dondurur.
export function acceptUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  return new WSConnection(socket);
}
