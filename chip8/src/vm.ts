/**
 * References:
 *  http://devernay.free.fr/hacks/chip8/C8TECH10.HTM
 *  https://github.com/mattmikolay/chip-8/wiki/CHIP%E2%80%908-Instruction-Set
 */
import * as font from "./font";

/**
 * Size of memory for a Chip8 VM.
 * Always 4k.
 */
export const MEMSIZE = 4096;

/**
 * The location in memory where programs
 * should be loaded
 * (0x200 for most, 0x600 for ETI 600)
 */
export const PROGRAM_START = 0x200;

export interface IO {
  /**
   * Clears the display
   */
  clearDisplay(): void;
}

export class VM {
  mem: Mem;
  pc: number; // program counter
  i: number; // index register
  v: Array<number>; // general purpose registers
  stack: Array<number>;
  dt: number; // delay timer
  st: number; // sound timer
  io: IO;

  constructor(io: IO) {
    this.mem = new Mem();
    this.pc = PROGRAM_START;
    this.i = 0;
    this.v = Array(16).fill(0);
    this.stack = [];
    this.dt = 0;
    this.st = 0;
    this.io = io;
  }

  /**
   * Loads a program into the memory of this VM
   * @param program bytes of the program
   */
  load(program: Iterable<number>) {
    this.mem.write(PROGRAM_START, program);
  }

  tick(timestamp: number) {}

