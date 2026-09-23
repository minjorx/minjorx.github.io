<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as THREE from 'three'
import type { VoxelGrid, Vec3 } from './lib/voxel-grid'
import { voxelToHex } from './lib/color-quantize'
import { createThreeScene, type ThreeContext } from './lib/three-setup'
import type { SnapMode } from './lib/snap'
import { mirrorCoord } from './lib/symmetry'
import type { Template } from './lib/templates'

const props = defineProps<{
  grid: VoxelGrid
  currentColor: number
  template: Template | null
  templateParams: Record<string, number>
  snapMode: SnapMode
  symmetry: 'off' | 'x' | 'y' | 'z'
  mode: 'paint' | 'erase' | 'fill' | 'eyedrop' | 'replace'
  isDark: boolean
}>()

const emit = defineEmits<{
  (e: 'paint-at', coord: Vec3): void
  (e: 'erase-at', coord: Vec3): void
  (e: 'fill-at', coord: Vec3): void
  (e: 'eyedrop-at', coord: Vec3): void
  (e: 'hover', coord: Vec3 | null): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const fpsRef = ref(0)
const hoverInfoRef = ref<{ coord: Vec3; color: number } | null>(null)

let ctx: ThreeContext | null = null
let instancedMesh: THREE.InstancedMesh | null = null
let ghostMeshIn: THREE.InstancedMesh | null = null
let ghostMeshOut: THREE.InstancedMesh | null = null
let indicatorMesh: THREE.LineSegments | null = null
let boxHelper: THREE.LineSegments | null = null
let axesGroup: THREE.Group | null = null
let isDragging = false
let dragMode: 'paint' | 'erase' | null = null
const dragPainted = new Set<number>()
let threeN = 0

const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

// 主题相关
function getBgColor() {
  return props.isDark ? 0x1a1a1a : 0xf0f0f0
}

function voxelColor(v: number): THREE.Color {
  const hex = voxelToHex(v)
  return new THREE.Color((hex >> 16) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255)
}

function buildInstancedMesh(scene: THREE.Scene, n: number) {
  // 清理旧
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

  // 主网格
  const material = new THREE.MeshLambertMaterial({ vertexColors: false })
  instancedMesh = new THREE.InstancedMesh(geometry, material, n * n * n)
  instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  instancedMesh.count = 0
  scene.add(instancedMesh)

  // In-bounds ghost
  const ghostInMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  })
  ghostMeshIn = new THREE.InstancedMesh(geometry.clone(), ghostInMat, 4096)
  ghostMeshIn.count = 0
  scene.add(ghostMeshIn)

  // Out-of-bounds ghost（黄色警告）
  const ghostOutMat = new THREE.MeshBasicMaterial({
    color: 0xff9800,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  })
  ghostMeshOut = new THREE.InstancedMesh(geometry.clone(), ghostOutMat, 4096)
  ghostMeshOut.count = 0
  scene.add(ghostMeshOut)
}

function updateInstancedFromGrid(grid: VoxelGrid) {
  if (!instancedMesh) return
  const n = grid.n
  const dummy = new THREE.Object3D()
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

function buildAxes(scene: THREE.Scene, n: number) {
  if (axesGroup) {
    scene.remove(axesGroup)
    axesGroup = null
  }
  axesGroup = new THREE.Group()
  const len = n * 0.4
  // X 红
  axesGroup.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), len, 0xff0000))
  // Y 绿
  axesGroup.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), len, 0x00ff00))
  // Z 蓝
  axesGroup.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), len, 0x0000ff))
  scene.add(axesGroup)
}

function buildIndicator(scene: THREE.Scene, n: number) {
  if (indicatorMesh) return
  const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.96, 0.96, 0.96))
  indicatorMesh = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x4caf50 }),
  )
  indicatorMesh.visible = false
  scene.add(indicatorMesh)
}

