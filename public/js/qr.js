/**
 * Vendored QR encoder (no packages, no CDN).
 *
 * Based on Project Nayuki's QR Code generator library (MIT License):
 * https://www.nayuki.io/page/qr-code-generator-library
 *
 * Copyright (c) Project Nayuki
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * This trimmed version supports byte mode only and versions 1-7.
 *
 * Small, self-contained byte-mode QR generator for short ASCII payloads such
 * as the signed ticket code. Supports versions 1-7 at error-correction level
 * M by default; that is comfortably larger than a ticket code needs.
 *
 * Public API:
 *   createQrCode(text, { ecc = "M" }) -> { size, modules }
 *   modules[y][x] is true for a dark module.
 */

const ECC_CODEWORDS_PER_BLOCK = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20],
  M: [-1, 10, 16, 26, 18, 24, 16, 18],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18],
  H: [-1, 17, 28, 22, 16, 22, 28, 26],
};

const NUM_ERROR_CORRECTION_BLOCKS = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2],
  M: [-1, 1, 1, 1, 2, 2, 4, 4],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6],
  H: [-1, 1, 1, 2, 4, 4, 4, 5],
};

const FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };
const MAX_VERSION = 7;

function getBit(value, index) {
  return ((value >>> index) & 1) !== 0;
}

function getNumRawDataModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function getNumDataCodewords(version, ecc) {
  const rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
  const eccLen = ECC_CODEWORDS_PER_BLOCK[ecc][version];
  const blocks = NUM_ERROR_CORRECTION_BLOCKS[ecc][version];
  return rawCodewords - eccLen * blocks;
}

function getAlignmentPatternPositions(version) {
  if (version === 1) return [];
  const size = version * 4 + 17;
  const numAlign = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}

function appendBits(bits, value, length) {
  for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
}

function createDataCodewords(data, version, ecc) {
  const bits = [];
  appendBits(bits, 0b0100, 4); // byte mode
  appendBits(bits, data.length, version <= 9 ? 8 : 16);
  for (const byte of data) appendBits(bits, byte, 8);

  const capacity = getNumDataCodewords(version, ecc) * 8;
  appendBits(bits, 0, Math.min(4, capacity - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const result = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    result.push(byte);
  }

  const padBytes = [0xec, 0x11];
  let padIndex = 0;
  while (result.length < getNumDataCodewords(version, ecc)) {
    result.push(padBytes[padIndex % 2]);
    padIndex += 1;
  }
  return result;
}

function reedSolomonMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function reedSolomonDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = reedSolomonMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = reedSolomonMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    for (let i = 0; i < divisor.length; i += 1) {
      result[i] ^= reedSolomonMultiply(divisor[i], factor);
    }
  }
  return result;
}

function addEccAndInterleave(data, version, ecc) {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecc][version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecc][version];
  const rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = reedSolomonDivisor(blockEccLen);

  const blocks = [];
  let offset = 0;
  for (let i = 0; i < numBlocks; i += 1) {
    const dataLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const block = data.slice(offset, offset + dataLen);
    offset += dataLen;
    const eccBytes = reedSolomonRemainder(block, divisor);
    if (i < numShortBlocks) block.push(0); // alignment placeholder
    block.push(...eccBytes);
    blocks.push(block);
  }

  const result = [];
  for (let i = 0; i < blocks[0].length; i += 1) {
    for (let j = 0; j < blocks.length; j += 1) {
      // Skip the placeholder we inserted for short blocks.
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
        result.push(blocks[j][i]);
      }
    }
  }
  return result;
}

function maskBit(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: throw new Error(`Unknown QR mask: ${mask}`);
  }
}

function penaltyScore(modules) {
  const size = modules.length;
  let penalty = 0;

  // N1: runs of five or more same-colour modules in a row or column.
  for (let y = 0; y < size; y += 1) {
    let runColor = modules[y][0];
    let runLength = 0;
    for (let x = 0; x < size; x += 1) {
      if (modules[y][x] === runColor) {
        runLength += 1;
      } else {
        if (runLength >= 5) penalty += 3 + (runLength - 5);
        runColor = modules[y][x];
        runLength = 1;
      }
    }
    if (runLength >= 5) penalty += 3 + (runLength - 5);
  }
  for (let x = 0; x < size; x += 1) {
    let runColor = modules[0][x];
    let runLength = 0;
    for (let y = 0; y < size; y += 1) {
      if (modules[y][x] === runColor) {
        runLength += 1;
      } else {
        if (runLength >= 5) penalty += 3 + (runLength - 5);
        runColor = modules[y][x];
        runLength = 1;
      }
    }
    if (runLength >= 5) penalty += 3 + (runLength - 5);
  }

  // N2: same-colour 2x2 blocks.
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const color = modules[y][x];
      if (modules[y][x + 1] === color && modules[y + 1][x] === color && modules[y + 1][x + 1] === color) {
        penalty += 3;
      }
    }
  }

  // N3: finder-like 1:1:3:1:1 patterns with four light modules on a side.
  const finder = [true, false, true, true, true, false, true, false, false, false, false];
  const reversed = [...finder].reverse();
  function matches(line, start, pattern) {
    for (let i = 0; i < pattern.length; i += 1) {
      if (line[start + i] !== pattern[i]) return false;
    }
    return true;
  }
  for (let y = 0; y < size; y += 1) {
    for (let start = 0; start + 11 <= size; start += 1) {
      if (matches(modules[y], start, finder)) penalty += 40;
      if (matches(modules[y], start, reversed)) penalty += 40;
    }
  }
  for (let x = 0; x < size; x += 1) {
    const column = modules.map((row) => row[x]);
    for (let start = 0; start + 11 <= size; start += 1) {
      if (matches(column, start, finder)) penalty += 40;
      if (matches(column, start, reversed)) penalty += 40;
    }
  }

  // N4: deviation from 50% dark modules.
  let dark = 0;
  for (const row of modules) for (const value of row) if (value) dark += 1;
  const total = size * size;
  const steps = Math.max(0, Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1);
  penalty += steps * 10;

  return penalty;
}

