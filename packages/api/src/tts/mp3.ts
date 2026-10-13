/**
 * Just enough MP3 to join clips into one file and know how long they are:
 * walk the frame headers (MPEG 1/2/2.5, Layer III), keeping the frames and
 * adding up their duration; ID3 tags and anything else in between are dropped.
 */

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** The audio frames of an MP3 and how many seconds they play. */
export function mp3Frames(buf: Buffer): { data: Buffer; seconds: number } {
  const frames: Buffer[] = [];
  let seconds = 0;
  let i = 0;
  while (i + 4 <= buf.length) {
    // An ID3v2 tag: skip it (its size is "syncsafe", 7 bits a byte).
    if (buf[i] === 0x49 && buf[i + 1] === 0x44 && buf[i + 2] === 0x33 && i + 10 <= buf.length) {
      const size = ((buf[i + 6]! & 0x7f) << 21) | ((buf[i + 7]! & 0x7f) << 14) | ((buf[i + 8]! & 0x7f) << 7) | (buf[i + 9]! & 0x7f);
      i += 10 + size;
      continue;
    }
    const b1 = buf[i + 1]!;
    const b2 = buf[i + 2]!;
    if (buf[i] !== 0xff || (b1 & 0xe0) !== 0xe0) {
      i++;
      continue;
    }
    const version = (b1 >> 3) & 3; // 3: MPEG 1, 2: MPEG 2, 0: MPEG 2.5
    const layer = (b1 >> 1) & 3; // 1: Layer III
    const bitrateIndex = b2 >> 4;
    const rateIndex = (b2 >> 2) & 3;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) {
      i++;
      continue;
    }
    const kbps = (version === 3 ? BITRATES_V1 : BITRATES_V2)[bitrateIndex]!;
    const rate = SAMPLE_RATES[version]![rateIndex]!;
    const samples = version === 3 ? 1152 : 576;
    const length = Math.floor(((version === 3 ? 144 : 72) * kbps * 1000) / rate) + ((b2 >> 1) & 1);
    if (length < 4 || i + length > buf.length) break;
    frames.push(buf.subarray(i, i + length));
    seconds += samples / rate;
    i += length;
  }
  return { data: Buffer.concat(frames), seconds };
}
