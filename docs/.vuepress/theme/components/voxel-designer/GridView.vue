<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as THREE from 'three'
import type { VoxelGrid, Vec3 } from './lib/voxel-grid'
import { voxelToHex } from './lib/color-quantize'
import { createThreeScene, type ThreeContext } from './lib/three-setup'
import { mirrorCoord } from './lib/symmetry'
import type { Template } from './lib/templates'
import {
  getAllSpaceFaces, raycastPlane, getVoxelFace,
  faceNormal,
  type Face,
} from './lib/interaction'

const props = defineProps<{
  grid: VoxelGrid
  gridVersion: number
  currentColor: number
  template: Template | null
  templateParams: Record<string, number>
  symmetry: 'off' | 'x' | 'y' | 'z'
  mode: 'paint' | 'erase' | 'fill' | 'eyedrop' | 'replace'
  isDark: boolean
}>()

const emit = defineEmits<{
  (e: 'paint-at', coord: Vec3): void
  (e: 'erase-at', coord: Vec3): void
  (e: 'fill-at', coord: Vec3): void
  (e: 'eyedrop-at', coord: Vec3): void
  (e: 'place-template', coord: Vec3): void
  (e: 'hover', coord: Vec3 | null): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const fpsRef = ref(0)
const hoverInfoRef = ref<{ coord: Vec3; color: number; type: string } | null>(null)

let ctx: ThreeContext | null = null
// 6 个面 mesh：按 [+X, -X, +Y, -Y, +Z, -Z] 顺序
let faceMeshes: (THREE.InstancedMesh | null)[] = [null, null, null, null, null, null]
// 每面 mesh 的 instance 对应哪个 voxel + 哪个 face（raycast 用）
interface VisibleFace { voxel: Vec3; axis: 'x'|'y'|'z'; sign: 1|-1 }
let faceData: VisibleFace[][] = [[], [], [], [], [], []]

// 内部体素线框（被完全包围的体素仍可见，避免"消失"）
let interiorWireframe: THREE.LineSegments | null = null

let ghostMeshIn: THREE.InstancedMesh | null = null
let ghostMeshOut: THREE.InstancedMesh | null = null
let indicatorMesh: THREE.LineSegments | null = null
let boxHelper: THREE.LineSegments | null = null
let gridLines: THREE.LineSegments | null = null
let axesGroup: THREE.Group | null = null
let faceHighlight: THREE.Mesh | null = null

const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

// 拖动状态（已废弃；保留以避免编译错误）
let isDragging = false
let dragMode: 'paint' | 'erase' | null = null
const dragPainted = new Set<number>()

// LMB 点击检测（区分 click 与 orbit drag）
const LMB_CLICK_PX = 3
const LMB_CLICK_MS = 300
interface LmbDownState { x: number; y: number; time: number; isClick: boolean }
let lmbDown: LmbDownState | null = null

// 平移画面状态
let isPanning = false
let panStart: { x: number; y: number; target: Vec3; position: Vec3 } | null = null

// 当前焦点
interface InteractionFocus {
  type: 'voxel' | 'space' | 'none'
  coord: Vec3 | null   // 实际击中的体素（仅 voxel 模式有意义）
  target: Vec3 | null  // 操作目标位置
  face: Face | null    // 交互面
  valid: boolean
  reason?: 'out-of-bounds' | 'occupied'
}
let currentFocus: InteractionFocus = { type: 'none', coord: null, target: null, face: null, valid: false }

function getBgColor() {
  return props.isDark ? 0x1a1a1a : 0xf0f0f0
}

function voxelColor(v: number): THREE.Color {
  const hex = voxelToHex(v)
  return new THREE.Color((hex >> 16) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255)
}

function buildFaceMeshes(scene: THREE.Scene, n: number) {
  // 清理旧 6 面 mesh
  for (const m of faceMeshes) {
    if (m) {
      scene.remove(m)
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
    }
  }
  faceMeshes = [null, null, null, null, null, null]

  if (ghostMeshIn) {
    scene.remove(ghostMeshIn)
    ghostMeshIn.geometry.dispose()
    ;(ghostMeshIn.material as THREE.Material).dispose()
    ghostMeshIn = null
  }
  if (ghostMeshOut) {
    scene.remove(ghostMeshOut)
    ghostMeshOut.geometry.dispose()
    ;(ghostMeshOut.material as THREE.Material).dispose()
    ghostMeshOut = null
  }

  // 6 个面共享一个 PlaneGeometry(1,1)，normal=+Z
  // 每个 instance 通过 quaternion.setFromUnitVectors(+Z, faceNormal) 旋转到对应方向
  const faceGeometry = new THREE.PlaneGeometry(1, 1)
  // DoubleSide：让所有渲染的面从两侧可见，避免从某些角度看到"空"的体素
  // （比如大块中间体素，或边界体素从背面看）
  const material = new THREE.MeshLambertMaterial({ vertexColors: false, side: THREE.DoubleSide })
  const maxInstances = n * n * n  // 最坏情况

  for (let i = 0; i < 6; i++) {
    const mesh = new THREE.InstancedMesh(faceGeometry, material, maxInstances)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.count = 0
    mesh.frustumCulled = false  // 避免 Three.js mesh-level 视锥剔除意外剔除面
    scene.add(mesh)
    faceMeshes[i] = mesh
  }

  // ghost meshes 保留（用 box geometry）
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1)
  const ghostInMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false,
  })
  ghostMeshIn = new THREE.InstancedMesh(boxGeometry, ghostInMat, 4096)
  ghostMeshIn.count = 0
  scene.add(ghostMeshIn)

  const ghostOutMat = new THREE.MeshBasicMaterial({
    color: 0xff9800, transparent: true, opacity: 0.3, depthWrite: false,
  })
  ghostMeshOut = new THREE.InstancedMesh(boxGeometry, ghostOutMat, 4096)
  ghostMeshOut.count = 0
  scene.add(ghostMeshOut)
}