function snapFromRay(raycaster: THREE.Raycaster, grid: VoxelGrid): { coord: Vec3; source: string; valid: boolean } | null {
  const n = grid.n

  // 阶段 1: 体素面吸附
  if (props.snapMode === 'voxel-face' && instancedMesh) {
    const hits = raycaster.intersectObject(instancedMesh, false)
    if (hits.length > 0) {
      const hit = hits[0]
      const localNormal = hit.face?.normal
      if (localNormal) {
        const instId = hit.instanceId ?? 0
        // 找到 instanceId 对应的体素
        // 由于我们按 idx 顺序压入，instanceId 即对应的"第 idx 个非空格"
        // 但 ghost 也算 instance → 这里我们只取"非 ghost"的——instancedMesh 本身有效
        // 简化：直接遍历网格找 hit.point 最近的已放体素
        const point = hit.point
        const cx = Math.floor(point.x)
        const cy = Math.floor(point.y)
        const cz = Math.floor(point.z)
        // 用法线方向决定邻居
        const dirX = Math.round(localNormal.x)
        const dirY = Math.round(localNormal.y)
        const dirZ = Math.round(localNormal.z)
        const target = { x: cx + dirX, y: cy + dirY, z: cz + dirZ }
        if (grid.inBounds(target)) {
          return { coord: target, source: 'voxel-face', valid: !grid.isOccupied(target) }
        }
      }
    }
  }

  // 阶段 2: 地面
  if (props.snapMode !== 'free') {
    const groundY = 0
    const dir = raycaster.ray.direction
    const orig = raycaster.ray.origin
    if (Math.abs(dir.y) > 1e-6) {
      const t = (groundY - orig.y) / dir.y
      if (t > 0) {
        const hx = orig.x + dir.x * t
        const hz = orig.z + dir.z * t
        const coord = { x: Math.floor(hx), y: 0, z: Math.floor(hz) }
        if (grid.inBounds(coord)) {
          return { coord, source: 'ground', valid: !grid.isOccupied(coord) }
        }
      }
    }
  }

  // 阶段 3: 自由
  const dir = raycaster.ray.direction
  const orig = raycaster.ray.origin
  const centerY = n / 2
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

/** 取得模板预览（in-bounds / out-of-bounds 拆分） */
function getTemplatePreview(grid: VoxelGrid, template: Template, params: Record<string, number>, anchor: Vec3) {
  const local = template.build(params)
  const inBounds: Vec3[] = []
  const outOfBounds: Vec3[] = []
  for (const v of local) {
    const world = { x: anchor.x + v.x, y: anchor.y + v.y, z: anchor.z + v.z }
    if (grid.inBounds(world)) inBounds.push(world)
    else outOfBounds.push(world)
  }
  return { inBounds, outOfBounds, truncated: outOfBounds.length > 0 }
}

function updateGhostAndIndicator(snapResult: { coord: Vec3; source: string; valid: boolean } | null) {
  if (!ctx || !ghostMeshIn || !ghostMeshOut || !indicatorMesh) return

  // 模板预览
  if (snapResult && props.template && props.template.id !== 'pixel') {
    const preview = getTemplatePreview(props.grid, props.template, props.templateParams, snapResult.coord)
    const dummy = new THREE.Object3D()
    const inColor = voxelColor(props.currentColor)
    ghostMeshIn.count = preview.inBounds.length
    preview.inBounds.forEach((v, i) => {
      dummy.position.set(v.x + 0.5, v.y + 0.5, v.z + 0.5)
      dummy.updateMatrix()
      ghostMeshIn!.setMatrixAt(i, dummy.matrix)
      ghostMeshIn!.setColorAt(i, inColor)
    })
    if (ghostMeshIn.instanceColor) ghostMeshIn.instanceColor.needsUpdate = true
    ghostMeshIn.instanceMatrix.needsUpdate = true

    ghostMeshOut.count = preview.outOfBounds.length
    preview.outOfBounds.forEach((v, i) => {
      dummy.position.set(v.x + 0.5, v.y + 0.5, v.z + 0.5)
      dummy.updateMatrix()
      ghostMeshOut!.setMatrixAt(i, dummy.matrix)
    })
    ghostMeshOut.instanceMatrix.needsUpdate = true

    indicatorMesh.position.set(snapResult.coord.x + 0.5, snapResult.coord.y + 0.5, snapResult.coord.z + 0.5)
    indicatorMesh.visible = !snapResult.valid  // 占用时变红
    ;(indicatorMesh.material as THREE.LineBasicMaterial).color.set(snapResult.valid ? 0xff9800 : 0xf44336)
  } else if (snapResult) {
    // 单体素 ghost
    const dummy = new THREE.Object3D()
    ghostMeshIn.count = 1
    dummy.position.set(snapResult.coord.x + 0.5, snapResult.coord.y + 0.5, snapResult.coord.z + 0.5)
    dummy.updateMatrix()
    ghostMeshIn.setMatrixAt(0, dummy.matrix)
    ghostMeshIn.setColorAt(0, voxelColor(props.currentColor))
    if (ghostMeshIn.instanceColor) ghostMeshIn.instanceColor.needsUpdate = true
    ghostMeshIn.instanceMatrix.needsUpdate = true

    ghostMeshOut.count = 0

    // 指示器
    indicatorMesh.position.set(snapResult.coord.x + 0.5, snapResult.coord.y + 0.5, snapResult.coord.z + 0.5)
    indicatorMesh.visible = true
    ;(indicatorMesh.material as THREE.LineBasicMaterial).color.set(snapResult.valid ? 0x4caf50 : 0xf44336)
  } else {
    ghostMeshIn.count = 0
    ghostMeshOut.count = 0
    indicatorMesh.visible = false
  }
}

function getMouseNDC(e: MouseEvent): THREE.Vector2 {
  const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
  return new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  )
}

let snapResult: { coord: Vec3; source: string; valid: boolean } | null = null

