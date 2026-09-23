/**
 * VoxelGrid - N×N×N 紧凑位图
 *
 * - Uint16Array 存储，每个体素 4 通道各 4 bit
 * - 索引公式：idx = x + y*N + z*N*N
 * - 值 = 0 表示该位置无体素
 */

import { packRGBA, unpackVoxel } from './color-quantize'

export type NValue = 16 | 32 | 64

export interface Vec3 {
  x: number
  y: number
  z: number
}

export class VoxelGrid {
  readonly n: number
  data: Uint16Array
  // 不透明的 4-bit 全 F = 0xFFFF（白色，不透明）
  static readonly DEFAULT_COLOR = 0xffff

  constructor(n: number) {
    this.n = n
    this.data = new Uint16Array(n * n * n)
  }

  toIdx(x: number, y: number, z: number): number {
    return x + y * this.n + z * this.n * this.n
  }

  toCoord(idx: number): Vec3 {
    const n = this.n
    const x = idx % n
    const y = Math.floor(idx / n) % n
    const z = Math.floor(idx / (n * n))
    return { x, y, z }
  }

  inBounds(coord: Vec3): boolean {
    return (
      coord.x >= 0 && coord.x < this.n &&
      coord.y >= 0 && coord.y < this.n &&
      coord.z >= 0 && coord.z < this.n
    )
  }

  get(x: number, y: number, z: number): number {
    return this.data[this.toIdx(x, y, z)]
  }

  set(x: number, y: number, z: number, v: number): void {
    this.data[this.toIdx(x, y, z)] = v
  }

  isOccupied(coord: Vec3): boolean {
    if (!this.inBounds(coord)) return false
    return this.data[this.toIdx(coord.x, coord.y, coord.z)] !== 0
  }

  count(): number {
    let c = 0
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] !== 0) c++
    }
    return c
  }

  isEmpty(): boolean {
    return this.count() === 0
  }

  clear(): void {
    this.data.fill(0)
  }

  /** 沿 X 轴镜像整模：(x,y,z) → (n-1-x, y, z) */
  mirrorX(): void {
    const n = this.n
    const newData = new Uint16Array(this.data.length)
    for (let z = 0; z < n; z++) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const srcIdx = x + y * n + z * n * n
          const dstIdx = (n - 1 - x) + y * n + z * n * n
          newData[dstIdx] = this.data[srcIdx]
        }
      }
    }
    this.data = newData
  }

  mirrorY(): void {
    const n = this.n
    const newData = new Uint16Array(this.data.length)
    for (let z = 0; z < n; z++) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const srcIdx = x + y * n + z * n * n
          const dstIdx = x + (n - 1 - y) * n + z * n * n
          newData[dstIdx] = this.data[srcIdx]
        }
      }
    }
    this.data = newData
  }

  mirrorZ(): void {
    const n = this.n
    const newData = new Uint16Array(this.data.length)
    for (let z = 0; z < n; z++) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const srcIdx = x + y * n + z * n * n
          const dstIdx = x + y * n + (n - 1 - z) * n * n
          newData[dstIdx] = this.data[srcIdx]
        }
      }
    }
    this.data = newData
  }

  /** 计算几何中心 */
  computeCenter(): Vec3 {
    let minX = this.n, minY = this.n, minZ = this.n
    let maxX = -1, maxY = -1, maxZ = -1
    for (let z = 0; z < this.n; z++) {
      for (let y = 0; y < this.n; y++) {
        for (let x = 0; x < this.n; x++) {
          if (this.data[this.toIdx(x, y, z)] !== 0) {
            if (x < minX) minX = x
            if (y < minY) minY = y
            if (z < minZ) minZ = z
            if (x > maxX) maxX = x
            if (y > maxY) maxY = y
            if (z > maxZ) maxZ = z
          }
        }
      }
    }
    if (maxX < 0) return { x: this.n / 2, y: this.n / 2, z: this.n / 2 }
    return {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2,
    }
  }

  /** 平移网格使几何中心对齐到空间中心 */
  centerOnOrigin(): void {
    const center = this.computeCenter()
    const targetX = (this.n - 1) / 2
    const targetY = (this.n - 1) / 2
    const targetZ = (this.n - 1) / 2
    const dx = Math.round(targetX - center.x)
    const dy = Math.round(targetY - center.y)
    const dz = Math.round(targetZ - center.z)
    this.shift(dx, dy, dz)
  }

  /** 平移 (超界体素被截断) */
  shift(dx: number, dy: number, dz: number): void {
    const n = this.n
    const newData = new Uint16Array(n * n * n)
    for (let z = 0; z < n; z++) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const src = this.data[this.toIdx(x, y, z)]
          if (src === 0) continue
          const nx = x + dx, ny = y + dy, nz = z + dz
          if (nx < 0 || nx >= n || ny < 0 || ny >= n || nz < 0 || nz >= n) continue
          newData[nx + ny * n + nz * n * n] = src
        }
      }
    }
    this.data = newData
  }

  /** 快速 hash（用于 undo 冲突检测） */
  hash(): string {
    let h = 0
    for (let i = 0; i < this.data.length; i++) {
      h = (h * 31 + this.data[i]) | 0
    }
    return h.toString(36)
  }

  toBase64(): string {
    const bytes = new Uint8Array(this.data.buffer)
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin)
  }

  static fromBase64(s: string, n: number): VoxelGrid {
    const bin = atob(s)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const data = new Uint16Array(bytes.buffer)
    const grid = new VoxelGrid(n)
    if (data.length !== grid.data.length) {
      throw new Error(`Voxel data length mismatch: expected ${grid.data.length}, got ${data.length}`)
    }
    grid.data.set(data)
    return grid
  }

  /** 计算默认色（出现最多的颜色） */
  computeDefaultColor(): number {
    const counts = new Map<number, number>()
    for (let i = 0; i < this.data.length; i++) {
      const v = this.data[i]
      if (v === 0) continue
      counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    let best = VoxelGrid.DEFAULT_COLOR
    let bestCount = 0
    for (const [c, n] of counts) {
      if (n > bestCount) { bestCount = n; best = c }
    }
    return best
  }
}

export type { VoxelGrid as VoxelGridType }