function updateFaceMeshes(grid: VoxelGrid) {
  if (!faceMeshes[0]) return
  const n = grid.n

  // 重置 faceData
  for (const arr of faceData) arr.length = 0

  // 遍历所有体素，检查邻居；邻居空 → 该面可见
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = grid.data[grid.toIdx(x, y, z)]
        if (v === 0) continue

        // +X
        if (x + 1 >= n || grid.data[grid.toIdx(x+1, y, z)] === 0) {
          faceData[0].push({ voxel: { x, y, z }, axis: 'x', sign: 1 })
        }
        // -X
        if (x - 1 < 0 || grid.data[grid.toIdx(x-1, y, z)] === 0) {
          faceData[1].push({ voxel: { x, y, z }, axis: 'x', sign: -1 })
        }
        // +Y
        if (y + 1 >= n || grid.data[grid.toIdx(x, y+1, z)] === 0) {
          faceData[2].push({ voxel: { x, y, z }, axis: 'y', sign: 1 })
        }
        // -Y
        if (y - 1 < 0 || grid.data[grid.toIdx(x, y-1, z)] === 0) {
          faceData[3].push({ voxel: { x, y, z }, axis: 'y', sign: -1 })
        }
        // +Z
        if (z + 1 >= n || grid.data[grid.toIdx(x, y, z+1)] === 0) {
          faceData[4].push({ voxel: { x, y, z }, axis: 'z', sign: 1 })
        }
        // -Z
        if (z - 1 < 0 || grid.data[grid.toIdx(x, y, z-1)] === 0) {
          faceData[5].push({ voxel: { x, y, z }, axis: 'z', sign: -1 })
        }
      }
    }
  }

  // 填充 6 个 mesh
  const dummy = new THREE.Object3D()
  for (let i = 0; i < 6; i++) {
    const mesh = faceMeshes[i]!
    const arr = faceData[i]
    mesh.count = arr.length
    for (let j = 0; j < arr.length; j++) {
      const f = arr[j]
      // 面在 cell 边界上：+方向 voxel[axis]+1，-方向 voxel[axis]
      const facePos = f.voxel[f.axis] + (f.sign > 0 ? 1 : 0)
      const cx = f.axis === 'x' ? facePos : f.voxel.x + 0.5
      const cy = f.axis === 'y' ? facePos : f.voxel.y + 0.5
      const cz = f.axis === 'z' ? facePos : f.voxel.z + 0.5

      _tmpVec3a.set(
        f.axis === 'x' ? f.sign : 0,
        f.axis === 'y' ? f.sign : 0,
        f.axis === 'z' ? f.sign : 0,
      )
      dummy.quaternion.setFromUnitVectors(_NORMAL_Z, _tmpVec3a)
      dummy.position.set(cx, cy, cz)
      dummy.updateMatrix()
      mesh.setMatrixAt(j, dummy.matrix)
      mesh.setColorAt(j, voxelColor(grid.data[grid.toIdx(f.voxel.x, f.voxel.y, f.voxel.z)]))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }
}

