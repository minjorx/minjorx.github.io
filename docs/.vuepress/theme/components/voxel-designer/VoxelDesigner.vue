<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import GridView from './GridView.vue'
import ColorPalette from './ColorPalette.vue'
import ModelTemplates from './ModelTemplates.vue'
import Toast from './Toast.vue'
import Modal from './Modal.vue'
import { VoxelGrid, type Vec3, type NValue } from './lib/voxel-grid'
import { UndoStack, makePaintOp, type Patch } from './lib/undo-stack'
import { TEMPLATES, type Template } from './lib/templates'
import { DEFAULT_PALETTE_VALUE, PRESET_PALETTE } from './lib/preset-palette'
import { savePrefabs, loadPrefabs } from './lib/storage'
import { mirrorAllPatches, mirrorCoord } from './lib/symmetry'
import { floodFill, replaceColor } from './lib/snap'
import { exportAsPrefab, importPrefabFromFile, downloadPrefab, downloadProject } from './lib/prefab'
import { saveCurrent, loadCurrent, exportProject } from './lib/storage'
import type { SnapMode } from './lib/snap'
import type { SymmetryAxis } from './lib/symmetry'
import type { PrefabFile } from './lib/prefab'

// ---------- 状态 ----------
const grid = ref<VoxelGrid>(new VoxelGrid(32))
const gridVersion = ref(0)  // 每次数据变更 +1，用于触发响应
const undoStack = new UndoStack()
const undoState = reactive({ canUndo: false, canRedo: false })
const currentColor = ref(DEFAULT_PALETTE_VALUE)
const currentTemplate = ref<Template | null>(null)
const templateParams = reactive<Record<string, number>>({})
const snapMode = ref<SnapMode>('voxel-face')
const symmetry = ref<SymmetryAxis>('off')
const symmetryHeld = ref<SymmetryAxis | null>(null)
const mode = ref<'paint' | 'erase' | 'fill' | 'eyedrop' | 'replace'>('paint')
const gridN = ref<NValue>(32)

const prefabs = ref<PrefabFile[]>([])
const replaceFromColor = ref<number | null>(null)

const showExportModal = ref(false)
const showReplaceModal = ref(false)
const showWelcome = ref(true)
const exportName = ref('')
const exportDescription = ref('')

const toastRef = ref<InstanceType<typeof Toast> | null>(null)
const isDark = ref(false)

// ---------- 派生 ----------
const currentParams = computed(() => {
  if (!currentTemplate.value) return {}
  const out: Record<string, number> = {}
  if (currentTemplate.value.params) {
    for (const [k, def] of Object.entries(currentTemplate.value.params)) {
      out[k] = templateParams[k] ?? def.default
    }
  }
  return out
})

const effectiveSymmetry = computed<SymmetryAxis>(() => symmetryHeld.value ?? symmetry.value)

const voxelCount = computed(() => grid.value.count())

// ---------- 操作：涂 / 擦 ----------
function applyPaintAt(coord: Vec3) {
  const n = grid.value.n
  if (!grid.value.inBounds(coord)) return
  if (grid.value.get(coord.x, coord.y, coord.z) !== 0) return  // 已有体素不涂

  const patches: Patch[] = []
  patches.push({
    idx: grid.value.toIdx(coord.x, coord.y, coord.z),
    from: 0,
    to: currentColor.value,
  })

  // 对称模式：加镜像
  const sym = effectiveSymmetry.value
  if (sym !== 'off') {
    const mirror = mirrorCoord(coord, sym, n)
    if (!(mirror.x === coord.x && mirror.y === coord.y && mirror.z === coord.z)) {
      if (grid.value.inBounds(mirror) && grid.value.get(mirror.x, mirror.y, mirror.z) === 0) {
        patches.push({
          idx: grid.value.toIdx(mirror.x, mirror.y, mirror.z),
          from: 0,
          to: currentColor.value,
        })
      }
    }
  }

  // 应用
  for (const p of patches) grid.value.data[p.idx] = p.to
  bumpGrid()

  const op = makePaintOp('paint', patches, grid.value, `涂 1 格`)
  undoStack.push(op)
  refreshUndoState()
  scheduleSave()
}

function bumpGrid() {
  gridVersion.value++
}

