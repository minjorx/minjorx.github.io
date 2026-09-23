/**
 * Three.js 场景初始化
 *
 * - 动态导入 three（不进主 bundle）
 * - 创建 Scene / Camera / Renderer / OrbitControls
 * - 暴露给 Vue 组件用
 */

import type * as THREE from 'three'

export interface ThreeContext {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: any  // OrbitControls
  dispose: () => void
}

export async function createThreeScene(canvas: HTMLCanvasElement, n: number): Promise<ThreeContext> {
  const THREE = await import('three')
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf0f0f0)

  const camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, n * 5)
  camera.position.set(n * 1.5, n * 1.2, n * 1.5)
  camera.lookAt(n / 2, n / 2, n / 2)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.shadowMap.enabled = false

  // 光源
  const ambient = new THREE.AmbientLight(0xffffff, 0.6)
  scene.add(ambient)
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.7)
  dirLight.position.set(n, n * 2, n)
  scene.add(dirLight)
  const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3)
  dirLight2.position.set(-n, 0, -n)
  scene.add(dirLight2)

  // 控制器
  const controls = new OrbitControls(camera, canvas)
  controls.target.set(n / 2, n / 2, n / 2)
  controls.enableDamping = true
  controls.dampingFactor = 0.1
  controls.minDistance = n * 0.3
  controls.maxDistance = n * 5
  controls.mouseButtons = {
    LEFT: null as any,
    MIDDLE: THREE.MOUSE.ROTATE,
    RIGHT: THREE.MOUSE.PAN,
  }
  // Shift + 左键 = 旋转
  // 注：这里通过自定义 keydown 处理 Shift 修饰

  return {
    scene,
    camera,
    renderer,
    controls,
    dispose: () => {
      renderer.dispose()
      controls.dispose()
    },
  }
}