function buildInteriorWireframe(scene: THREE.Scene, n: number) {
  if (interiorWireframe) {
    scene.remove(interiorWireframe)
    interiorWireframe.geometry.dispose()
    ;(interiorWireframe.material as THREE.Material).dispose()
  }
  // 最大 N=64 的极端情况：内部体素最多 (62)³ ≈ 238K 个
  const MAX_N = 64
  const maxVerts = 24 * MAX_N * MAX_N * MAX_N
  const positions = new Float32Array(maxVerts * 3)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setDrawRange(0, 0)
  const material = new THREE.LineBasicMaterial({
    color: props.isDark ? 0x666666 : 0xbbbbbb,
    transparent: true,
    opacity: 0.4,
  })
  interiorWireframe = new THREE.LineSegments(geo, material)
  interiorWireframe.visible = false
  interiorWireframe.frustumCulled = false
  scene.add(interiorWireframe)
}

function updateInteriorWireframe(grid: VoxelGrid) {
  if (!interiorWireframe) return
  const n = grid.n
  const positions = interiorWireframe.geometry.attributes.position
    .array as Float32Array
  let count = 0

  // 单位立方体 12 条边的端点
  const E: number[] = [
    0, 0, 0,  1, 0, 0,
    1, 0, 0,  1, 0, 1,
    1, 0, 1,  0, 0, 1,
    0, 0, 1,  0, 0, 0,
    0, 1, 0,  1, 1, 0,
    1, 1, 0,  1, 1, 1,
    1, 1, 1,  0, 1, 1,
    0, 1, 1,  0, 1, 0,
    0, 0, 0,  0, 1, 0,
    1, 0, 0,  1, 1, 0,
    1, 0, 1,  1, 1, 1,
    0, 0, 1,  0, 1, 1,
  ]

  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (grid.data[grid.toIdx(x, y, z)] === 0) continue
        // 内部体素 = 6 邻居都在边界内且都被占据
        const xPlus  = x + 1 < n && grid.data[grid.toIdx(x+1, y, z)]   !== 0
        const xMinus = x - 1 >= 0 && grid.data[grid.toIdx(x-1, y, z)]   !== 0
        const yPlus  = y + 1 < n && grid.data[grid.toIdx(x, y+1, z)]   !== 0
        const yMinus = y - 1 >= 0 && grid.data[grid.toIdx(x, y-1, z)]   !== 0
        const zPlus  = z + 1 < n && grid.data[grid.toIdx(x, y, z+1)]   !== 0
        const zMinus = z - 1 >= 0 && grid.data[grid.toIdx(x, y, z-1)]   !== 0
        if (xPlus && xMinus && yPlus && yMinus && zPlus && zMinus) {
          // 12 条边
          for (let e = 0; e < E.length; e += 3) {
            positions[count++] = E[e]     + x
            positions[count++] = E[e + 1] + y
            positions[count++] = E[e + 2] + z
          }
        }
      }
    }
  }

  interiorWireframe.geometry.setDrawRange(0, count)
  interiorWireframe.geometry.attributes.position.needsUpdate = true
  interiorWireframe.visible = count > 0
}

function buildBoxHelper(scene: THREE.Scene, n: number) {
  if (boxHelper) {
    scene.remove(boxHelper)
    boxHelper.geometry.dispose()
    ;(boxHelper.material as THREE.Material).dispose()
  }
  const geometry = new THREE.BoxGeometry(n, n, n)
  const edges = new THREE.EdgesGeometry(geometry)
  boxHelper = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: props.isDark ? 0x888888 : 0x666666, transparent: true, opacity: 0.5 }),
  )
  boxHelper.position.set(n / 2, n / 2, n / 2)
  scene.add(boxHelper)
  geometry.dispose()
}

function buildGridLines(scene: THREE.Scene, n: number) {
  if (gridLines) {
    scene.remove(gridLines)
    gridLines.geometry.dispose()
    ;(gridLines.material as THREE.Material).dispose()
  }
  const positions: number[] = []
  // 6 个面，每个面 2*(N+1) 条线段
  for (let i = 0; i <= n; i++) {
    // -X 面 (x=0)
    positions.push(0, i, 0, 0, i, n)
    positions.push(0, 0, i, 0, n, i)
    // +X 面 (x=n)
    positions.push(n, i, 0, n, i, n)
    positions.push(n, 0, i, n, n, i)
    // -Y 面 (y=0)
    positions.push(0, 0, i, n, 0, i)
    positions.push(i, 0, 0, i, 0, n)
    // +Y 面 (y=n)
    positions.push(0, n, i, n, n, i)
    positions.push(i, n, 0, i, n, n)
    // -Z 面 (z=0)
    positions.push(0, i, 0, n, i, 0)
    positions.push(i, 0, 0, i, n, 0)
    // +Z 面 (z=n)
    positions.push(0, i, n, n, i, n)
    positions.push(i, 0, n, i, n, n)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  gridLines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color: props.isDark ? 0x666666 : 0xaaaaaa,
      transparent: true, opacity: 0.18, depthWrite: false,
    }),
  )
  scene.add(gridLines)
}

