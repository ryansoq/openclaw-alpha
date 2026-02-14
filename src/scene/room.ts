import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";

export function createScene() {
  // ── Renderer ───────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  document.getElementById("app")!.appendChild(renderer.domElement);

  // ── CSS2D label renderer ───────────────────────────────────
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.style.position = "absolute";
  labelRenderer.domElement.style.top = "0";
  labelRenderer.domElement.style.left = "0";
  labelRenderer.domElement.style.pointerEvents = "none";
  document.getElementById("app")!.appendChild(labelRenderer.domElement);

  // ── Scene ──────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f5f5); // 淺灰白色辦公室背景
  scene.fog = new THREE.FogExp2(0xf0f0f0, 0.006);

  // ── Camera ─────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    200
  );
  camera.position.set(20, 18, 20);
  camera.lookAt(0, 0, 0);

  // ── Controls (WoW-style) ────────────────────────────────────
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.45;
  controls.minDistance = 5;
  controls.maxDistance = 80;
  controls.target.set(0, 0, 0);
  
  // WoW-style: right-click to rotate, disable left-click rotate
  controls.mouseButtons = {
    LEFT: null as unknown as THREE.MOUSE,       // 左鍵不做事
    MIDDLE: THREE.MOUSE.DOLLY,                   // 中鍵縮放
    RIGHT: THREE.MOUSE.ROTATE,                   // 右鍵旋轉
  };
  controls.enablePan = false; // 平移用鍵盤

  // WASD / Arrow keys → pan camera
  const keyState = new Set<string>();
  const PAN_SPEED = 0.5;

  window.addEventListener("keydown", (e) => {
    keyState.add(e.key.toLowerCase());
  });
  window.addEventListener("keyup", (e) => {
    keyState.delete(e.key.toLowerCase());
  });

  // Per-frame keyboard pan (called in animation loop via controls._keyPan)
  (controls as any)._keyPan = () => {
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    const delta = new THREE.Vector3();
    if (keyState.has("w") || keyState.has("arrowup"))    delta.add(forward);
    if (keyState.has("s") || keyState.has("arrowdown"))  delta.sub(forward);
    if (keyState.has("d") || keyState.has("arrowright")) delta.add(right);
    if (keyState.has("a") || keyState.has("arrowleft"))  delta.sub(right);

    if (delta.lengthSq() > 0) {
      delta.normalize().multiplyScalar(PAN_SPEED);
      controls.target.add(delta);
      camera.position.add(delta);
    }
  };

  // ── Clock ──────────────────────────────────────────────────
  const clock = new THREE.Clock();

  // ── Office floor (木紋地板) ─────────────────────────────────
  const floorCanvas = document.createElement("canvas");
  floorCanvas.width = 512;
  floorCanvas.height = 512;
  const ctx = floorCanvas.getContext("2d")!;

  // 溫暖木紋地板
  ctx.fillStyle = "#d4a574"; // 溫暖木色
  ctx.fillRect(0, 0, 512, 512);

  // 木紋條紋
  ctx.strokeStyle = "rgba(139, 90, 43, 0.15)";
  ctx.lineWidth = 2;
  for (let i = 0; i <= 512; i += 24) {
    ctx.beginPath();
    ctx.moveTo(0, i + Math.sin(i * 0.05) * 3);
    ctx.lineTo(512, i + Math.sin(i * 0.05 + 2) * 3);
    ctx.stroke();
  }

  // 地板磚塊線
  ctx.strokeStyle = "rgba(100, 60, 30, 0.1)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 512; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();
  }

  const floorTexture = new THREE.CanvasTexture(floorCanvas);
  floorTexture.wrapS = THREE.RepeatWrapping;
  floorTexture.wrapT = THREE.RepeatWrapping;
  floorTexture.repeat.set(4, 4);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshStandardMaterial({
      map: floorTexture,
      roughness: 0.85,
      metalness: 0.05,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // ── Semi-transparent walls ─────────────────────────────────
  const wallMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x88ccdd,
    transparent: true,
    opacity: 0.08,
    roughness: 0.1,
    metalness: 0.0,
    transmission: 0.8,
    side: THREE.DoubleSide,
  });

  const wallHeight = 20;
  const wallPositions: [number, number, number, number][] = [
    [0, wallHeight / 2, -50, 0],         // back
    [0, wallHeight / 2, 50, Math.PI],     // front
    [-50, wallHeight / 2, 0, Math.PI / 2], // left
    [50, wallHeight / 2, 0, -Math.PI / 2], // right
  ];

  for (const [x, y, z, ry] of wallPositions) {
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(100, wallHeight),
      wallMaterial
    );
    wall.position.set(x, y, z);
    wall.rotation.y = ry;
    scene.add(wall);
  }

  // ── Lighting (bright sunny day, clear water) ───────────────
  // Hemisphere: sky blue from above, warm sand reflection from below
  const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0xc2b280, 0.8);
  scene.add(hemiLight);

  // Ambient fill
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);

  // Main sun light — warm white, strong
  const mainLight = new THREE.DirectionalLight(0xfff5e6, 1.8);
  mainLight.position.set(25, 40, 15);
  mainLight.castShadow = true;
  mainLight.shadow.mapSize.width = 2048;
  mainLight.shadow.mapSize.height = 2048;
  mainLight.shadow.camera.near = 0.5;
  mainLight.shadow.camera.far = 100;
  mainLight.shadow.camera.left = -50;
  mainLight.shadow.camera.right = 50;
  mainLight.shadow.camera.top = 50;
  mainLight.shadow.camera.bottom = -50;
  scene.add(mainLight);

  // Light dappled caustics
  const caustic1 = new THREE.PointLight(0xffe8b0, 0.4, 60);
  caustic1.position.set(-15, 15, -15);
  scene.add(caustic1);

  const caustic2 = new THREE.PointLight(0xe0f0ff, 0.3, 50);
  caustic2.position.set(15, 12, 10);
  scene.add(caustic2);

  // ── 辦公室沒有石頭，障礙物由家具提供 ─────────────────────────
  const obstacles: { x: number; z: number; radius: number }[] = [];
  
  // 可以加一些盆栽裝飾
  const plantGeo = new THREE.CylinderGeometry(0.3, 0.4, 0.8, 8);
  const potMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x228b22, roughness: 0.8 });
  
  const plantPositions = [
    [-18, 18], [18, 18], [-18, -18], [18, -18]  // 四個角落
  ];
  
  for (const [px, pz] of plantPositions) {
    const pot = new THREE.Mesh(plantGeo, potMat);
    pot.position.set(px, 0.4, pz);
    pot.castShadow = true;
    scene.add(pot);
    
    // 葉子（簡單球體）
    const leaves = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 8, 6),
      leafMat
    );
    leaves.position.set(px, 1.2, pz);
    leaves.scale.set(1, 1.2, 1);
    leaves.castShadow = true;
    scene.add(leaves);
    
    obstacles.push({ x: px, z: pz, radius: 1 });
  }

  // Particles disabled — was causing "snow" effect in office

  return { scene, camera, renderer, labelRenderer, controls, clock, obstacles };
}
