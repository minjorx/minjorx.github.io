<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as THREE from 'three'
import type { VoxelGrid, Vec3 } from './lib/voxel-grid'
import { voxelToHex } from './lib/color-quantize'
import { createThreeScene, type ThreeContext } from './lib/three-setup'
import { mirrorCoord } from './lib/symmetry'
import type { Template } from './lib/templates'
import {
  getVoxelFace, getSpaceFace, raycastSpaceFace, raycastPlane,
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
let instancedMesh: THREE.InstancedMesh | null = null
let ghostMeshIn: THREE.InstancedMesh | null = null
let ghostMeshOut: THREE.InstancedMesh | null = null
let indicatorMesh: THREE.LineSegments | null = null
let boxHelper: THREE.LineSegments | null = null
let gridLines: THREE.LineSegments | null = null
let axesGroup: THREE.Group | null = null
let faceHighlight: THREE.Mesh | null = null
let threeN = 0

// instanceId → 体素坐标 的映射（每次重建 InstancedMesh 时同步更新）
let instanceIdToCoord: Vec3[] = []

const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

// 拖动状态
let isDragging = false
let dragMode: 'paint' | 'erase' | null = null
const dragPainted = new Set<number>()
// 拖动 paint 用的固定平面（由起始 focus 的 face 计算出）
let dragPlane: { axis: 'x'|'y'|'z'; sign: -1|1; position: number } | null = null

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

function buildInstancedMesh(scene: THREE.Scene, n: number) {
  if (instancedMesh) {
    scene.remove(instancedMesh)
    instancedMesh.geometry.dispose()
    ;(instancedMesh.material as THREE.Material).dispose()
    instancedMesh = null
  }
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

  const geometry = new THREE.BoxGeometry(0.96, 0.96, 0.96)
  const material = new THREE.MeshLambertMaterial({ vertexColors: false })
  instancedMesh = new THREE.InstancedMesh(geometry, material, n * n * n)
  instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  instancedMesh.count = 0
  scene.add(instancedMesh)

  const ghostInMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false,
  })
  ghostMeshIn = new THREE.InstancedMesh(geometry.clone(), ghostInMat, 4096)
  ghostMeshIn.count = 0
  scene.add(ghostMeshIn)

  const ghostOutMat = new THREE.MeshBasicMaterial({
    color: 0xff9800, transparent: true, opacity: 0.3, depthWrite: false,
  })
  ghostMeshOut = new THREE.InstancedMesh(geometry.clone(), ghostOutMat, 4096)
  ghostMeshOut.count = 0
  scene.add(ghostMeshOut)
}