function buildAxes(scene: THREE.Scene, n: number) {
  if (axesGroup) { scene.remove(axesGroup); axesGroup = null }
  axesGroup = new THREE.Group()
  const len = n * 0.4
  axesGroup.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), len, 0xff0000))
  axesGroup.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), len, 0x00ff00))
  axesGroup.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), len, 0x0000ff))
  scene.add(axesGroup)
}

function buildIndicator(scene: THREE.Scene, n: number) {
  if (indicatorMesh) return
  const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1))
  indicatorMesh = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x5086a1 }),  // brand-1
  )
  indicatorMesh.visible = false
  scene.add(indicatorMesh)
}

/** 创建/更新交互面高亮面片（覆盖整个交互面） */
function buildFaceHighlight(scene: THREE.Scene, n: number) {
  if (faceHighlight) {
    scene.remove(faceHighlight)
    faceHighlight.geometry.dispose()
    ;(faceHighlight.material as THREE.Material).dispose()
  }
  const geometry = new THREE.PlaneGeometry(1, 1)
  const material = new THREE.MeshBasicMaterial({
    color: 0x5086a1,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,  // 始终渲染在最上层
  })
  faceHighlight = new THREE.Mesh(geometry, material)
  faceHighlight.visible = false
  faceHighlight.renderOrder = 999  // 高优先级
  scene.add(faceHighlight)
}

function updateFaceHighlight(focus: InteractionFocus, n: number) {
  if (!faceHighlight) return
  if (!focus.face || !focus.target) {
    faceHighlight.visible = false
    return
  }
  const f = focus.face
  let cx: number, cy: number, cz: number, scale: number

  if (focus.type === 'voxel' && focus.coord) {
    // 体素面：1×1 在 voxel 的某一侧边界上
    const v = focus.coord
    cx = (f.axis === 'x' ? v.x + f.sign : v.x + 0.5)
    cy = (f.axis === 'y' ? v.y + f.sign : v.y + 0.5)
    cz = (f.axis === 'z' ? v.z + f.sign : v.z + 0.5)
    scale = 1
  } else {
    // 空间面：N×N 在 0 或 N
    cx = (f.axis === 'x' ? f.position : n / 2)
    cy = (f.axis === 'y' ? f.position : n / 2)
    cz = (f.axis === 'z' ? f.position : n / 2)
    scale = n
  }

  faceHighlight.visible = true
  faceHighlight.position.set(cx, cy, cz)
  faceHighlight.scale.set(scale, scale, 1)

  // 用 quaternion 直接从 +Z 法线旋转到面法线，避免手算误差
  const NORMAL_Z = _tmpVec3a.set(0, 0, 1)
  _tmpVec3b.set(
    f.axis === 'x' ? f.sign : 0,
    f.axis === 'y' ? f.sign : 0,
    f.axis === 'z' ? f.sign : 0,
  )
  faceHighlight.quaternion.setFromUnitVectors(NORMAL_Z, _tmpVec3b)

  // 略向外偏移避免 z-fighting
  const eps = 0.01
  if (f.axis === 'x') faceHighlight.position.x += eps * f.sign
  else if (f.axis === 'y') faceHighlight.position.y += eps * f.sign
  else faceHighlight.position.z += eps * f.sign

  // 颜色
  const mat = faceHighlight.material as THREE.MeshBasicMaterial
  mat.color.setHex(focus.valid ? 0x5086a1 : 0xf44336)
  mat.opacity = focus.valid ? 0.35 : 0.40
}

// 复用的临时向量（必须在使用前声明）
const _tmpVec3a = new THREE.Vector3()
const _tmpVec3b = new THREE.Vector3()
const _NORMAL_Z = new THREE.Vector3(0, 0, 1)

// ============ 核心：计算交互焦点 ============

