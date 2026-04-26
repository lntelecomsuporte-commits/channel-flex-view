/**
 * SHA-1 hex (igual ao Node `crypto.createHash('sha1')`) — Web Crypto é async,
 * então pra manter API síncrona usamos uma implementação compacta em JS.
 * Suficiente: aqui só serve pra gerar slug determinístico de URL.
 */
export function createHash(input: string): string {
  // SHA-1 puro JS (RFC 3174). Compacto o bastante pra não justificar dependência.
  function rotl(n: number, s: number) { return (n << s) | (n >>> (32 - s)); }
  const bytes = new TextEncoder().encode(input);
  const ml = bytes.length * 8;
  // padding
  const withOne = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  withOne.set(bytes);
  withOne[bytes.length] = 0x80;
  const view = new DataView(withOne.buffer);
  // length em bits big-endian, últimos 8 bytes
  view.setUint32(withOne.length - 4, ml >>> 0, false);
  view.setUint32(withOne.length - 8, Math.floor(ml / 0x100000000), false);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let i = 0; i < withOne.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4, false);
    for (let j = 16; j < 80; j++) w[j] = rotl(w[j-3] ^ w[j-8] ^ w[j-14] ^ w[j-16], 1);
    let a=h0,b=h1,c=h2,d=h3,e=h4;
    for (let j = 0; j < 80; j++) {
      let f: number, k: number;
      if (j < 20)      { f = (b & c) | ((~b) & d); k = 0x5a827999; }
      else if (j < 40) { f = b ^ c ^ d;            k = 0x6ed9eba1; }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else             { f = b ^ c ^ d;            k = 0xca62c1d6; }
      const t = (rotl(a, 5) + f + e + k + w[j]) | 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = t;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4);
}