function updateInstancedFromGrid(grid: VoxelGrid) {
  if (!instancedMesh) return
  const n = grid.n
  const dummy = new THREE.Object3D()
  instanceIdToCoord = []
  let idx = 0
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = grid.data[grid.toIdx(x, y, z)]
        if (v === 0) continue
        dummy.position.set(x + 0.5, y + 0.5, z + 0.5)
        dummy.updateMatrix()
        instancedMesh.setMatrixAt(idx, dummy.matrix)
        instancedMesh.setColorAt(idx, voxelColor(v))
        instanceIdToCoord[idx] = { x, y, z }
        idx++
      }
    }
  }
  instancedMesh.count = idx
  instancedMesh.instanceMatrix.needsUpdate = true
  if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true
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
  for (let i = 0; i <= n; i++) {
    positions.push(0, 0, i, n, 0, i)
    positions.push(0, i, 0, n, i, 0)
    positions.push(0, i, 0, 0, i, n)
    positions.push(0, 0, i, 0, n, i)
    positions.push(i, 0, 0, i, n, 0)
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
  const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.96, 0.96, 0.96))
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
  // 单个 PlaneGeometry 复用，按 face 旋转/平移
  const geometry = new THREE.PlaneGeometry(n, n)
  const material = new THREE.MeshBasicMaterial({
    color: 0x5086a1,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  faceHighlight = new THREE.Mesh(geometry, material)
  faceHighlight.visible = false
  scene.add(faceHighlight)
}

function updateFaceHighlight(focus: InteractionFocus, n: number) {
  if (!faceHighlight) return
  if (!focus.face || !focus.target) {
    faceHighlight.visible = false
    return
  }
  // 把 PlaneGeometry 默认在 XY 平面上（normal=+Z）
  // 我们要把它转到目标轴上
  const f = focus.face
  faceHighlight.visible = true
  faceHighlight.rotation.set(0, 0, 0)
  faceHighlight.scale.set(1, 1, 1)

  // 设置旋转 + 位置，使面片覆盖在 [0,n]×[0,n] 的目标面上
  const offset = 0.01  // 略向外偏移，避免 z-fighting
  if (f.axis === 'x') {
    // 面 = YZ 平面，绕 Y 旋转 90°
    faceHighlight.rotation.y = f.sign > 0 ? Math.PI / 2 : -Math.PI / 2
    faceHighlight.position.set(f.position + offset * f.sign, n / 2, n / 2)
  } else if (f.axis === 'y') {
    // 面 = XZ 平面，绕 X 旋转 90°
    faceHighlight.rotation.x = f.sign > 0 ? -Math.PI / 2 : Math.PI / 2
    faceHighlight.position.set(n / 2, f.position + offset * f.sign, n / 2)
  } else {
    // 面 = XY 平面，绕 Y 旋转 0 或 180°
    faceHighlight.rotation.y = f.sign > 0 ? 0 : Math.PI
    faceHighlight.position.set(n / 2, n / 2, f.position + offset * f.sign)
  }

  // 颜色：valid 用主色，invalid 用红
  const mat = faceHighlight.material as THREE.MeshBasicMaterial
  mat.color.setHex(focus.valid ? 0x5086a1 : 0xf44336)
  mat.opacity = focus.valid ? 0.18 : 0.22
}

// ============ 核心：计算交互焦点 ============

function computeInteractionFocus(): InteractionFocus {
  if (!ctx || !ctx.camera) {
    return { type: 'none', coord: null, target: null, face: null, valid: false }
  }
  const n = props.grid.n
  const cameraPos: Vec3 = {
    x: ctx.camera.position.x,
    y: ctx.camera.position.y,
    z: ctx.camera.position.z,
  }
  const center: Vec3 = { x: n / 2, y: n / 2, z: n / 2 }
  const dx = cameraPos.x - center.x
  const dy = cameraPos.y - center.y
  const dz = cameraPos.z - center.z
  const l = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (l === 0) {
    return { type: 'none', coord: null, target: null, face: null, valid: false }
  }
  const cameraDir: Vec3 = { x: dx / l, y: dy / l, z: dz / l }

  // 阶段 1：射线命中已放体素
  if (instancedMesh && instancedMesh.count > 0) {
    const hits = raycaster.intersectObject(instancedMesh, false)
    if (hits.length > 0) {
      const hit = hits[0]
      const id = hit.instanceId ?? 0
      const voxel = instanceIdToCoord[id]
      if (voxel) {
        const face = getVoxelFace(voxel, cameraDir)
        const normal = faceNormal(face.axis, face.sign)
        const target: Vec3 = {
          x: voxel.x + normal.x,
          y: voxel.y + normal.y,
          z: voxel.z + normal.z,
        }
        const inBounds = props.grid.inBounds(target)
        const occupied = inBounds && props.grid.isOccupied(target)
        return {
          type: 'voxel',
          coord: voxel,
          target,
          face,
          valid: inBounds && !occupied,
          reason: !inBounds ? 'out-of-bounds' : occupied ? 'occupied' : undefined,
        }
      }
    }
  }

  // 阶段 2：空间边界面（取远离摄像机的）
  const spaceFace = getSpaceFace(n, cameraDir)
  const spaceFaceWithPos: Face = { ...spaceFace, position: spaceFace.sign > 0 ? n : 0 }
  const rayO: Vec3 = { x: raycaster.ray.origin.x, y: raycaster.ray.origin.y, z: raycaster.ray.origin.z }
  const rayD: Vec3 = { x: raycaster.ray.direction.x, y: raycaster.ray.direction.y, z: raycaster.ray.direction.z }
  const target = raycastSpaceFace(rayO, rayD, spaceFaceWithPos)
  if (target && props.grid.inBounds(target)) {
    const occupied = props.grid.isOccupied(target)
    return {
      type: 'space',
      coord: null,
      target,
      face: spaceFaceWithPos,
      valid: !occupied,
      reason: occupied ? 'occupied' : undefined,
    }
  }

  // 阶段 3：无焦点
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

/** 计算拖动用的固定平面（由起始 focus 决定） */
function computeDragPlane(focus: InteractionFocus): { axis: 'x'|'y'|'z'; sign: -1|1; position: number } | null {
  if (!focus.face) return null
  const f = focus.face
  if (focus.type === 'voxel' && focus.coord) {
    // voxel 面：平面位置 = 体素坐标 + 1（在面法线方向）
    let pos = 0
    if (f.axis === 'x') pos = focus.coord.x + f.sign
    else if (f.axis === 'y') pos = focus.coord.y + f.sign
    else pos = focus.coord.z + f.sign
    return { axis: f.axis, sign: f.sign, position: pos }
  }
  // space 面：position 直接是 0 或 N
  return { axis: f.axis, sign: f.sign, position: f.position }
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

  // 处理平移
  if (isPanning && panStart && ctx.controls) {
    const dx = e.clientX - panStart.x
    const dy = e.clientY - panStart.y
    const distance = ctx.camera.position.distanceTo(new THREE.Vector3(
      panStart.target.x, panStart.target.y, panStart.target.z
    ))
    const panSpeed = distance * 0.002
    // 摄像机 right/up 向量
    const right = new THREE.Vector3()
    const up = new THREE.Vector3()
    const fwd = new THREE.Vector3()
    ctx.camera.matrixWorld.extractBasis(right, up, fwd)
    right.multiplyScalar(-dx * panSpeed)
    up.multiplyScalar(dy * panSpeed)
    ctx.camera.position.add(right).add(up)
    ctx.controls.target.add(right).add(up)
    ctx.controls.update()
    return
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

  // 拖动涂/擦
  if (isDragging && dragMode === 'paint' && dragPlane) {
    // 沿起始固定平面绘制鼠标投影 → 连续不空洞
    const planeTarget = raycastPlane(
      { x: raycaster.ray.origin.x, y: raycaster.ray.origin.y, z: raycaster.ray.origin.z },
      { x: raycaster.ray.direction.x, y: raycaster.ray.direction.y, z: raycaster.ray.direction.z },
      dragPlane,
    )
    if (!planeTarget) return
    if (!props.grid.inBounds(planeTarget)) return
    if (props.grid.get(planeTarget.x, planeTarget.y, planeTarget.z) !== 0) return
    const idx = props.grid.toIdx(planeTarget.x, planeTarget.y, planeTarget.z)
    if (!dragPainted.has(idx)) {
      dragPainted.add(idx)
      emit('paint-at', planeTarget)
    }
  } else if (isDragging && dragMode === 'erase') {
    // 拖动擦除跟随 focus：鼠标当前命中体素就擦
    if (currentFocus.type !== 'voxel' || !currentFocus.coord) return
    const coord = currentFocus.coord
    if (props.grid.get(coord.x, coord.y, coord.z) === 0) return
    const idx = props.grid.toIdx(coord.x, coord.y, coord.z)
    if (!dragPainted.has(idx)) {
      dragPainted.add(idx)
      emit('erase-at', coord)
    }
  }
}

function handlePointerDown(e: PointerEvent) {
  if (!ctx || !canvasRef.value) return
  if (e.button !== 0 && e.button !== 2) return

  const ndc = getMouseNDC(e as any)
  mouse.copy(ndc)
  raycaster.setFromCamera(mouse, ctx.camera)
  const focus = computeInteractionFocus()
  currentFocus = focus

  // 无焦点 → 平移画面
  if (focus.type === 'none') {
    if (e.button === 0 && ctx.controls) {
      isPanning = true
      panStart = {
        x: e.clientX,
        y: e.clientY,
        target: {
          x: ctx.controls.target.x,
          y: ctx.controls.target.y,
          z: ctx.controls.target.z,
        },
        position: {
          x: ctx.camera.position.x,
          y: ctx.camera.position.y,
          z: ctx.camera.position.z,
        },
      }
      canvasRef.value.style.cursor = 'grabbing'
    }
    return
  }

  // 左键：根据 mode 处理
  if (e.button === 0) {
    if (!focus.target) return

    if (props.mode === 'paint') {
      if (props.template && props.template.id !== 'pixel') {
        if (focus.valid) emit('place-template', focus.target)
        return
      }
      if (focus.valid && focus.face) {
        isDragging = true
        dragMode = 'paint'
        // 计算固定平面：起始 focus 的 face 的位置平面
        dragPlane = computeDragPlane(focus)
        dragPainted.clear()
        const target = focus.target
        dragPainted.add(props.grid.toIdx(target.x, target.y, target.z))
        emit('paint-at', target)
      }
    } else if (props.mode === 'fill') {
      if (focus.type === 'voxel' && focus.coord && focus.valid) {
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
    }
  }
  // 右键：擦除
  else if (e.button === 2) {
    if (focus.type === 'voxel' && focus.coord) {
      isDragging = true
      dragMode = 'erase'
      dragPainted.clear()
      const idx = props.grid.toIdx(focus.coord.x, focus.coord.y, focus.coord.z)
      dragPainted.add(idx)
      emit('erase-at', focus.coord)
    }
    // 空间焦点 + 右键 → 无操作（已经按设计）
  }
}

function handlePointerUp() {
  if (isDragging) {
    isDragging = false
    dragMode = null
    dragPainted.clear()
    dragPlane = null
  }
  if (isPanning) {
    isPanning = false
    panStart = null
    if (canvasRef.value) {
      const mode = currentFocus.type === 'none' ? 'paint' : props.mode
      canvasRef.value.style.cursor = getCursorForMode(mode)
    }
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
    dragPlane = null
  }
  if (isPanning) {
    isPanning = false
    panStart = null
  }
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
  if (ctx && instancedMesh) {
    updateInstancedFromGrid(props.grid)
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
    buildInstancedMesh(ctx.scene, props.grid.n)
    buildBoxHelper(ctx.scene, props.grid.n)
    buildGridLines(ctx.scene, props.grid.n)
    buildAxes(ctx.scene, props.grid.n)
    buildIndicator(ctx.scene, props.grid.n)
    buildFaceHighlight(ctx.scene, props.grid.n)
    threeN = props.grid.n
    updateInstancedFromGrid(props.grid)
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
  threeN = props.grid.n
  ctx = await createThreeScene(canvasRef.value, props.grid.n)
  buildInstancedMesh(ctx.scene, props.grid.n)
  buildBoxHelper(ctx.scene, props.grid.n)
  buildGridLines(ctx.scene, props.grid.n)
  buildAxes(ctx.scene, props.grid.n)
  buildIndicator(ctx.scene, props.grid.n)
  buildFaceHighlight(ctx.scene, props.grid.n)
  updateInstancedFromGrid(props.grid)

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