function computeInteractionFocus(): InteractionFocus {
  if (!ctx || !ctx.camera) {
    return { type: 'none', coord: null, target: null, face: null, valid: false }
  }
  const n = props.grid.n
  const rayO: Vec3 = {
    x: raycaster.ray.origin.x,
    y: raycaster.ray.origin.y,
    z: raycaster.ray.origin.z,
  }
  const rayD: Vec3 = {
    x: raycaster.ray.direction.x,
    y: raycaster.ray.direction.y,
    z: raycaster.ray.direction.z,
  }

  // === 阶段 1：射线穿过任何体素？===
  // 旧实现用 1×1 face planes 相交判定（太精细，鼠标稍微偏离就漏）
  // 新实现用 AABB（体素盒子）相交判定：只要 ray 穿过体素体积就算"鼠标在体素上"
  let cameraDir: Vec3 = { x: 0, y: 0, z: 0 }
  {
    const cx = ctx.camera.position.x - n / 2
    const cy = ctx.camera.position.y - n / 2
    const cz = ctx.camera.position.z - n / 2
    const cl = Math.sqrt(cx * cx + cy * cy + cz * cz)
    if (cl > 0) cameraDir = { x: cx / cl, y: cy / cl, z: cz / cl }
  }

  // Slab method: ray vs AABB [x, x+1]x[y, y+1]x[z, z+1]
  let bestVoxelHit: { t: number; voxel: Vec3 } | null = null
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (props.grid.data[props.grid.toIdx(x, y, z)] === 0) continue
        const invX = 1 / rayD.x
        const invY = 1 / rayD.y
        const invZ = 1 / rayD.z
        let tMin = -Infinity, tMax = Infinity
        if (Math.abs(rayD.x) > 1e-8) {
          const t1 = (x - rayO.x) * invX
          const t2 = (x + 1 - rayO.x) * invX
          tMin = Math.max(tMin, Math.min(t1, t2))
          tMax = Math.min(tMax, Math.max(t1, t2))
        } else if (rayO.x < x || rayO.x > x + 1) {
          continue
        }
        if (Math.abs(rayD.y) > 1e-8) {
          const t1 = (y - rayO.y) * invY
          const t2 = (y + 1 - rayO.y) * invY
          tMin = Math.max(tMin, Math.min(t1, t2))
          tMax = Math.min(tMax, Math.max(t1, t2))
        } else if (rayO.y < y || rayO.y > y + 1) {
          continue
        }
        if (Math.abs(rayD.z) > 1e-8) {
          const t1 = (z - rayO.z) * invZ
          const t2 = (z + 1 - rayO.z) * invZ
          tMin = Math.max(tMin, Math.min(t1, t2))
          tMax = Math.min(tMax, Math.max(t1, t2))
        } else if (rayO.z < z || rayO.z > z + 1) {
          continue
        }
        if (tMin > tMax || tMax < 0) continue
        const tEnter = Math.max(tMin, 0)
        if (!bestVoxelHit || tEnter < bestVoxelHit.t) {
          bestVoxelHit = { t: tEnter, voxel: { x, y, z } }
        }
      }
    }
  }

  if (bestVoxelHit) {
    const v = bestVoxelHit.voxel
    const face = getVoxelFace(v, cameraDir)
    const normal = faceNormal(face.axis, face.sign)
    const target: Vec3 = {
      x: v.x + normal.x,
      y: v.y + normal.y,
      z: v.z + normal.z,
    }
    const inBounds = props.grid.inBounds(target)
    const occupied = inBounds && props.grid.isOccupied(target)
    return {
      type: 'voxel',
      coord: v,
      target,
      face: { axis: face.axis, sign: face.sign, position: 0 },
      valid: inBounds && !occupied,
      reason: !inBounds ? 'out-of-bounds' : occupied ? 'occupied' : undefined,
    }
  }

  // === 阶段 2：空间边界面 → 遍历 6 面，鼠标在哪面就是哪面，重复时取远的 ===
  let bestT = -Infinity
  let bestResult: { face: Face; target: Vec3 } | null = null
  for (const face of getAllSpaceFaces(n)) {
    const hit = raycastPlane(rayO, rayD, face)
    if (!hit) continue
    if (hit.t < 0) continue
    if (!props.grid.inBounds(hit.target)) continue
    if (hit.t > bestT) {
      bestT = hit.t
      bestResult = { face, target: hit.target }
    }
  }
  if (bestResult) {
    const occupied = props.grid.isOccupied(bestResult.target)
    return {
      type: 'space',
      coord: null,
      target: bestResult.target,
      face: bestResult.face,
      valid: !occupied,
      reason: occupied ? 'occupied' : undefined,
    }
  }

  // === 阶段 3：无焦点 ===
  return { type: 'none', coord: null, target: null, face: null, valid: false }
}

