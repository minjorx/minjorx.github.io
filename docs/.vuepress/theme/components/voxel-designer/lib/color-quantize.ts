/**
 * 16 桶 RGBA 量化 / 反量化
 *
 * - 0~255 分成 16 份（每桶跨 16 个原值）
 * - 存储用 Uint16，4 通道各占 4 bit
 * - 桶值 = i × 16 (i ∈ [0, 15])，最大 240
 */

export const STEP = 16
export const MAX_BUCKET = 15

/** 8-bit 值 → 桶号 [0, 15] */
export function quantizeChannel(v8: number): number {
  return Math.min(MAX_BUCKET, Math.max(0, Math.floor(v8 / STEP)))
}

/** 桶号 → 8-bit 还原值（floor，最大 240） */
export function dequantizeChannel(b: number): number {
  return Math.min(255, b * STEP)
}

export interface BucketRGBA {
  r: number
  g: number
  b: number
  a: number
}

/** Uint16 ↔ BucketRGBA */
export function packVoxel(r: number, g: number, b: number, a: number): number {
  return ((r & 0xf) << 12) | ((b & 0xf) << 8) | ((g & 0xf) << 4) | (a & 0xf)
  // 注：RGBA 顺序按 (r<<12)|(g<<8)|(b<<4)|a 重组更自然
}

/** 重新打包，按 R/G/B/A 各 4 bit */
export function packRGBA(r: number, g: number, b: number, a: number): number {
  return ((r & 0xf) << 12) | ((g & 0xf) << 8) | ((b & 0xf) << 4) | (a & 0xf)
}

export function unpackVoxel(v: number): BucketRGBA {
  return {
    a: v & 0xf,
    b: (v >> 4) & 0xf,
    g: (v >> 8) & 0xf,
    r: (v >> 12) & 0xf,
  }
}

/** 桶号 → 0xRRGGBB（用于 Three.js Color） */
export function bucketToHex(b: BucketRGBA): number {
  return (
    (dequantizeChannel(b.r) << 16) |
    (dequantizeChannel(b.g) << 8) |
    dequantizeChannel(b.b)
  )
}

/** Uint16 → 0xRRGGBB */
export function voxelToHex(v: number): number {
  if (v === 0) return 0
  return bucketToHex(unpackVoxel(v))
}

/** 8-bit RGB → 桶号（a=15=不透明） */
export function packFromRGB(r8: number, g8: number, b8: number, a8 = 255): number {
  return packRGBA(
    quantizeChannel(r8),
    quantizeChannel(g8),
    quantizeChannel(b8),
    quantizeChannel(a8),
  )
}