function applyEraseAt(coord: Vec3) {
  const n = grid.value.n
  if (!grid.value.inBounds(coord)) return
  if (grid.value.get(coord.x, coord.y, coord.z) === 0) return

  const patches: Patch[] = []
  patches.push({
    idx: grid.value.toIdx(coord.x, coord.y, coord.z),
    from: grid.value.get(coord.x, coord.y, coord.z),
    to: 0,
  })

  const sym = effectiveSymmetry.value
  if (sym !== 'off') {
    const mirror = mirrorCoord(coord, sym, n)
    if (!(mirror.x === coord.x && mirror.y === coord.y && mirror.z === coord.z)) {
      if (grid.value.inBounds(mirror) && grid.value.get(mirror.x, mirror.y, mirror.z) !== 0) {
        patches.push({
          idx: grid.value.toIdx(mirror.x, mirror.y, mirror.z),
          from: grid.value.get(mirror.x, mirror.y, mirror.z),
          to: 0,
        })
      }
    }
  }

  for (const p of patches) grid.value.data[p.idx] = p.to
  bumpGrid()

  const op = makePaintOp('erase', patches, grid.value, `擦 1 格`)
  undoStack.push(op)
  refreshUndoState()
  scheduleSave()
}

function applyFillAt(coord: Vec3) {
  const { patches } = floodFill(grid.value, coord, currentColor.value)
  if (patches.length === 0) {
    toastRef.value?.info('该位置无连通区域')
    return
  }
  for (const p of patches) grid.value.data[p.idx] = p.to
  bumpGrid()
  const op = makePaintOp('paint-many', patches, grid.value, `填充 ${patches.length} 格`)
  undoStack.push(op)
  refreshUndoState()
  scheduleSave()
}

function applyEyedropAt(coord: Vec3) {
  const v = grid.value.get(coord.x, coord.y, coord.z)
  if (v === 0) {
    toastRef.value?.info('该位置无体素')
    return
  }
  currentColor.value = v
  toastRef.value?.info('已取色')
  mode.value = 'paint'  // 自动切回涂色模式
}

function onPlaceTemplate(coord: Vec3) {
  if (currentTemplate.value) {
    applyPaintTemplate(currentTemplate.value, currentParams.value, coord)
  } else {
    applyPaintAt(coord)
  }
}

function applyPaintTemplate(template: Template, params: Record<string, number>, anchor: Vec3) {
  const local = template.build(params)
  const n = grid.value.n
  // origin 在 local 坐标中的位置（默认 corner-min = (0,0,0)）
  const originAt = template.originAt ? template.originAt(params) : { x: 0, y: 0, z: 0 }
  const patches: Patch[] = []
  let truncated = 0
  for (const v of local) {
    // world = anchor - originAt + v → 用户点击位置 = origin
    const world = {
      x: anchor.x - originAt.x + v.x,
      y: anchor.y - originAt.y + v.y,
      z: anchor.z - originAt.z + v.z,
    }
    if (!grid.value.inBounds(world)) {
      truncated++
      continue
    }
    const idx = grid.value.toIdx(world.x, world.y, world.z)
    if (grid.value.data[idx] !== 0) continue  // 不覆盖
    patches.push({ idx, from: 0, to: currentColor.value })
  }
  if (patches.length === 0) {
    toastRef.value?.warning('模板完全越界或被覆盖')
    return
  }
  for (const p of patches) grid.value.data[p.idx] = p.to

  // 对称
  const sym = effectiveSymmetry.value
  if (sym !== 'off') {
    const symPatches: Patch[] = []
    for (const p of [...patches]) {
      const coord = grid.value.toCoord(p.idx)
      const mirror = mirrorCoord(coord, sym, n)
      if (mirror.x === coord.x && mirror.y === coord.y && mirror.z === coord.z) continue
      const mirrorIdx = grid.value.toIdx(mirror.x, mirror.y, mirror.z)
      if (grid.value.data[mirrorIdx] !== 0) continue
      symPatches.push({ idx: mirrorIdx, from: 0, to: currentColor.value })
      grid.value.data[mirrorIdx] = currentColor.value
    }
    patches.push(...symPatches)
  }
  bumpGrid()

  const op = makePaintOp('paint-many', patches, grid.value,
    truncated > 0 ? `放模板（${patches.length} 格，截断 ${truncated}）` : `放模板（${patches.length} 格）`)
  undoStack.push(op)
  refreshUndoState()
  if (truncated > 0) toastRef.value?.warning(`模板越界，截断 ${truncated} 格`)
  scheduleSave()
}

