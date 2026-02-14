import * as THREE from "three";

/**
 * Creates a simple cylinder person avatar.
 * Head = sphere, Body = inverted cone/cylinder (倒三角)
 * With a name label floating above the head.
 */
export function createCylinderPerson(color: string, name: string): THREE.Group {
  const group = new THREE.Group();
  group.name = "cylinderPerson";

  const baseColor = new THREE.Color(color);
  const bodyMat = new THREE.MeshToonMaterial({ color: baseColor });

  // ── Body (倒三角圓柱 - inverted tapered cylinder) ──────────
  // 上寬下窄的圓柱：radiusTop=0.5, radiusBottom=0.15
  const bodyGeometry = new THREE.CylinderGeometry(0.5, 0.15, 1.2, 16);
  const body = new THREE.Mesh(bodyGeometry, bodyMat);
  body.position.set(0, 0.6, 0);
  body.castShadow = true;
  group.add(body);

  // ── Head (圓球) ────────────────────────────────────────────
  const headGeometry = new THREE.SphereGeometry(0.35, 16, 12);
  const head = new THREE.Mesh(headGeometry, bodyMat);
  head.position.set(0, 1.55, 0);
  head.castShadow = true;
  group.add(head);

  // ── Arms (倒三角圓柱 - 手臂粗、手尖) ─────────────────────────
  for (const side of [-1, 1]) {
    const armGroup = new THREE.Group();
    armGroup.name = side === -1 ? "arm_left" : "arm_right";
    
    // 手臂 (倒三角圓柱：上粗下細)
    const armGeometry = new THREE.CylinderGeometry(0.06, 0.12, 0.5, 8);
    const arm = new THREE.Mesh(armGeometry, bodyMat);
    arm.position.set(0, -0.25, 0);
    armGroup.add(arm);
    
    // 手 (小圓錐尖端)
    const handGeometry = new THREE.ConeGeometry(0.06, 0.15, 8);
    const hand = new THREE.Mesh(handGeometry, bodyMat);
    hand.rotation.x = Math.PI; // 尖端朝下
    hand.position.set(0, -0.55, 0);
    armGroup.add(hand);
    
    // 放在身體兩側
    armGroup.position.set(side * 0.55, 0.9, 0);
    armGroup.rotation.z = side * 0.2; // 微微張開
    group.add(armGroup);
  }

  // Name label is handled by EffectsManager (CSS2D) — no Sprite label here.

  // Scale the whole person
  group.scale.set(1.2, 1.2, 1.2);

  return group;
}

/** Animate idle bob */
export function animateCylinderIdle(group: THREE.Group, time: number): void {
  group.position.y += Math.sin(time * 2) * 0.003;
  group.rotation.z = Math.sin(time * 1.5) * 0.02;
}

/** Animate walking (slight bounce) */
export function animateCylinderWalk(group: THREE.Group, time: number): void {
  group.position.y += Math.abs(Math.sin(time * 8)) * 0.05;
}

/** Animate wave (raise right arm) */
export function animateCylinderWave(group: THREE.Group, time: number): void {
  const rightArm = group.getObjectByName("arm_right");
  if (rightArm) {
    rightArm.rotation.z = -1.5 + Math.sin(time * 6) * 0.5; // 舉起來揮動
    rightArm.rotation.x = Math.sin(time * 4) * 0.3;
  }
  // 身體微微晃動
  group.rotation.z = Math.sin(time * 2) * 0.05;
}

/** Animate dance (bounce + arms swing) */
export function animateCylinderDance(group: THREE.Group, time: number): void {
  group.position.y += Math.abs(Math.sin(time * 5)) * 0.15;
  group.rotation.z = Math.sin(time * 3) * 0.1;
  
  // 雙手擺動
  const leftArm = group.getObjectByName("arm_left");
  const rightArm = group.getObjectByName("arm_right");
  if (leftArm) {
    leftArm.rotation.z = 0.2 + Math.sin(time * 5) * 0.8;
    leftArm.rotation.x = Math.sin(time * 3) * 0.4;
  }
  if (rightArm) {
    rightArm.rotation.z = -0.2 + Math.sin(time * 5 + Math.PI) * 0.8;
    rightArm.rotation.x = Math.sin(time * 3 + Math.PI) * 0.4;
  }
}

/** Animate talk (slight nod) */
export function animateCylinderTalk(group: THREE.Group, time: number): void {
  group.rotation.x = Math.sin(time * 6) * 0.1;
}
