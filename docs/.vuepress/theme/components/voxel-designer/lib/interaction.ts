/**
 * 交互面算法（详见设计文档 §42）
 *
 * - getVoxelFace: 给定体素 + 摄像机方向，返回摄像机正面的轴和符号
 * - getSpaceFace: 给定摄像机方向，返回空间 6 个边界面中最远的一面
 * - raycastSpaceFace: 给定 ray 与一面，求交点 → 体素坐标
 */

import type { Vec3 } from './voxel-grid'

export type Axis = 'x' | 'y' | 'z'
export type Sign = -1 | 1

export interface Face {
  axis: Axis
  sign: Sign
  position: number  // 在空间坐标中的位置（0 或 n）
}

/** 给定坐标 + axis/sign，返回单位向量（normal） */
export function faceNormal(axis: Axis, sign: Sign): Vec3 {
  return { x: axis === 'x' ? sign : 0, y: axis === 'y' ? sign : 0, z: axis === 'z' ? sign : 0 }
}

/** 6 个空间边界面（沿正负轴） */
export const SPACE_FACES: Face[] = [
  { axis: 'x', sign: 1, position: 0 },   // +X 面（位置由调用方按 n 计算）
  { axis: 'x', sign: -1, position: 0 },  // -X
  { axis: 'y', sign: 1, position: 0 },   // +Y
  { axis: 'y', sign: -1, position: 0 },  // -Y
  { axis: 'z', sign: 1, position: 0 },   // +Z
  { axis: 'z', sign: -1, position: 0 },  // -Z
]

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function len(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
}

function normalize(v: Vec3): Vec3 {
  const l = len(v)
  if (l === 0) return { x: 0, y: 0, z: 0 }
  return { x: v.x / l, y: v.y / l, z: v.z / l }
}

/**
 * 给定体素 + 摄像机方向，返回摄像机正面（normal 最朝向 cameraDir 的面）
 */
export function getVoxelFace(voxel: Vec3, cameraDir: Vec3): Face {
  // 6 个面（在体素中心坐标系，normal 朝外）
  const faces: Face[] = [
    { axis: 'x', sign: 1, position: 0 },
    { axis: 'x', sign: -1, position: 0 },
    { axis: 'y', sign: 1, position: 0 },
    { axis: 'y', sign: -1, position: 0 },
    { axis: 'z', sign: 1, position: 0 },
    { axis: 'z', sign: -1, position: 0 },
  ]
  let best = faces[0]
  let bestDot = dot(faceNormal(best.axis, best.sign), cameraDir)
  for (let i = 1; i < faces.length; i++) {
    const f = faces[i]
    const d = dot(faceNormal(f.axis, f.sign), cameraDir)
    if (d > bestDot) { bestDot = d; best = f }
  }
  return best
}

/**
 * 给定 N + 摄像机方向，返回空间 6 个边界面中最远的一面（normal 最**远离** cameraDir）
 */
export function getSpaceFace(n: number, cameraDir: Vec3): Face {
  const faces: Face[] = [
    { axis: 'x', sign: 1, position: n },
    { axis: 'x', sign: -1, position: 0 },
    { axis: 'y', sign: 1, position: n },
    { axis: 'y', sign: -1, position: 0 },
    { axis: 'z', sign: 1, position: n },
    { axis: 'z', sign: -1, position: 0 },
  ]
  let best = faces[0]
  let worstDot = dot(faceNormal(best.axis, best.sign), cameraDir)
  for (let i = 1; i < faces.length; i++) {
    const f = faces[i]
    const d = dot(faceNormal(f.axis, f.sign), cameraDir)
    if (d < worstDot) { worstDot = d; best = f }
  }
  return best
}

/**
 * 计算 ray 与给定的空间面相交，返回该面上的 2D 体素坐标（可能越界）
 * @deprecated 使用 raycastPlane 替代
 */
export function raycastSpaceFace(
  rayOrigin: Vec3,
  rayDir: Vec3,
  face: Face,
): Vec3 | null {
  const result = raycastPlane(rayOrigin, rayDir, face)
  return result ? result.target : null
}

/** 6 个空间面清单（用于遍历） */
export function getAllSpaceFaces(n: number): Face[] {
  return [
    { axis: 'x', sign: 1, position: n },
    { axis: 'x', sign: -1, position: 0 },
    { axis: 'y', sign: 1, position: n },
    { axis: 'y', sign: -1, position: 0 },
    { axis: 'z', sign: 1, position: n },
    { axis: 'z', sign: -1, position: 0 },
  ]
}

/**
 * 通用：ray 与给定 plane 相交，返回该平面上的整数坐标 + t（不 clamp）
 */
export function raycastPlane(
  rayOrigin: Vec3,
  rayDir: Vec3,
  plane: { axis: Axis; sign: Sign; position: number },
): { target: Vec3; t: number } | null {
  const normal = faceNormal(plane.axis, plane.sign)
  const denom = rayDir.x * normal.x + rayDir.y * normal.y + rayDir.z * normal.z
  if (Math.abs(denom) < 1e-6) return null
  const t = (plane.position - (rayOrigin.x * normal.x + rayOrigin.y * normal.y + rayOrigin.z * normal.z)) / denom
  if (t < 0) return null
  const hx = rayOrigin.x + rayDir.x * t
  const hy = rayOrigin.y + rayDir.y * t
  const hz = rayOrigin.z + rayDir.z * t
  let target: Vec3
  if (plane.axis === 'x') target = { x: plane.position, y: Math.floor(hy), z: Math.floor(hz) }
  else if (plane.axis === 'y') target = { x: Math.floor(hx), y: plane.position, z: Math.floor(hz) }
  else target = { x: Math.floor(hx), y: Math.floor(hy), z: plane.position }
  return { target, t }
}

/** 由 hit.face.normal (Three.js 击中面法线) 反推出 Face 描述 */
export function normalToFace(normal: { x: number; y: number; z: number }): Face {
  const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z)
  if (ax >= ay && ax >= az) {
    return { axis: 'x', sign: normal.x > 0 ? 1 : -1, position: 0 }
  }
  if (ay >= az) {
    return { axis: 'y', sign: normal.y > 0 ? 1 : -1, position: 0 }
  }
  return { axis: 'z', sign: normal.z > 0 ? 1 : -1, position: 0 }
}