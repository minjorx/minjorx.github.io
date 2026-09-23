/**
 * 预制模型（Prefab）系统
 *
 * - 导出当前模型为 .voxel-prefab.json 文件
 * - 导入文件，校验，加入 localStorage 库
 * - Prefab → Template 转换
 */

import type { VoxelGrid } from './voxel-grid'
import { voxelToHex } from './color-quantize'

export interface PrefabFile {
  version: 1
  type: 'prefab'
  name: string
  description?: string
  voxels: Array<{ x: number; y: number; z: number }>
  colors?: number[]
  defaultColor: number
  bbox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }
  meta?: {
    createdAt?: number
    voxelCount?: number
  }
}

export function exportAsPrefab(grid: VoxelGrid, name: string, description?: string): PrefabFile {
  const voxels: Array<{ x: number; y: number; z: number }> = []
  const colors: number[] = []
  let minX = grid.n, minY = grid.n, minZ = grid.n
  let maxX = -1, maxY = -1, maxZ = -1

  for (let i = 0; i < grid.data.length; i++) {
    const v = grid.data[i]
    if (v === 0) continue
    const c = grid.toCoord(i)
    voxels.push(c)
    colors.push(v)
    if (c.x < minX) minX = c.x
    if (c.y < minY) minY = c.y
    if (c.z < minZ) minZ = c.z
    if (c.x > maxX) maxX = c.x
    if (c.y > maxY) maxY = c.y
    if (c.z > maxZ) maxZ = c.z
  }

  // 计算 defaultColor（出现最多的色）
  const counts = new Map<number, number>()
  for (const c of colors) counts.set(c, (counts.get(c) ?? 0) + 1)
  let best = 0xffff
  let bestCount = 0
  for (const [c, n] of counts) {
    if (n > bestCount) { bestCount = n; best = c }
  }

  // 平移到以 bbox.min 为原点
  const shiftedVoxels = voxels.map(v => ({
    x: v.x - minX, y: v.y - minY, z: v.z - minZ,
  }))

  return {
    version: 1,
    type: 'prefab',
    name,
    description,
    voxels: shiftedVoxels,
    colors,
    defaultColor: best,
    bbox: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
    },
    meta: { createdAt: Date.now(), voxelCount: voxels.length },
  }
}

export function prefabToJson(prefab: PrefabFile): string {
  return JSON.stringify(prefab, null, 2)
}

export function importPrefab(json: string): PrefabFile | string {
  let data: any
  try {
    data = JSON.parse(json)
  } catch {
    return '文件格式错误'
  }
  if (data.version !== 1) return `版本不兼容：${data.version}`
  if (data.type !== 'prefab') return '不是预制模型文件'
  if (!Array.isArray(data.voxels)) return 'voxels 字段缺失'
  if (data.voxels.length > 32 ** 3) return '体素数超过上限'
  return data as PrefabFile
}

export async function importPrefabFromFile(file: File): Promise<PrefabFile | string> {
  if (file.size > 1024 * 1024) return '文件过大（> 1MB）'
  const text = await file.text()
  return importPrefab(text)
}

/** 触发浏览器下载 */
export function downloadPrefab(prefab: PrefabFile) {
  const json = prefabToJson(prefab)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${prefab.name.replace(/[^\w一-龥-]/g, '_')}.voxel-prefab.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** 触发下载项目 JSON */
export function downloadProject(json: string, filename = 'project.voxel.json') {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export { voxelToHex }