// ---------- 模板参数 ----------
function selectTemplate(t: Template) {
  currentTemplate.value = t
  // 重置参数
  if (t.params) {
    for (const [k, def] of Object.entries(t.params)) {
      templateParams[k] = def.default
    }
  }
}

function onParamChange(key: string, value: number) {
  templateParams[key] = value
}

// ---------- 变换 ----------
function mirrorAll(axis: 'x' | 'y' | 'z') {
  if (grid.value.isEmpty()) {
    toastRef.value?.warning('网格为空')
    return
  }
  const before = new Uint16Array(grid.value.data)
  const beforeHash = grid.value.hash()

  if (axis === 'x') grid.value.mirrorX()
  else if (axis === 'y') grid.value.mirrorY()
  else grid.value.mirrorZ()
  bumpGrid()

  // 生成 patches（用于 undo）：每个变化的体素
  const patches: Patch[] = []
  for (let i = 0; i < grid.value.data.length; i++) {
    if (grid.value.data[i] !== before[i]) {
      patches.push({ idx: i, from: before[i], to: grid.value.data[i] })
    }
  }

  const op = {
    type: `mirror-${axis}` as any,
    patches,
    beforeHash,
    timestamp: Date.now(),
    label: `镜像 ${axis.toUpperCase()}`,
  }
  undoStack.push(op)
  refreshUndoState()
  toastRef.value?.success(`已沿 ${axis.toUpperCase()} 轴镜像`)
  scheduleSave()
}

function centerModel() {
  if (grid.value.isEmpty()) {
    toastRef.value?.warning('网格为空')
    return
  }
  const before = new Uint16Array(grid.value.data)
  const beforeHash = grid.value.hash()
  grid.value.centerOnOrigin()
  bumpGrid()

  const patches: Patch[] = []
  for (let i = 0; i < grid.value.data.length; i++) {
    if (grid.value.data[i] !== before[i]) {
      patches.push({ idx: i, from: before[i], to: grid.value.data[i] })
    }
  }
  if (patches.length === 0) {
    toastRef.value?.info('已居中')
    return
  }
  undoStack.push({
    type: 'center' as any,
    patches,
    beforeHash,
    timestamp: Date.now(),
    label: '居中',
  })
  refreshUndoState()
  toastRef.value?.success('已居中')
  scheduleSave()
}

// ---------- 撤销/重做 ----------
function refreshUndoState() {
  undoState.canUndo = undoStack.canUndo()
  undoState.canRedo = undoStack.canRedo()
}

function undo() {
  try {
    if (undoStack.undo(grid.value)) {
      bumpGrid()
      refreshUndoState()
      scheduleSave()
    }
  } catch (e: any) {
    toastRef.value?.error(e.message ?? '撤销失败')
  }
}

function redo() {
  if (undoStack.redo(grid.value)) {
    bumpGrid()
    refreshUndoState()
    scheduleSave()
  }
}

// ---------- 清空 ----------
const showClearModal = ref(false)
function confirmClear() {
  if (grid.value.isEmpty()) return
  const before = new Uint16Array(grid.value.data)
  const beforeHash = grid.value.hash()
  const patches: Patch[] = []
  for (let i = 0; i < grid.value.data.length; i++) {
    if (before[i] !== 0) patches.push({ idx: i, from: before[i], to: 0 })
  }
  grid.value.clear()
  bumpGrid()
  undoStack.push({
    type: 'clear' as any,
    patches,
    beforeHash,
    timestamp: Date.now(),
    label: '清空',
  })
  refreshUndoState()
  showClearModal.value = false
  toastRef.value?.success('已清空')
  scheduleSave()
}

// ---------- 替换颜色 ----------
function openReplaceModal() {
  showReplaceModal.value = true
}
function confirmReplace() {
  if (replaceFromColor.value === null) {
    toastRef.value?.warning('请先选择源色')
    showReplaceModal.value = false
    return
  }
  const { patches } = replaceColor(grid.value, replaceFromColor.value, currentColor.value)
  if (patches.length === 0) {
    toastRef.value?.info('没有匹配的体素')
    showReplaceModal.value = false
    return
  }
  for (const p of patches) grid.value.data[p.idx] = p.to
  bumpGrid()
  const op = makePaintOp('paint-many', patches, grid.value, `替换 ${patches.length} 格`)
  undoStack.push(op)
  refreshUndoState()
  showReplaceModal.value = false
  toastRef.value?.success(`已替换 ${patches.length} 格`)
  scheduleSave()
}

