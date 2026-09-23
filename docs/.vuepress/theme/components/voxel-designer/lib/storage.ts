/**
 * 持久化：localStorage 读写
 *
 * - 当前项目：minjor:voxel:current
 * - 预制模型库：minjor:voxel:prefabs
 */

import type { VoxelGrid } from './voxel-grid'
import type { PrefabFile } from './prefab'

const KEY_CURRENT = 'minjor:voxel:current'
const KEY_PREFABS = 'minjor:voxel:prefabs'

export interface ProjectFile {
  version: 1
  n: number
  voxels: string  // base64-encoded Uint16Array
  meta?: {
    title?: string
    updatedAt?: number
  }
}

export interface SavedProject {
  n: number
  grid: VoxelGrid
  meta?: ProjectFile['meta']
}

export function exportProject(grid: VoxelGrid, meta?: ProjectFile['meta']): string {
  const file: ProjectFile = {
    version: 1,
    n: grid.n,
    voxels: grid.toBase64(),
    meta: { ...meta, updatedAt: Date.now() },
  }
  return JSON.stringify(file)
}

export function importProject(json: string): SavedProject {
  const file = JSON.parse(json) as ProjectFile
  if (file.version !== 1) throw new Error(`不支持的版本：${file.version}`)
  if (![16, 32, 64, 128].includes(file.n)) throw new Error(`非法的 N：${file.n}`)
  const grid = VoxelGrid.fromBase64(file.voxels, file.n)
  return { n: file.n, grid, meta: file.meta }
}

export function saveCurrent(grid: VoxelGrid): boolean {
  try {
    localStorage.setItem(KEY_CURRENT, exportProject(grid))
    return true
  } catch {
    return false
  }
}

export function loadCurrent(): SavedProject | null {
  const s = localStorage.getItem(KEY_CURRENT)
  if (!s) return null
  try {
    return importProject(s)
  } catch {
    return null
  }
}

export function savePrefabs(prefabs: PrefabFile[]): boolean {
  try {
    localStorage.setItem(KEY_PREFABS, JSON.stringify(prefabs))
    return true
  } catch {
    return false
  }
}

export function loadPrefabs(): PrefabFile[] {
  const s = localStorage.getItem(KEY_PREFABS)
  if (!s) return []
  try {
    const arr = JSON.parse(s) as PrefabFile[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function clearCurrent(): void {
  localStorage.removeItem(KEY_CURRENT)
}