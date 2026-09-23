/**
 * 默认预制模型（5 个）
 *
 * - 所有模板使用 corner-min 原点（v0.1 简化）
 * - 返回相对坐标，从 (0,0,0) 开始的体素列表
 */

import type { Vec3 } from './voxel-grid'

export type OriginType = 'corner-min' | 'center' | 'center-bottom'

export interface Template {
  id: string
  name: string
  icon: string
  origin: OriginType
  params?: Record<string, { min: number; max: number; default: number; label: string }>
  build: (params: Record<string, number>) => Vec3[]
}

function addVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

/** 1×1×1 单体素 */
const pixel: Template = {
  id: 'pixel',
  name: '1×1',
  icon: '·',
  origin: 'corner-min',
  build: () => [{ x: 0, y: 0, z: 0 }],
}

/** 实心立方体 a×a×a */
function buildCube(a: number): Vec3[] {
  const out: Vec3[] = []
  for (let x = 0; x < a; x++) {
    for (let y = 0; y < a; y++) {
      for (let z = 0; z < a; z++) {
        out.push({ x, y, z })
      }
    }
  }
  return out
}

const cube: Template = {
  id: 'cube',
  name: '立方体',
  icon: '◼',
  origin: 'corner-min',
  params: {
    size: { min: 1, max: 16, default: 2, label: '边长' },
  },
  build: ({ size }) => buildCube(size),
}

/** 长方体 a×b×c */
function buildBox(a: number, b: number, c: number): Vec3[] {
  const out: Vec3[] = []
  for (let x = 0; x < a; x++) {
    for (let y = 0; y < b; y++) {
      for (let z = 0; z < c; z++) {
        out.push({ x, y, z })
      }
    }
  }
  return out
}

const box: Template = {
  id: 'box',
  name: '长方体',
  icon: '▭',
  origin: 'corner-min',
  params: {
    w: { min: 1, max: 32, default: 4, label: '宽 X' },
    hh: { min: 1, max: 32, default: 1, label: '高 Y' },
    d: { min: 1, max: 32, default: 4, label: '深 Z' },
  },
  build: ({ w, hh, d }) => buildBox(w, hh, d),
}

/** 圆柱 r×h（4 邻 + 6 邻填充） */
function buildCylinder(r: number, h: number): Vec3[] {
  const out: Vec3[] = []
  const r2 = r * r
  for (let y = 0; y < h; y++) {
    for (let z = -r; z <= r; z++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + z * z <= r2) {
          // 局部坐标系：center-bottom，因此平移到 [0, ...]
          out.push({ x: x + r, y, z: z + r })
        }
      }
    }
  }
  return out
}

const cylinder: Template = {
  id: 'cylinder',
  name: '圆柱',
  icon: '●',
  origin: 'center-bottom',
  params: {
    r: { min: 1, max: 12, default: 2, label: '半径' },
    h: { min: 1, max: 16, default: 2, label: '高度' },
  },
  build: ({ r, h }) => buildCylinder(r, h),
}

/** 球 r（按欧几里得距离） */
function buildSphere(r: number): Vec3[] {
  const out: Vec3[] = []
  const r2 = r * r
  for (let z = -r; z <= r; z++) {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y + z * z <= r2) {
          // 局部坐标系：center 正中
          out.push({ x: x + r, y: y + r, z: z + r })
        }
      }
    }
  }
  return out
}

const sphere: Template = {
  id: 'sphere',
  name: '球',
  icon: '◯',
  origin: 'center',
  params: {
    r: { min: 1, max: 12, default: 2, label: '半径' },
  },
  build: ({ r }) => buildSphere(r),
}

export const TEMPLATES: Template[] = [pixel, cube, box, cylinder, sphere]

export function getTemplateById(id: string): Template | null {
  return TEMPLATES.find(t => t.id === id) ?? null
}

/** 把模板相对坐标 + anchor → 世界坐标（含越界过滤） */
export function templateToWorld(
  template: Template,
  params: Record<string, number>,
  anchor: Vec3,
): Vec3[] {
  const local = template.build(params)
  // anchor 是模板原点位置，世界坐标 = local + anchor
  return local.map(v => addVec(v, anchor))
}