// ============ 视觉更新 ============

function clearGhostAndHighlight() {
  if (ghostMeshIn) ghostMeshIn.count = 0
  if (ghostMeshOut) ghostMeshOut.count = 0
  if (faceHighlight) faceHighlight.visible = false
}

function updateGhostAndHighlight(focus: InteractionFocus) {
  if (!ctx) return
  const n = props.grid.n

  // 1) 更新交互面高亮
  updateFaceHighlight(focus, n)

  // 2) 无焦点 → 清空 ghost
  if (focus.type === 'none' || !focus.target) {
    clearGhostAndHighlight()
    return
  }

  // 3) 模板预览 vs 单体素
  if (props.template && props.template.id !== 'pixel') {
    const originAt = props.template.originAt
      ? props.template.originAt(props.templateParams)
      : { x: 0, y: 0, z: 0 }
    const local = props.template.build(props.templateParams)
    const dummy = new THREE.Object3D()
    const inColor = voxelColor(props.currentColor)
    const inBounds: Vec3[] = []
    const outOfBounds: Vec3[] = []
    for (const v of local) {
      const world: Vec3 = {
        x: focus.target.x - originAt.x + v.x,
        y: focus.target.y - originAt.y + v.y,
        z: focus.target.z - originAt.z + v.z,
      }
      if (props.grid.inBounds(world)) inBounds.push(world)
      else outOfBounds.push(world)
    }
    if (ghostMeshIn) {
      ghostMeshIn.count = inBounds.length
      inBounds.forEach((v, i) => {
        dummy.position.set(v.x + 0.5, v.y + 0.5, v.z + 0.5)
        dummy.updateMatrix()
        ghostMeshIn!.setMatrixAt(i, dummy.matrix)
        ghostMeshIn!.setColorAt(i, inColor)
      })
      if (ghostMeshIn.instanceColor) ghostMeshIn.instanceColor.needsUpdate = true
      ghostMeshIn.instanceMatrix.needsUpdate = true
    }
    if (ghostMeshOut) {
      ghostMeshOut.count = outOfBounds.length
      outOfBounds.forEach((v, i) => {
        dummy.position.set(v.x + 0.5, v.y + 0.5, v.z + 0.5)
        dummy.updateMatrix()
        ghostMeshOut!.setMatrixAt(i, dummy.matrix)
      })
      ghostMeshOut.instanceMatrix.needsUpdate = true
    }
  } else {
    // 单体素 ghost
    const dummy = new THREE.Object3D()
    if (ghostMeshIn) {
      ghostMeshIn.count = 1
      dummy.position.set(
        focus.target.x + 0.5,
        focus.target.y + 0.5,
        focus.target.z + 0.5,
      )
      dummy.updateMatrix()
      ghostMeshIn.setMatrixAt(0, dummy.matrix)
      ghostMeshIn.setColorAt(0, voxelColor(props.currentColor))
      if (ghostMeshIn.instanceColor) ghostMeshIn.instanceColor.needsUpdate = true
      ghostMeshIn.instanceMatrix.needsUpdate = true
    }
    if (ghostMeshOut) ghostMeshOut.count = 0
  }
}

// ============ 鼠标事件 ============

function getMouseNDC(e: MouseEvent): THREE.Vector2 {
  const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
  return new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  )
}

function handlePointerMove(e: PointerEvent) {
  if (!ctx || !canvasRef.value) return

  // LMB down 期间：检测是否已经超过点击阈值 → 标记为 drag（OrbitControls 接管旋转）
  if (lmbDown && lmbDown.isClick) {
    const dx = e.clientX - lmbDown.x
    const dy = e.clientY - lmbDown.y
    if (Math.abs(dx) > LMB_CLICK_PX || Math.abs(dy) > LMB_CLICK_PX) {
      lmbDown.isClick = false  // 进入拖动状态
    }
  }

  const ndc = getMouseNDC(e as any)
  mouse.copy(ndc)
  raycaster.setFromCamera(mouse, ctx.camera)

  // 重新计算焦点
  currentFocus = computeInteractionFocus()
  updateGhostAndHighlight(currentFocus)

  // hover info
  if (currentFocus.type !== 'none' && currentFocus.target) {
    const v = currentFocus.type === 'voxel' && currentFocus.coord
      ? props.grid.get(currentFocus.coord.x, currentFocus.coord.y, currentFocus.coord.z)
      : 0
    hoverInfoRef.value = {
      coord: currentFocus.target,
      color: v,
      type: currentFocus.type,
    }
    emit('hover', currentFocus.target)
  } else {
    hoverInfoRef.value = null
    emit('hover', null)
  }
}