// ---------- 自动保存 ----------
let saveTimer: number | null = null
function scheduleSave() {
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    const ok = saveCurrent(grid.value)
    if (!ok) toastRef.value?.error('保存失败：localStorage 已满')
    saveTimer = null
  }, 500)
}

// ---------- 导入/导出 ----------
function exportProjectFile() {
  const json = exportProject(grid.value, { title: '未命名项目' })
  downloadProject(json)
  toastRef.value?.success('已导出项目')
}

function exportPrefabFile() {
  if (grid.value.isEmpty()) {
    toastRef.value?.warning('网格为空，无可导出')
    return
  }
  if (!exportName.value.trim()) {
    toastRef.value?.warning('请输入预制模型名称')
    return
  }
  const prefab = exportAsPrefab(grid.value, exportName.value.trim(), exportDescription.value.trim() || undefined)
  downloadPrefab(prefab)
  // 加入库
  const existing = prefabs.value.find(p => p.name === prefab.name)
  if (existing) {
    Object.assign(existing, prefab)
  } else {
    prefabs.value.push(prefab)
  }
  savePrefabs(prefabs.value)
  showExportModal.value = false
  exportName.value = ''
  exportDescription.value = ''
  toastRef.value?.success(`预制模型「${prefab.name}」已导出并入库`)
}

async function importPrefabFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const result = await importPrefabFromFile(file)
  if (typeof result === 'string') {
    toastRef.value?.error(result)
    input.value = ''
    return
  }
  // 检查重名
  const existing = prefabs.value.find(p => p.name === result.name)
  if (existing) {
    const overwrite = window.confirm(`已存在「${result.name}」，是否覆盖？`)
    if (overwrite) {
      Object.assign(existing, result)
    } else {
      result.name = `${result.name} (${Date.now().toString(36)})`
      prefabs.value.push(result)
    }
  } else {
    prefabs.value.push(result)
  }
  savePrefabs(prefabs.value)
  toastRef.value?.success(`已导入「${result.name}」`)
  input.value = ''
}

function deletePrefab(name: string) {
  if (!window.confirm(`删除预制模型「${name}」？`)) return
  prefabs.value = prefabs.value.filter(p => p.name !== name)
  savePrefabs(prefabs.value)
  toastRef.value?.success(`已删除「${name}」`)
}

// ---------- 切换 N ----------
function changeN(n: number) {
  if (n === grid.value.n) return
  // 创建新网格并迁移
  const newGrid = new VoxelGrid(n)
  const oldN = grid.value.n
  // 把原网格体素复制到新网格对应位置（中心对齐）
  const offset = Math.floor((n - oldN) / 2)
  for (let z = 0; z < oldN; z++) {
    for (let y = 0; y < oldN; y++) {
      for (let x = 0; x < oldN; x++) {
        const v = grid.value.data[grid.value.toIdx(x, y, z)]
        if (v !== 0) {
          const nx = x + offset, ny = y + offset, nz = z + offset
          if (nx >= 0 && nx < n && ny >= 0 && ny < n && nz >= 0 && nz < n) {
            newGrid.data[newGrid.toIdx(nx, ny, nz)] = v
          }
        }
      }
    }
  }
  grid.value = newGrid
  gridN.value = n as NValue
  bumpGrid()
  undoStack.clear()
  refreshUndoState()
  toastRef.value?.success(`已切换到 N=${n}`)
  scheduleSave()
}

// ---------- 新建/初始化 ----------
function newProject() {
  grid.value = new VoxelGrid(gridN.value)
  bumpGrid()
  undoStack.clear()
  refreshUndoState()
  showWelcome.value = false
  toastRef.value?.success('已新建项目')
  scheduleSave()
}

