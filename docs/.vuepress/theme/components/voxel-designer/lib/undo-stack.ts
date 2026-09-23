/**
 * 撤销栈（UndoStack）
 *
 * - 每 op 一次入栈，op.patches 记录每个体素的 from→to
 * - 撤销时反向应用；重做时正向应用
 * - maxSize = 200（超过则最早的 op 被丢弃）
 * - 冲突检测：op.beforeHash 与当前 grid.hash() 比较
 */

import type { VoxelGrid } from './voxel-grid'

export type EditOpType =
  | 'paint'
  | 'paint-many'
  | 'erase'
  | 'erase-many'
  | 'mirror-x'
  | 'mirror-y'
  | 'mirror-z'
  | 'center'
  | 'clear'

export interface Patch {
  idx: number
  from: number
  to: number
}

export interface EditOp {
  type: EditOpType
  patches: Patch[]
  beforeHash: string
  timestamp: number
  label?: string  // e.g. "画了 12 个体素"
}

export class UndoStack {
  private undoStack: EditOp[] = []
  private redoStack: EditOp[] = []
  readonly maxSize: number = 200

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  push(op: EditOp): void {
    this.undoStack.push(op)
    this.redoStack = []  // 任何 push 都清空 redo
    if (this.undoStack.length > this.maxSize) this.undoStack.shift()
  }

  /** 撤销；返回 true=成功，false=无 op；冲突抛错 */
  undo(grid: VoxelGrid): boolean {
    const op = this.undoStack.pop()
    if (!op) return false
    if (grid.hash() !== op.beforeHash) {
      this.undoStack.push(op)  // 放回去
      throw new Error('Undo conflict: grid has been modified externally')
    }
    // 反向应用
    for (let i = op.patches.length - 1; i >= 0; i--) {
      const p = op.patches[i]
      grid.data[p.idx] = p.from
    }
    this.redoStack.push(op)
    return true
  }

  /** 重做；返回 true=成功 */
  redo(grid: VoxelGrid): boolean {
    const op = this.redoStack.pop()
    if (!op) return false
    for (const p of op.patches) grid.data[p.idx] = p.to
    this.undoStack.push(op)
    return true
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }

  size(): number {
    return this.undoStack.length
  }
}

/**
 * 创建一次涂色 op（自动捕获 beforeHash）
 */
export function makePaintOp(
  type: 'paint' | 'paint-many' | 'erase' | 'erase-many',
  patches: Patch[],
  grid: VoxelGrid,
  label?: string,
): EditOp {
  return {
    type,
    patches,
    beforeHash: grid.hash(),
    timestamp: Date.now(),
    label,
  }
}