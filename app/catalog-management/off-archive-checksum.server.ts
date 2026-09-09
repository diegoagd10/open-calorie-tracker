// CRC-64/NVME: reflected polynomial, all-one initial value and final XOR.
// Split 32-bit words keep the streaming upload path free of per-byte BigInts.
const highTable = new Uint32Array(256);
const lowTable = new Uint32Array(256);
for (let index = 0; index < 256; index++) {
  let crc = BigInt(index);
  for (let bit = 0; bit < 8; bit++) crc = (crc >> 1n) ^ ((crc & 1n) ? 0x9a6c9329ac4bc9b5n : 0n);
  highTable[index] = Number(crc >> 32n);
  lowTable[index] = Number(crc & 0xffffffffn);
}

export class OffArchiveChecksum {
  #high = 0xffffffff;
  #low = 0xffffffff;
  update(chunk: Uint8Array): void {
    let high = this.#high;
    let low = this.#low;
    for (const byte of chunk) {
      const index = (low ^ byte) & 255;
      low = (low >>> 8) ^ (high << 24) ^ lowTable[index];
      high = (high >>> 8) ^ highTable[index];
    }
    this.#high = high;
    this.#low = low;
  }
  digest(): string {
    const bytes = Buffer.alloc(8);
    bytes.writeUInt32BE((this.#high ^ 0xffffffff) >>> 0, 0);
    bytes.writeUInt32BE((this.#low ^ 0xffffffff) >>> 0, 4);
    return bytes.toString("base64");
  }
}