function loadDemo() {
  const demo = new VoxelGrid(32)
  // 一个简单的小屋 + 树 demo
  // 房子主体（4x3x4 立方体）
  for (let x = 4; x < 8; x++) for (let y = 0; y < 3; y++) for (let z = 4; z < 8; z++) {
    if (x === 4 || x === 7 || y === 0 || z === 4 || z === 7) {
      demo.data[demo.toIdx(x, y, z)] = 0xdddd  // 灰色墙
    }
  }
  // 屋顶（金字塔）
  for (let i = 0; i < 3; i++) {
    for (let x = 4 - i; x < 8 + i; x++) for (let z = 4 - i; z < 8 + i; z++) {
      if (x >= 4 && x < 8 && z >= 4 && z < 8) continue  // 跳过内部
      demo.data[demo.toIdx(x, 3 + i, z)] = 0xe944  // 红屋顶
    }
  }
  // 门
  demo.data[demo.toIdx(6, 1, 4)] = 0
  demo.data[demo.toIdx(6, 2, 4)] = 0
  // 树（树干 + 树冠）
  for (let y = 0; y < 4; y++) demo.data[demo.toIdx(14, y, 14)] = 0xa552  // 树干
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 4; dy < 8; dy++) {
    if (dx * dx + dz * dz + dy * dy < 8) {
      demo.data[demo.toIdx(14 + dx, dy, 14 + dz)] = 0x4a4a  // 绿色
    }
  }
  grid.value = demo
  bumpGrid()
  undoStack.clear()
  refreshUndoState()
  showWelcome.value = false
  toastRef.value?.success('已加载示例')
  scheduleSave()
}

function initFromStorage() {
  const saved = loadCurrent()
  if (saved) {
    grid.value = saved.grid
    gridN.value = saved.n as NValue
    bumpGrid()
    toastRef.value?.info('已恢复上次项目')
  }
}

// ---------- 快捷键 ----------
function onKeyDown(e: KeyboardEvent) {
  if (e.isComposing) return  // IME
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

  const ctrl = e.ctrlKey || e.metaKey
  const shift = e.shiftKey

  // Ctrl+Z 撤销
  if (ctrl && !shift && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    undo()
    return
  }
  // Ctrl+Y 重做
  if (ctrl && !shift && e.key.toLowerCase() === 'y') {
    e.preventDefault()
    redo()
    return
  }
  // Ctrl+Shift+Z 重做（备选）
  if (ctrl && shift && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    redo()
    return
  }
  // Ctrl+S 保存
  if (ctrl && e.key.toLowerCase() === 's') {
    e.preventDefault()
    const ok = saveCurrent(grid.value)
    if (ok) toastRef.value?.success('已保存')
    else toastRef.value?.error('保存失败')
    return
  }

  // 镜像（不按 Shift）
  if (!shift && !ctrl) {
    if (e.key === 'q' || e.key === 'Q') { e.preventDefault(); mirrorAll('x') }
    else if (e.key === 'w' || e.key === 'W') { e.preventDefault(); mirrorAll('y') }
    else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); mirrorAll('z') }
    else if (e.key === 'c' || e.key === 'C') { e.preventDefault(); centerModel() }
    else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault()
      // 切换填充模式
      mode.value = mode.value === 'fill' ? 'paint' : 'fill'
      toastRef.value?.info(mode.value === 'fill' ? '填充模式：点击体素' : '已切换到涂色模式')
    }
    else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); mode.value = 'paint' }
    else if (e.key === 'Escape') { showClearModal.value = false; showExportModal.value = false; showReplaceModal.value = false; showWelcome.value = false }
    else if (e.key === ' ') {
      // Space 强制放置（在 GridView 中处理）
    }
  }

  // Shift 修饰
  if (shift && !ctrl) {
    const k = e.key.toLowerCase()
    if (k === 'x') { e.preventDefault(); symmetryHeld.value = symmetryHeld.value === 'x' ? null : 'x' }
    else if (k === 'y') { e.preventDefault(); symmetryHeld.value = symmetryHeld.value === 'y' ? null : 'y' }
    else if (k === 'z') { e.preventDefault(); symmetryHeld.value = symmetryHeld.value === 'z' ? null : 'z' }
    else if (k === 'r') { e.preventDefault(); openReplaceModal() }
    else if (k === 'f') { e.preventDefault(); snapMode.value = snapMode.value === 'voxel-face' ? 'ground' : snapMode.value === 'ground' ? 'free' : 'voxel-face' }
  }

  // Alt 修饰 → 取色器
  if (e.altKey && !ctrl && !shift && (e.key === 'Alt' || e.altKey)) {
    mode.value = 'eyedrop'
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (e.key === 'Alt' || !e.altKey) {
    if (mode.value === 'eyedrop') mode.value = 'paint'
  }
  if (e.shiftKey === false) {
    symmetryHeld.value = null
  }
}

