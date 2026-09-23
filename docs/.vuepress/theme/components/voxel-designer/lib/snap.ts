/**
 * 吸附：基于 Raycaster 拿 hit.face.normal
 *
 * - voxel-face 模式：raycast 命中已放体素，取邻居空位
 * - ground 模式：射线命中 y=0 平面
 * - free 模式：直接用最近的世界点投影到体素坐标
 */

import type { Vec3, VoxelGrid } from './voxel-grid'

export type SnapMode = 'voxel-face' | 'ground' | 'free'

export interface SnapResult {
  coord: Vec3
  source: 'voxel-face' | 'ground' | 'free'
  valid: boolean
  reason?: string  // 'occupied' | 'out-of-bounds'
}

/**
 * 解析鼠标位置 → 吸附坐标
 *
 * @param ndcMouse 鼠标归一化设备坐标 [-1, 1]^2
 * @param raycaster Three.js raycaster（已 setFromCamera）
 * @param grid 体素网格
 * @param instancedMesh 已放体素的 InstancedMesh
 * @param mode 吸附模式
 */
export function snapMouse(
  raycaster: { ray: { origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } } },
  grid: VoxelGrid,
  instancedMesh: any,
  mode: SnapMode,
): SnapResult | null {
  // === 阶段 1：体素面吸附 ===
  if (mode === 'voxel-face' && instancedMesh) {
    // 复用 Three.js Raycaster（无需完整实例）
    // 此函数由调用方传入 raycaster 和 instancedMesh
    // 这里只做坐标解析
  }
  // 实现细节见 GridView.vue 内的 snapMouse（直接用 Three.js Raycaster）
  // 此处保留函数签名供未来抽取

  // === 阶段 2：地面吸附 ===
  if (mode !== 'free') {
    const groundY = 0
    const dir = raycaster.ray.direction
    const orig = raycaster.ray.origin
    if (Math.abs(dir.y) < 1e-6) return null
    const t = (groundY - orig.y) / dir.y
    if (t < 0) return null
    const hx = orig.x + dir.x * t
    const hz = orig.z + dir.z * t
    const coord = { x: Math.floor(hx), y: 0, z: Math.floor(hz) }
    if (grid.inBounds(coord)) {
      return { coord, source: 'ground', valid: !grid.isOccupied(coord) }
    }
  }

  // === 阶段 3：自由放置 ===
  // 直接用 ray 与 y=0 或平均 y 的交点
  const dir = raycaster.ray.direction
  const orig = raycaster.ray.origin
  // 取网格中心 y = n/2 的平面
  const centerY = grid.n / 2
  if (Math.abs(dir.y) > 1e-6) {
    const t = (centerY - orig.y) / dir.y
    if (t > 0) {
      const hx = orig.x + dir.x * t
      const hz = orig.z + dir.z * t
      const coord = {
        x: Math.round(hx - 0.5),
        y: Math.round(centerY - 0.5),
        z: Math.round(hz - 0.5),
      }
      if (grid.inBounds(coord)) {
        return { coord, source: 'free', valid: !grid.isOccupied(coord) }
      }
    }
  }

  return null
}

/** BFS 洪水填充（替换连通区域的颜色） */
export function floodFill(
  grid: VoxelGrid,
  start: Vec3,
  newColor: number,
): { patches: Array<{ idx: number; from: number; to: number }> } {
  const startColor = grid.get(start.x, start.y, start.z)
  if (startColor === 0) return { patches: [] }  // 空白格无区域
  if (startColor === newColor) return { patches: [] }  // 同色不操作

  const patches: Array<{ idx: number; from: number; to: number }> = []
  const visited = new Set<number>()
  const queue: Vec3[] = [start]

  while (queue.length > 0) {
    const c = queue.shift()!
    const idx = grid.toIdx(c.x, c.y, c.z)
    if (visited.has(idx)) continue
    visited.add(idx)
    if (!grid.inBounds(c)) continue
    if (grid.get(c.x, c.y, c.z) !== startColor) continue

    patches.push({ idx, from: startColor, to: newColor })

    queue.push({ x: c.x + 1, y: c.y, z: c.z })
    queue.push({ x: c.x - 1, y: c.y, z: c.z })
    queue.push({ x: c.x, y: c.y + 1, z: c.z })
    queue.push({ x: c.x, y: c.y - 1, z: c.z })
    queue.push({ x: c.x, y: c.y, z: c.z + 1 })
    queue.push({ x: c.x, y: c.y, z: c.z - 1 })
  }

  return { patches }
}

/** 全局替换颜色 */
export function replaceColor(
  grid: VoxelGrid,
  fromColor: number,
  toColor: number,
): { patches: Array<{ idx: number; from: number; to: number }> } {
  const patches: Array<{ idx: number; from: number; to: number }> = []
  if (fromColor === toColor) return { patches }
  for (let i = 0; i < grid.data.length; i++) {
    if (grid.data[i] === fromColor) {
      patches.push({ idx: i, from: fromColor, to: toColor })
    }
  }
  return { patches }
}