function handlePointerDown(e: PointerEvent) {
  if (!ctx || !canvasRef.value) return

  // LMB：
  // - 无焦点 → OrbitControls 旋转（mouseButtons.LEFT = ROTATE）
  // - 有焦点 → 临时禁掉 OrbitControls 旋转（mouseButtons.LEFT = null），准备点击动作
  if (e.button === 0) {
    const ndc = getMouseNDC(e as any)
    mouse.copy(ndc)
    raycaster.setFromCamera(mouse, ctx.camera)
    const focus = computeInteractionFocus()
    currentFocus = focus

    if (focus.type === 'none') {
      // 无焦点 → OrbitControls 旋转；不设 lmbDown
      return
    }
    // 有焦点 → 临时禁旋转，准备点击
    if (ctx.controls) {
      ctx.controls.mouseButtons.LEFT = null as any
    }
    lmbDown = { x: e.clientX, y: e.clientY, time: Date.now(), isClick: true }
    return
  }
}

/** LMB 点击：基于当前 mode 触发动作（paint / fill / eyedrop / erase） */
function handleLmbClick(e: PointerEvent) {
  if (!ctx || !canvasRef.value) return
  const ndc = getMouseNDC(e as any)
  mouse.copy(ndc)
  raycaster.setFromCamera(mouse, ctx.camera)
  const focus = computeInteractionFocus()
  currentFocus = focus
  if (focus.type === 'none' || !focus.target) return

  if (props.mode === 'paint') {
    if (props.template && props.template.id !== 'pixel') {
      if (focus.valid) emit('place-template', focus.target)
    } else if (focus.valid) {
      emit('paint-at', focus.target)
    }
  } else if (props.mode === 'fill') {
    if (focus.type === 'voxel' && focus.coord) {
      emit('fill-at', focus.coord)
    } else if (focus.type === 'space') {
      emit('fill-at', focus.target)
    }
  } else if (props.mode === 'eyedrop') {
    if (focus.type === 'voxel' && focus.coord) {
      emit('eyedrop-at', focus.coord)
    } else if (focus.type === 'space' && focus.target) {
      emit('eyedrop-at', focus.target)
    }
  } else if (props.mode === 'erase') {
    if (focus.type === 'voxel' && focus.coord) {
      const v = props.grid.get(focus.coord.x, focus.coord.y, focus.coord.z)
      if (v !== 0) emit('erase-at', focus.coord)
    }
  }
}

function handlePointerUp(e: PointerEvent) {
  // LMB up：恢复 OrbitControls 旋转；检测是否为点击
  if (e.button === 0) {
    if (ctx?.controls) {
      ctx.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE
    }
    if (lmbDown) {
      const dt = Date.now() - lmbDown.time
      if (lmbDown.isClick && dt < LMB_CLICK_MS) {
        handleLmbClick(e)
      }
      lmbDown = null
    }
    return
  }

  if (isDragging) {
    isDragging = false
    dragMode = null
    dragPainted.clear()
  }
}

function handlePointerLeave() {
  if (!ctx) return
  currentFocus = { type: 'none', coord: null, target: null, face: null, valid: false }
  clearGhostAndHighlight()
  hoverInfoRef.value = null
  emit('hover', null)
  if (isDragging) {
    isDragging = false
    dragMode = null
    dragPainted.clear()
  }
  lmbDown = null
}

function getCursorForMode(mode: string): string {
  switch (mode) {
    case 'erase': return 'cell'
    case 'fill': return 'pointer'
    case 'eyedrop': return 'copy'
    default: return 'crosshair'
  }
}

function handleResize() {
  if (!ctx || !canvasRef.value) return
  const canvas = canvasRef.value
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  ctx.renderer.setSize(w, h, false)
  ctx.camera.aspect = w / h
  ctx.camera.updateProjectionMatrix()
}

// ============ 监听 props ============

watch(() => props.gridVersion, () => {
  if (ctx && faceMeshes[0]) {
    updateFaceMeshes(props.grid)
    updateInteriorWireframe(props.grid)
  }
})

watch(() => props.isDark, () => {
  if (ctx) ctx.scene.background = new THREE.Color(getBgColor())
  if (boxHelper) {
    ;(boxHelper.material as THREE.LineBasicMaterial).color.set(props.isDark ? 0x888888 : 0x666666)
  }
  if (gridLines) {
    ;(gridLines.material as THREE.LineBasicMaterial).color.set(props.isDark ? 0x666666 : 0xaaaaaa)
  }
})