function getFormatBits(ecc, mask) {
  const data = (FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return (((data << 10) | rem) ^ 0x5412) & 0x7fff;
}

/**
 * Generate a QR matrix for `text`.
 * @param {string} text
 * @param {{ecc?: "L"|"M"|"Q"|"H"}} options
 * @returns {{size: number, modules: boolean[][]}}
 */
export function createQrCode(text, { ecc = "M" } = {}) {
  const level = String(ecc).toUpperCase();
  if (!(level in ECC_CODEWORDS_PER_BLOCK)) throw new Error(`Unsupported ECC level: ${ecc}`);

  const data = new TextEncoder().encode(String(text));
  let version = 0;
  for (let v = 1; v <= MAX_VERSION; v += 1) {
    const neededBits = 4 + 8 + data.length * 8;
    if (neededBits <= getNumDataCodewords(v, level) * 8) {
      version = v;
      break;
    }
  }
  if (version === 0) throw new Error("QR payload is too long for this encoder");

  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));

  function setFunctionModule(x, y, dark) {
    modules[y][x] = dark;
    isFunction[y][x] = true;
  }

  function drawFinderPattern(x, y) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  }

  function drawAlignmentPattern(x, y) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  function drawFormatBits(mask) {
    const bits = getFormatBits(level, mask);
    for (let i = 0; i <= 5; i += 1) setFunctionModule(8, i, getBit(bits, i));
    setFunctionModule(8, 7, getBit(bits, 6));
    setFunctionModule(8, 8, getBit(bits, 7));
    setFunctionModule(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i += 1) setFunctionModule(14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i += 1) setFunctionModule(size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i += 1) setFunctionModule(8, size - 15 + i, getBit(bits, i));
    setFunctionModule(8, size - 8, true);
  }

  function drawVersionBits() {
    if (version < 7) return;
    let rem = version;
    for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i += 1) {
      const dark = getBit(bits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunctionModule(a, b, dark);
      setFunctionModule(b, a, dark);
    }
  }

  function drawFunctionPatterns() {
    for (let i = 0; i < size; i += 1) {
      setFunctionModule(6, i, i % 2 === 0);
      setFunctionModule(i, 6, i % 2 === 0);
    }
    drawFinderPattern(3, 3);
    drawFinderPattern(size - 4, 3);
    drawFinderPattern(3, size - 4);

    if (version >= 2) {
      const positions = getAlignmentPatternPositions(version);
      for (let i = 0; i < positions.length; i += 1) {
        for (let j = 0; j < positions.length; j += 1) {
          if ((i === 0 && j === 0) || (i === 0 && j === positions.length - 1) || (i === positions.length - 1 && j === 0)) {
            continue;
          }
          drawAlignmentPattern(positions[i], positions[j]);
        }
      }
    }

    drawFormatBits(0); // placeholder; overwritten after mask selection
    drawVersionBits();
  }

  function drawCodewords(codewords) {
    let bitIndex = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // skip the vertical timing column
      for (let vert = 0; vert < size; vert += 1) {
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          if (!isFunction[y][x]) {
            let dark = false;
            if (bitIndex < codewords.length * 8) {
              dark = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7));
            }
            modules[y][x] = dark;
            bitIndex += 1;
          }
        }
      }
    }
  }

  function applyMask(mask) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (!isFunction[y][x] && maskBit(mask, x, y)) {
          modules[y][x] = !modules[y][x];
        }
      }
    }
  }

  drawFunctionPatterns();
  const dataCodewords = createDataCodewords(data, version, level);
  drawCodewords(addEccAndInterleave(dataCodewords, version, level));

  let bestMask = 0;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    applyMask(mask);
    drawFormatBits(mask);
    const penalty = penaltyScore(modules);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
    }
    applyMask(mask); // undo
  }

  applyMask(bestMask);
  drawFormatBits(bestMask);
  return { size, modules };
}

export default createQrCode;