  /**
   * Fetch and run a single instruction
   */
  step() {
    const code = this.fetch();
    const byte1 = code >> 8;
    const byte2 = code & 0xff;
    const nibble = byte1 >> 4;
    switch (nibble) {
      case 0: {
        if (byte1 === 0) {
          switch (byte2) {
            case 0xe0: {
              // CLS
              this.io.clearDisplay();
              break;
            }
            case 0xee: {
              // RET
              // return from a subroutine
              this.pc = this.pop();
              break;
            }
            default: {
              throw unrecognizedOpcode(code);
            }
          }
        } else {
          // From reference:
          // 0nnn - SYS addr
          // This instruction is only used on the old computers on which
          // Chip-8 was originally implemented.
          // It is ignored by modern interpreters.
        }
        break;
      }
      case 1: {
        // JP addr
        // Jump to location nnn
        this.pc = code & 0xfff;
        break;
      }
      case 2: {
        // CALL addr
        // call subroutine at nnn
        this.stack.push(this.pc);
        this.pc = code & 0xfff;
        break;
      }
      case 3: {
        // SE Vx, byte
        // Skip next instruction if Vx = kk
        const x = byte1 & 0xf;
        if (this.v[x] === byte2) {
          // fetch already incremented by 2,
          // so we only need to increment by 2 more
          this.pc += 2;
        }
        break;
      }
      case 4: {
        // SNE Vx, byte
        // Skip next instruction if Vx != kk
        const x = byte1 & 0xf;
        if (this.v[x] !== byte2) {
          // fetch already incremented by 2,
          // so we only need to increment by 2 more
          this.pc += 2;
        }
        break;
      }
      case 5: {
        if ((byte2 & 0xf) === 0) {
          // SE Vx, Vy
          // Skip next instruction if Vx = Vy
          const x = byte1 & 0xf;
          const y = byte2 >> 8;
          if (this.v[x] === this.v[y]) {
            // fetch already incremented by 2,
            // so we only need to increment by 2 more
            this.pc += 2;
          }
        } else {
          throw unrecognizedOpcode(code);
        }
        break;
      }
      case 6: {
        // LD Vx, byte
        // Set Vx = kk
        const x = byte1 & 0xf;
        this.v[x] = byte2;
        break;
      }
      case 7: {
        // ADD Vx, byte
        // Set Vx += kk
        const x = byte1 & 0xf;
        this.v[x] += byte2;
        break;
      }
      case 8: {
        const nibble2 = byte2 & 0xf;
        const x = byte1 & 0xf;
        const y = byte2 >> 8;
        switch (nibble2) {
          case 0: {
            this.v[x] = this.v[y];
            break;
          }
          case 1: {
            this.v[x] |= this.v[y];
            break;
          }
          case 2: {
            this.v[x] &= this.v[y];
            break;
          }
          case 3: {
            this.v[x] ^= this.v[y];
            break;
          }
          case 4: {
            const sum = this.v[x] + this.v[y];
            this.v[x] = sum & 0xf;
            this.v[0xf] = sum > 0xf ? 1 : 0;
            break;
          }
          case 5: {
            // SUB
            const vx = this.v[x];
            const vy = this.v[y];
            if (vx >= vy) {
              // Cowgod's doc seems to say vx > vy here
              // which seems wrong; but the doc on github with
              // mattmikolay simply says "if a borrow occurs"
              // I'm gonna go with the second definition
              this.v[0xf] = 1;
              this.v[x] = vx - vy;
            } else {
              this.v[0xf] = 0;
              this.v[x] = 256 + vx - vy;
            }
            break;
          }
          case 6: {
            // SHR Vx {, Vy }
            // Set Vx = Vx SHR 1
            // NOTE: 'y' is ignored (i.e. first nibble of byte2)
            // More info:
            // https://www.reddit.com/r/EmuDev/comments/72dunw/chip8_8xy6_help/
            const v = this.v[x];
            this.v[x] = v >> 1;
            this.v[0xf] = v & 1;
            break;
          }
          case 7: {
            // SUBN
            // like case 5, but vx and vy order are reversed
            const vx = this.v[x];
            const vy = this.v[y];
            if (vy >= vx) {
              this.v[0xf] = 1;
              this.v[x] = vy - vx;
            } else {
              this.v[0xf] = 0;
              this.v[x] = 256 + vy - vx;
            }
            break;
          }
          case 0xe: {
            // SHL Vx {, Vy }
            // Set Vx = Vx SHL 1
            // NOTE: 'y' is ignored (i.e. first nibble of byte2)
            // More info:
            // https://www.reddit.com/r/EmuDev/comments/72dunw/chip8_8xy6_help/
            const v = this.v[x];
            this.v[x] = v << 1;
            this.v[0xf] = v & 1;
            break;
          }
          default: {
            throw unrecognizedOpcode(code);
          }
        }
        break;
      }
      case 9: {
        if ((byte2 & 0xf) === 0) {
          // SNE Vx, Vy
          // Skip next instruction if Vx != Vy
          const x = byte1 & 0xf;
          const y = byte2 >> 8;
          if (this.v[x] !== this.v[y]) {
            // fetch already incremented by 2,
            // so we only need to increment by 2 more
            this.pc += 2;
          }
        } else {
          throw unrecognizedOpcode(code);
        }
        break;
      }
      case 0xa: {
        // LD I, addr
        this.i = code & 0xfff;
        break;
      }
      case 0xb: {
        // JP V0, addr
        // Jump to location nnn + V0
        this.pc = this.v[0] + (code & 0xfff);
        break;
      }
      case 0xc: {
        // RND Vx, byte
        const x = byte1 & 0xf;
        const rand = Math.floor(Math.random() * 256) & byte2;
        this.v[x] = rand;
        break;
      }
      case 0xd: {
        // DRW Vx, Vy, nibble
        // Display n-byte sprite starting at memory location I at
        // (Vx, Vy), set VF = collision
        const x = byte1 & 0xf;
        const y = byte2 >> 8;
        const n = byte2 & 0xf;
        throw "TODO";
      }
      default: {
        throw unrecognizedOpcode(code);
      }
    }
  }

  fetch(): number {
    const bytecode = this.mem.u16(this.pc);
    this.pc += 2;
    return bytecode;
  }

  pop(): number {
    const pc = this.stack.pop();
    if (pc === undefined) {
      throw new Error("Pop from empty stack");
    }
    return pc;
  }
}

function unrecognizedOpcode(code: number): Error {
  return new Error(`Unrecognized opcode: 0x${code.toString(16)}`);
}

/**
 * Chip8 memory
 */
export class Mem {
  buf: Uint8Array;

  constructor() {
    this.buf = new Uint8Array(MEMSIZE);
    this.write(0, font.BYTES);
  }

  u8(i: number): number {
    return this.buf[i];
  }

  setu8(i: number, value: number) {
    this.buf[i] = value;
  }

  u16(i: number): number {
    // NOTE: chip-8 instructions are read as big endian
    return (this.buf[i] << 8) + this.buf[i + 1];
  }

  setu16(i: number, value: number) {
    this.buf[i] = value >> 8;
    this.buf[i + 1] = value & 0xff;
  }

  write(i: number, data: Iterable<number>) {
    for (const x of data) {
      this.buf[i++] = x;
    }
  }
}