function handlePointerMove(e: PointerEvent) {
  if (!ctx || !canvasRef.value) return
  mouse.set(...getMouseNDC(e as any))
  raycaster.setFromCamera(mouse, ctx.camera)
  snapResult = snapFromRay(raycaster, props.grid)
  updateGhostAndIndicator(snapResult)

  if (snapResult) {
    const v = props.grid.get(snapResult.coord.x, snapResult.coord.y, snapResult.coord.z)
    hoverInfoRef.value = { coord: snapResult.coord, color: v }
    emit('hover', snapResult.coord)
  } else {
    hoverInfoRef.value = null
    emit('hover', null)
  }

  // 拖动涂色
  if (isDragging && dragMode && snapResult && snapResult.valid) {
    const coord = snapResult.coord
    const idx = props.grid.toIdx(coord.x, coord.y, coord.z)
    if (!dragPainted.has(idx)) {
      dragPainted.add(idx)
      if (dragMode === 'paint') emit('paint-at', coord)
      else emit('erase-at', coord)
    }
  }
}

function handlePointerDown(e: PointerEvent) {
  if (!ctx || !canvasRef.value) return
  // 鼠标右键或中键 → OrbitControls 处理
  if (e.button !== 0) return
  mouse.set(...getMouseNDC(e as any))
  raycaster.setFromCamera(mouse, ctx.camera)
  const r = snapFromRay(raycaster, props.grid)
  if (!r) return

  if (props.mode === 'paint') {
    isDragging = true
    dragMode = 'paint'
    dragPainted.clear()
    if (r.valid) {
      dragPainted.add(props.grid.toIdx(r.coord.x, r.coord.y, r.coord.z))
      emit('paint-at', r.coord)
    }
  } else if (props.mode === 'erase') {
    isDragging = true
    dragMode = 'erase'
    dragPainted.clear()
    if (props.grid.get(r.coord.x, r.coord.y, r.coord.z) !== 0) {
      dragPainted.add(props.grid.toIdx(r.coord.x, r.coord.y, r.coord.z))
      emit('erase-at', r.coord)
    }
  } else if (props.mode === 'fill') {
    if (r.valid) emit('fill-at', r.coord)
  } else if (props.mode === 'eyedrop') {
    if (props.grid.get(r.coord.x, r.coord.y, r.coord.z) !== 0) {
      emit('eyedrop-at', r.coord)
    }
  }
}

function handlePointerUp() {
  isDragging = false
  dragMode = null
  dragPainted.clear()
}

function handlePointerLeave() {
  if (!ctx) return
  snapResult = null
  updateGhostAndIndicator(null)
  hoverInfoRef.value = null
  emit('hover', null)
  if (isDragging) {
    isDragging = false
    dragMode = null
    dragPainted.clear()
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

// 监听外部传入的 grid 变化
watch(() => props.grid, () => {
  if (ctx && instancedMesh) {
    updateInstancedFromGrid(props.grid)
  }
}, { deep: true })

watch(() => props.isDark, () => {
  if (ctx) {
    ctx.scene.background = new THREE.Color(getBgColor())
  }
  if (boxHelper) {
    ;(boxHelper.material as THREE.LineBasicMaterial).color.set(props.isDark ? 0x888888 : 0x666666)
  }
})

watch(() => props.grid.n, () => {
  if (ctx) {
    buildInstancedMesh(ctx.scene, props.grid.n)
    buildBoxHelper(ctx.scene, props.grid.n)
    buildAxes(ctx.scene, props.grid.n)
    buildIndicator(ctx.scene, props.grid.n)
    threeN = props.grid.n
    updateInstancedFromGrid(props.grid)
  }
})

let lastFpsTime = 0
let frameCount = 0

function animate() {
  if (!ctx) return
  requestAnimationFrame(animate)
  ctx.controls.update()
  ctx.renderer.render(ctx.scene, ctx.camera)

  // FPS
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
  buildAxes(ctx.scene, props.grid.n)
  buildIndicator(ctx.scene, props.grid.n)
  updateInstancedFromGrid(props.grid)

  const canvas = canvasRef.value
  canvas.addEventListener('pointermove', handlePointerMove)
  canvas.addEventListener('pointerdown', handlePointerDown)
  canvas.addEventListener('pointerup', handlePointerUp)
  canvas.addEventListener('pointerleave', handlePointerLeave)
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
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

defineExpose({
  getSnapResult: () => snapResult,
  getFps: () => fpsRef.value,
  getHoverInfo: () => hoverInfoRef.value,
})
</script>

<template>
  <div class="grid-view-container">
    <canvas ref="canvasRef" class="grid-canvas"></canvas>
    <div class="hover-info" v-if="hoverInfoRef">
      <span>({{ hoverInfoRef.coord.x }}, {{ hoverInfoRef.coord.y }}, {{ hoverInfoRef.coord.z }})</span>
      <span v-if="hoverInfoRef.color !== 0" class="hover-color-swatch" :style="{ background: '#' + voxelToHex(hoverInfoRef.color).toString(16).padStart(6, '0') }"></span>
    </div>
  </div>
</template>

<style scoped>
.grid-view-container {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--vp-c-bg-alt);
  overflow: hidden;
}
.grid-canvas {
  display: block;
  width: 100%;
  height: 100%;
  outline: none;
  cursor: crosshair;
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
.hover-color-swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  border: 1px solid rgba(255, 255, 255, 0.5);
}
</style>