watch(() => props.grid.n, () => {
  if (ctx) {
    buildFaceMeshes(ctx.scene, props.grid.n)
    buildInteriorWireframe(ctx.scene, props.grid.n)
    buildBoxHelper(ctx.scene, props.grid.n)
    buildGridLines(ctx.scene, props.grid.n)
    buildAxes(ctx.scene, props.grid.n)
    buildIndicator(ctx.scene, props.grid.n)
    buildFaceHighlight(ctx.scene, props.grid.n)
    updateFaceMeshes(props.grid)
    updateInteriorWireframe(props.grid)
  }
})

watch(() => props.mode, () => {
  if (canvasRef.value && !isPanning) {
    canvasRef.value.style.cursor = getCursorForMode(props.mode)
  }
})

// ============ 生命周期 ============

let lastFpsTime = 0
let frameCount = 0

function animate() {
  if (!ctx) return
  requestAnimationFrame(animate)
  ctx.controls.update()
  ctx.renderer.render(ctx.scene, ctx.camera)
  frameCount++
  const now = performance.now()
  if (now - lastFpsTime > 1000) {
    fpsRef.value = frameCount
    frameCount = 0
    lastFpsTime = now
  }
}

onMounted(async () => {
  if (!canvasRef.value) return
  ctx = await createThreeScene(canvasRef.value, props.grid.n)
  buildFaceMeshes(ctx.scene, props.grid.n)
  buildInteriorWireframe(ctx.scene, props.grid.n)
  buildBoxHelper(ctx.scene, props.grid.n)
  buildGridLines(ctx.scene, props.grid.n)
  buildAxes(ctx.scene, props.grid.n)
  buildIndicator(ctx.scene, props.grid.n)
  buildFaceHighlight(ctx.scene, props.grid.n)
  updateFaceMeshes(props.grid)
  updateInteriorWireframe(props.grid)

  const canvas = canvasRef.value
  canvas.style.cursor = getCursorForMode(props.mode)
  canvas.addEventListener('pointermove', handlePointerMove)
  canvas.addEventListener('pointerdown', handlePointerDown)
  canvas.addEventListener('pointerup', handlePointerUp)
  canvas.addEventListener('pointerleave', handlePointerLeave)
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  canvas.addEventListener('wheel', (e) => { e.stopPropagation() }, { passive: true })
  window.addEventListener('resize', handleResize)

  animate()
})

onBeforeUnmount(() => {
  if (!ctx || !canvasRef.value) return
  const canvas = canvasRef.value
  canvas.removeEventListener('pointermove', handlePointerMove)
  canvas.removeEventListener('pointerdown', handlePointerDown)
  canvas.removeEventListener('pointerup', handlePointerUp)
  canvas.removeEventListener('pointerleave', handlePointerLeave)
  window.removeEventListener('resize', handleResize)
  ctx.dispose()
})
</script>

<template>
  <div class="grid-view-container">
    <canvas ref="canvasRef" class="grid-canvas"></canvas>
    <div class="hover-info" v-if="hoverInfoRef">
      <span class="hover-type">{{ hoverInfoRef.type === 'voxel' ? 'V' : hoverInfoRef.type === 'space' ? 'S' : '?' }}</span>
      <span>({{ hoverInfoRef.coord.x }}, {{ hoverInfoRef.coord.y }}, {{ hoverInfoRef.coord.z }})</span>
      <span v-if="hoverInfoRef.color !== 0" class="hover-color-swatch" :style="{ background: '#' + voxelToHex(hoverInfoRef.color).toString(16).padStart(6, '0') }"></span>
    </div>
    <div v-if="isPanning" class="panning-hint">平移中…</div>
  </div>
</template>

<style scoped>
.grid-view-container {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--vp-c-bg-alt);
  overflow: hidden;
  overscroll-behavior: contain;
}
.grid-canvas {
  display: block;
  width: 100%;
  height: 100%;
  outline: none;
  touch-action: none;
}
.hover-info {
  position: absolute;
  top: 8px;
  left: 8px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-family: monospace;
  display: flex;
  gap: 6px;
  align-items: center;
}
.hover-type {
  background: rgba(255, 255, 255, 0.2);
  padding: 0 4px;
  border-radius: 3px;
  font-weight: bold;
}
.hover-color-swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  border: 1px solid rgba(255, 255, 255, 0.5);
}
.panning-hint {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
}
</style>