function onGridPointerEvent(coord: Vec3 | null) {
  // 这里可以显示坐标等
}

// ---------- 生命周期 ----------
onMounted(() => {
  initFromStorage()
  refreshUndoState()
  prefabs.value = loadPrefabs()

  // 检测主题
  isDark.value = document.documentElement.getAttribute('data-theme') === 'dark'
  const observer = new MutationObserver(() => {
    isDark.value = document.documentElement.getAttribute('data-theme') === 'dark'
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('keyup', onKeyUp)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('keyup', onKeyUp)
  if (saveTimer !== null) clearTimeout(saveTimer)
  // 最后保存一次
  saveCurrent(grid.value)
})

defineExpose({
  grid,
  currentColor,
  voxelCount,
  effectiveSymmetry,
  mode,
  snapMode,
})
</script>

<template>
  <div class="voxel-designer">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="topbar-left">
        <button class="btn" @click="newProject">新建</button>
        <button class="btn" @click="exportProjectFile">导出</button>
        <button class="btn" @click="showClearModal = true" :disabled="voxelCount === 0">清空</button>
      </div>
      <div class="topbar-center">
        <span class="title">体素设计器</span>
      </div>
      <div class="topbar-right">
        <button class="btn" :disabled="!undoState.canUndo" @click="undo">↶ 撤销</button>
        <button class="btn" :disabled="!undoState.canRedo" @click="redo">↷ 重做</button>
      </div>
    </header>

    <div class="main">
      <!-- 画布 -->
      <div class="canvas-area">
        <GridView
          :grid="grid"
          :grid-version="gridVersion"
          :current-color="currentColor"
          :template="currentTemplate"
          :template-params="currentParams"
          :symmetry="effectiveSymmetry"
          :mode="mode"
          :is-dark="isDark"
          @paint-at="applyPaintAt"
          @erase-at="applyEraseAt"
          @fill-at="applyFillAt"
          @eyedrop-at="applyEyedropAt"
          @place-template="onPlaceTemplate"
          @hover="onGridPointerEvent"
        />
      </div>

      <!-- 右侧操作面板 -->
      <aside class="control-panel">
        <!-- N 选择 -->
        <section class="panel-section">
          <h3>空间</h3>
          <div class="n-selector">
            <button
              v-for="n in [16, 32, 64] as NValue[]"
              :key="n"
              class="n-btn"
              :class="{ selected: gridN === n }"
              @click="changeN(n)"
            >
              {{ n }}×{{ n }}×{{ n }}
            </button>
          </div>
        </section>

        <!-- 模式 -->
        <section class="panel-section">
          <h3>模式</h3>
          <div class="mode-row">
            <button :class="{ selected: mode === 'paint' }" class="mode-btn" @click="mode = 'paint'">🖌️ 涂</button>
            <button :class="{ selected: mode === 'erase' }" class="mode-btn" @click="mode = 'erase'">🧹 擦</button>
            <button :class="{ selected: mode === 'fill' }" class="mode-btn" @click="mode = 'fill'">🪣 填</button>
            <button :class="{ selected: mode === 'eyedrop' }" class="mode-btn" @click="mode = 'eyedrop'">💧 取</button>
          </div>
        </section>

        <!-- 调色板 -->
        <section class="panel-section">
          <h3>色板</h3>
          <ColorPalette :current-color="currentColor" @select="currentColor = $event" />
          <div class="current-color-display">
            <div
              class="big-swatch"
              :style="{ background: '#' + currentColor.toString(16).padStart(4, '0').slice(0, 6) }"
            ></div>
            <span class="current-hex">#{{ currentColor.toString(16).padStart(4, '0').slice(0, 6).toUpperCase() }}</span>
          </div>
        </section>

        <!-- 预制模型 -->
        <section class="panel-section">
          <h3>预制模型</h3>
          <ModelTemplates
            :current-template-id="currentTemplate?.id ?? null"
            :params="templateParams"
            @select="selectTemplate"
            @param-change="onParamChange"
          />
          <div class="prefab-actions">
            <button class="btn-small" @click="showExportModal = true" :disabled="voxelCount === 0">
              📤 导出当前为预制模型
            </button>
            <label class="btn-small">
              📂 导入
              <input type="file" accept=".voxel-prefab.json,.json" style="display:none" @change="importPrefabFile" />
            </label>
          </div>
          <div v-if="prefabs.length > 0" class="user-prefabs">
            <h4>我的预制模型 ({{ prefabs.length }})</h4>
            <div v-for="p in prefabs" :key="p.name" class="user-prefab-item">
              <span class="prefab-name">📦 {{ p.name }}</span>
              <span class="prefab-meta">{{ p.meta?.voxelCount ?? p.voxels.length }}</span>
              <button class="btn-mini" @click="deletePrefab(p.name)">×</button>
            </div>
          </div>
        </section>

        <!-- 替换颜色 -->
        <section class="panel-section">
          <h3>替换颜色</h3>
          <button class="btn-full" @click="openReplaceModal" :disabled="voxelCount === 0">
            选择源色 → 替换为当前色
          </button>
        </section>

        <!-- 快捷键提示 -->
        <section class="panel-section">
          <h3>快捷键</h3>
          <div class="hotkeys">
            <div><kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd> 镜像</div>
            <div><kbd>C</kbd> 居中</div>
            <div><kbd>F</kbd> 填充模式</div>
            <div><kbd>Shift</kbd>+<kbd>X/Y/Z</kbd> 对称</div>
            <div><kbd>Alt</kbd> 取色器</div>
            <div><kbd>Ctrl</kbd>+<kbd>Z</kbd>/<kbd>Y</kbd> 撤销/重做</div>
            <div><kbd>Ctrl</kbd>+<kbd>S</kbd> 保存</div>
          </div>
        </section>
      </aside>
    </div>

    <!-- 状态栏 -->
    <footer class="status-bar">
      <span>N={{ gridN }}</span>
      <span>体素: {{ voxelCount }} / {{ gridN * gridN * gridN }}</span>
      <span>模式: {{ mode }}</span>
      <span>吸附: {{ snapMode }}</span>
      <span>对称: {{ effectiveSymmetry }}</span>
    </footer>

    <!-- 弹窗 -->
    <Modal :visible="showWelcome" title="欢迎使用体素设计器" @close="showWelcome = false">
      <p>选择如何开始：</p>
      <div class="welcome-actions">
        <button class="btn-full primary" @click="newProject(); showWelcome = false">✏️ 新建项目</button>
        <button class="btn-full" @click="loadDemo(); showWelcome = false">📦 加载示例</button>
      </div>
    </Modal>

    <Modal :visible="showExportModal" title="导出为预制模型" @close="showExportModal = false">
      <div class="form-row">
        <label>名称*</label>
        <input v-model="exportName" type="text" placeholder="例如：my-house" />
      </div>
      <div class="form-row">
        <label>描述</label>
        <textarea v-model="exportDescription" rows="2" placeholder="可选"></textarea>
      </div>
      <div class="form-row info">
        体素数: {{ voxelCount }}
      </div>
      <template #footer>
        <button class="btn" @click="showExportModal = false">取消</button>
        <button class="btn primary" @click="exportPrefabFile">导出</button>
      </template>
    </Modal>

    <Modal :visible="showReplaceModal" title="替换颜色" @close="showReplaceModal = false">
      <p>点击下方按钮选源色，然后点击应用把所有源色替换为当前色：</p>
      <ColorPalette :current-color="replaceFromColor ?? currentColor" @select="replaceFromColor = $event" />
      <template #footer>
        <button class="btn" @click="showReplaceModal = false">取消</button>
        <button class="btn primary" @click="confirmReplace">应用</button>
      </template>
    </Modal>

    <Modal :visible="showClearModal" title="清空全部？" @close="showClearModal = false">
      <p>将删除全部 {{ voxelCount }} 个体素，可撤销。</p>
      <template #footer>
        <button class="btn" @click="showClearModal = false">取消</button>
        <button class="btn danger" @click="confirmClear">清空</button>
      </template>
    </Modal>

    <Toast ref="toastRef" />
  </div>
</template>

<style scoped>
.voxel-designer {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 700px;
  max-height: calc(100vh - 80px);
  min-height: 480px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--vp-c-bg-alt);
  touch-action: none;  /* 阻止移动端默认滚动/缩放 */
}
.topbar {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-bg-alt);
  gap: 8px;
}
.topbar-left, .topbar-right { display: flex; gap: 6px; }
.topbar-center { flex: 1; text-align: center; }
.title { font-weight: 600; font-size: 14px; }
.btn {
  padding: 5px 10px;
  font-size: 12px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-bg-alt);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}
