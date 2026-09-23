/**
 * 对称模式（mirror modifier）
 *
 * - 给定坐标 (x,y,z)和对称轴，返回镜像后的坐标
 * - 围绕体素空间中心（n-1-x, y, z 等）
 */

import type { Vec3 } from './voxel-grid'

export type SymmetryAxis = 'off' | 'x' | 'y' | 'z'

export function mirrorCoord(coord: Vec3, axis: SymmetryAxis, n: number): Vec3 {
  switch (axis) {
    case 'x': return { x: n - 1 - coord.x, y: coord.y, z: coord.z }
    case 'y': return { x: coord.x, y: n - 1 - coord.y, z: coord.z }
    case 'z': return { x: coord.x, y: coord.y, z: n - 1 - coord.z }
    case 'off':
    default:
      return coord
  }
}

/** 镜像坐标中是否等于自身（在对称轴上） */
export function isOnAxis(coord: Vec3, axis: SymmetryAxis, n: number): boolean {
  if (axis === 'off') return true
  const mirrored = mirrorCoord(coord, axis, n)
  return mirrored.x === coord.x && mirrored.y === coord.y && mirrored.z === coord.z
}

/** 镜像整模的 patches（用于 undo） */
export function mirrorAllPatches(
  data: Uint16Array,
  axis: SymmetryAxis,
  n: number,
): { from: Uint16Array; to: Uint16Array; patches: Array<{ idx: number; from: number; to: number }> } {
  const fromArr = new Uint16Array(data.length)
  fromArr.set(data)
  const toArr = new Uint16Array(data.length)
  toArr.set(data)
  const patches: Array<{ idx: number; from: number; to: number }> = []

  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const idx = x + y * n + z * n * n
        const v = data[idx]
        if (v === 0) continue
        const mirrorIdx =
          axis === 'x' ? (n - 1 - x) + y * n + z * n * n
          : axis === 'y' ? x + (n - 1 - y) * n + z * n * n
          : x + y * n + (n - 1 - z) * n * n
        if (mirrorIdx === idx) continue  // 在对称轴上
        if (toArr[mirrorIdx] !== 0) continue  // 目标已占用，跳过
        patches.push({ idx: mirrorIdx, from: 0, to: v })
        toArr[mirrorIdx] = v
      }
    }
  }

  return { from: fromArr, to: toArr, patches }
}