.btn:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn.primary { background: var(--vp-c-brand-1); color: white; border-color: var(--vp-c-brand-1); }
.btn.primary:hover:not(:disabled) { background: var(--vp-c-brand-2); }
.btn.danger { background: #f44336; color: white; border-color: #f44336; }
.btn.danger:hover:not(:disabled) { background: #d32f2f; }
.btn-small {
  display: inline-flex;
  align-items: center;
  padding: 5px 10px;
  font-size: 12px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-bg-alt);
  border-radius: 4px;
  cursor: pointer;
}
.btn-small:hover { border-color: var(--vp-c-brand-1); }
.btn-mini {
  width: 22px;
  height: 22px;
  font-size: 14px;
  line-height: 1;
  background: none;
  border: none;
  color: var(--vp-c-text-2);
  cursor: pointer;
}
.btn-mini:hover { color: #f44336; }
.btn-full {
  display: block;
  width: 100%;
  padding: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-bg-alt);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  margin-top: 6px;
}
.btn-full:hover:not(:disabled) { border-color: var(--vp-c-brand-1); }
.btn-full:disabled { opacity: 0.4; cursor: not-allowed; }
.main {
  display: flex;
  flex: 1;
  min-height: 0;
}
.canvas-area {
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: var(--vp-c-bg);
}
.control-panel {
  width: 280px;
  background: var(--vp-c-bg-soft);
  border-left: 1px solid var(--vp-c-bg-alt);
  overflow-y: auto;
  padding: 12px;
  font-size: 13px;
}
.panel-section {
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--vp-c-bg-alt);
}
.panel-section:last-child { border-bottom: none; }
.panel-section h3 {
  margin: 0 0 8px 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
}
.panel-section h4 {
  margin: 8px 0 4px 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--vp-c-text-2);
}
.n-selector {
  display: flex;
  gap: 4px;
}
.n-btn {
  flex: 1;
  padding: 6px;
  font-size: 11px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-bg-alt);
  border-radius: 4px;
  cursor: pointer;
}
.n-btn.selected {
  background: var(--vp-c-brand-1);
  color: white;
  border-color: var(--vp-c-brand-1);
}
.mode-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.mode-btn {
  padding: 6px;
  font-size: 12px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-bg-alt);
  border-radius: 4px;
  cursor: pointer;
}
.mode-btn.selected {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
.current-color-display {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 6px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-bg-alt);
  border-radius: 4px;
}
.big-swatch {
  width: 32px;
  height: 32px;
  border-radius: 4px;
  border: 1px solid rgba(0,0,0,0.2);
}
.current-hex { font-family: monospace; font-size: 13px; }
.prefab-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.user-prefabs {
  margin-top: 12px;
}
.user-prefab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  margin-bottom: 4px;
  background: var(--vp-c-bg);
  border-radius: 4px;
  font-size: 12px;
}
.prefab-name { flex: 1; }
.prefab-meta { color: var(--vp-c-text-3); font-size: 11px; }
.hotkeys {
  font-size: 11px;
  color: var(--vp-c-text-2);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
kbd {
  display: inline-block;
  padding: 1px 4px;
  margin: 0 1px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-bg-alt);
  border-radius: 3px;
  font-family: monospace;
  font-size: 10px;
  min-width: 16px;
  text-align: center;
}
.status-bar {
  display: flex;
  gap: 16px;
  padding: 6px 12px;
  background: var(--vp-c-bg-soft);
  border-top: 1px solid var(--vp-c-bg-alt);
  font-size: 11px;
  color: var(--vp-c-text-2);
  font-family: monospace;
}
.welcome-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}
.form-row label {
  font-size: 12px;
  color: var(--vp-c-text-2);
}
.form-row input, .form-row textarea {
  padding: 6px 8px;
  border: 1px solid var(--vp-c-bg-alt);
  border-radius: 4px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 13px;
  font-family: inherit;
}
.form-row.info {
  font-size: 12px;
  color: var(--vp-c-text-2);
  margin-top: 8px;
  padding: 8px;
  background: var(--vp-c-bg-alt);
  border-radius: 4px;
}
</style>