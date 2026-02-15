import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

export interface BuildingDef {
  id: string;
  name: string;
  position: THREE.Vector3;
  obstacleRadius: number;
  mesh: THREE.Group;
}

/**
 * Create all interactive buildings in the office.
 * Returns building definitions + obstacle data for collision avoidance.
 */
export function createBuildings(scene: THREE.Scene): {
  buildings: BuildingDef[];
  obstacles: { x: number; z: number; radius: number }[];
} {
  const buildings: BuildingDef[] = [];
  const obstacles: { x: number; z: number; radius: number }[] = [];

  // ══════════════════════════════════════════════════════════
  // ║        功能建築（暫時隱藏，之後自己做）                   ║
  // ══════════════════════════════════════════════════════════

  // TODO: 自己重新設計這三個建築
  // - Moltbook (左側牆邊)
  // - Clawhub (右側牆邊)  
  // - Worlds Portal (後方牆邊)

  /*
  // ── Moltbook Bulletin Board (左側牆邊) ─────────────────────
  const moltbook = createMoltbookBoard();
  moltbook.position.set(-22, 0, 0);
  moltbook.rotation.y = Math.PI / 2; // 面向內部
  moltbook.scale.set(0.6, 0.6, 0.6); // 縮小一點
  scene.add(moltbook);
  buildings.push({
    id: "moltbook",
    name: "📋 Moltbook",
    position: new THREE.Vector3(-22, 0, 0),
    obstacleRadius: 2,
    mesh: moltbook,
  });
  obstacles.push({ x: -22, z: 0, radius: 2 });

  // ── Clawhub School (右側牆邊) ──────────────────────────────
  const clawhub = createClawhubSchool();
  clawhub.position.set(22, 0, 0);
  clawhub.rotation.y = -Math.PI / 2; // 面向內部
  clawhub.scale.set(0.5, 0.5, 0.5); // 縮小
  scene.add(clawhub);
  buildings.push({
    id: "clawhub",
    name: "🏫 Clawhub",
    position: new THREE.Vector3(22, 0, 0),
    obstacleRadius: 3,
    mesh: clawhub,
  });
  obstacles.push({ x: 22, z: 0, radius: 3 });

  // ── Worlds Portal (後方牆邊) ───────────────────────────────
  const portal = createWorldsPortal();
  portal.position.set(0, 0, -22);
  portal.scale.set(0.6, 0.6, 0.6); // 縮小
  scene.add(portal);
  buildings.push({
    id: "worlds-portal",
    name: "🌀 Portal",
    position: new THREE.Vector3(0, 0, -22),
    obstacleRadius: 3,
    mesh: portal,
  });
  obstacles.push({ x: 0, z: -22, radius: 3 });
  */

  // ══════════════════════════════════════════════════════════
  // ║              房間隔間牆壁                                ║
  // ══════════════════════════════════════════════════════════
  
  const wallMat = new THREE.MeshStandardMaterial({ 
    color: 0xd0d0d0, 
    roughness: 0.8,
    side: THREE.DoubleSide 
  });

  const partitionFrameMat = new THREE.MeshStandardMaterial({
    color: 0x606060,
    roughness: 0.4,
    metalness: 0.3,
  });

  const frostedGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0xc8dce8,
    transparent: true,
    opacity: 0.35,
    roughness: 0.6,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  
  // 工作區隔間（左上，Nami 的私人空間）- 矮牆 + 磨砂玻璃上半
  const workPartition1Base = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 1.5, 8),
    wallMat
  );
  workPartition1Base.position.set(-6, 0.75, -10);
  workPartition1Base.castShadow = true;
  scene.add(workPartition1Base);
  const workPartition1Glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 1.2, 8),
    frostedGlassMat
  );
  workPartition1Glass.position.set(-6, 2.1, -10);
  scene.add(workPartition1Glass);
  // Frame top rail
  const workFrame1Top = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.08, 8),
    partitionFrameMat
  );
  workFrame1Top.position.set(-6, 2.74, -10);
  scene.add(workFrame1Top);
  obstacles.push({ x: -6, z: -10, radius: 0.5 });

  // 工作區隔間（右上，同事的私人空間）- 同樣風格
  const workPartition2Base = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 1.5, 8),
    wallMat
  );
  workPartition2Base.position.set(6, 0.75, -10);
  workPartition2Base.castShadow = true;
  scene.add(workPartition2Base);
  const workPartition2Glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 1.2, 8),
    frostedGlassMat
  );
  workPartition2Glass.position.set(6, 2.1, -10);
  scene.add(workPartition2Glass);
  const workFrame2Top = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.08, 8),
    partitionFrameMat
  );
  workFrame2Top.position.set(6, 2.74, -10);
  scene.add(workFrame2Top);
  obstacles.push({ x: 6, z: -10, radius: 0.5 });

  // ── 休息區與工作區的隔間（矮牆 + 磨砂玻璃，三段，留兩個門口）──
  // Helper to create a partition segment with base wall + glass top + frame
  function addPartitionSegment(width: number, x: number, z: number) {
    // 矮牆底部 (1.2m)
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(width, 1.2, 0.2),
      wallMat
    );
    base.position.set(x, 0.6, z);
    base.castShadow = true;
    scene.add(base);

    // 磨砂玻璃上半 (1.0m)
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(width, 1.0, 0.15),
      frostedGlassMat
    );
    glass.position.set(x, 1.7, z);
    scene.add(glass);

    // 金屬框頂部
    const topRail = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.06, 0.25),
      partitionFrameMat
    );
    topRail.position.set(x, 2.24, z);
    scene.add(topRail);

    // 金屬框底部分界線
    const midRail = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.04, 0.22),
      partitionFrameMat
    );
    midRail.position.set(x, 1.2, z);
    scene.add(midRail);
  }

  // 左段
  addPartitionSegment(5, -14, 5);
  // 中段
  addPartitionSegment(6, 0, 5);
  // 右段
  addPartitionSegment(5, 14, 5);
  // 兩個門口：左邊 (-8 到 -10) 和右邊 (8 到 10)

  // ── 區域標示牌 ──
  const signMat = new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.5 });
  const signTextMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });

  // 工作區標示 (掛在中段隔間上方，朝北 = 工作區方向)
  const workSign = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 0.5, 0.08),
    signMat
  );
  workSign.position.set(0, 2.8, 4.9);
  scene.add(workSign);
  const workSignText = new THREE.Mesh(
    new THREE.PlaneGeometry(2.3, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x00bcd4, emissive: 0x006064, emissiveIntensity: 0.2 })
  );
  workSignText.position.set(0, 2.8, 4.85);
  scene.add(workSignText);

  // 休息區標示 (朝南 = 休息區方向)
  const loungeSign = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 0.5, 0.08),
    signMat
  );
  loungeSign.position.set(0, 2.8, 5.1);
  scene.add(loungeSign);
  const loungeSignText = new THREE.Mesh(
    new THREE.PlaneGeometry(2.3, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x7c4dff, emissive: 0x4527a0, emissiveIntensity: 0.2 })
  );
  loungeSignText.position.set(0, 2.8, 5.15);
  loungeSignText.rotation.y = Math.PI;
  scene.add(loungeSignText);

  // Add floating labels above each building
  for (const b of buildings) {
    const el = document.createElement("div");
    el.className = "building-label";
    el.textContent = b.name;
    const labelObj = new CSS2DObject(el);
    const labelY = b.id === "moltbook" ? 6 : b.id === "worlds-portal" ? 9 : 8;
    labelObj.position.set(0, labelY, 0);
    b.mesh.add(labelObj);
  }

  // ── Moltbook decorative sticky notes (3D geometry on the board) ──
  const moltbookGroup = buildings.find((b) => b.id === "moltbook")?.mesh;
  if (moltbookGroup) {
    const noteGrid = [
      // [x, y] on the board face — 3 columns x 3 rows
      [-1.0, 4.2], [0.0, 4.3], [1.0, 4.1],
      [-0.8, 3.3], [0.4, 3.2], [1.2, 3.4],
      [-0.3, 2.4], [0.8, 2.5],
    ];
    const noteColors = [0xc8e6c9, 0x81d4fa, 0xffcc80, 0xb39ddb, 0xffe082, 0x80cbc4, 0xf48fb1, 0x90caf9];

    for (let i = 0; i < noteGrid.length; i++) {
      const [nx, ny] = noteGrid[i];
      const w = 0.5 + Math.random() * 0.3;
      const h = 0.5 + Math.random() * 0.2;
      const note = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshStandardMaterial({
          color: noteColors[i % noteColors.length],
          roughness: 0.9,
        })
      );
      note.position.set(nx, ny, 0.09);
      note.rotation.z = (Math.random() - 0.5) * 0.15;
      note.userData.buildingId = "moltbook";
      moltbookGroup.add(note);
    }
  }

  // ══════════════════════════════════════════════════════════
  // ║            AI Agent 辦公室佈局 (by Nami)               ║
  // ══════════════════════════════════════════════════════════

  // 🖥️ Nami 的電腦桌 (左上)
  const namiDesk = createComputerDesk("#00CED1"); // 青色
  namiDesk.position.set(-12, 0, -10);
  namiDesk.rotation.y = Math.PI; // 面向中央
  scene.add(namiDesk);
  buildings.push({
    id: "nami-desk",
    name: "🖥️ Nami",
    position: new THREE.Vector3(-12, 0, -10),
    obstacleRadius: 2,
    mesh: namiDesk,
  });
  obstacles.push({ x: -12, z: -10, radius: 2 });

  // 🖥️ 同事的電腦桌 (右上)
  const colleagueDesk = createComputerDesk("#FF6B6B"); // 紅色（等待同事）
  colleagueDesk.position.set(12, 0, -10);
  colleagueDesk.rotation.y = Math.PI; // 面向中央
  scene.add(colleagueDesk);
  buildings.push({
    id: "colleague-desk",
    name: "🖥️ 同事",
    position: new THREE.Vector3(12, 0, -10),
    obstacleRadius: 2,
    mesh: colleagueDesk,
  });
  obstacles.push({ x: 12, z: -10, radius: 2 });

  // 🤝 會議桌 (中央)
  const meetingTable = createMeetingTable();
  meetingTable.position.set(0, 0, 0);
  scene.add(meetingTable);
  buildings.push({
    id: "meeting-table",
    name: "🤝 Meeting",
    position: new THREE.Vector3(0, 0, 0),
    obstacleRadius: 3,
    mesh: meetingTable,
  });
  obstacles.push({ x: 0, z: 0, radius: 3 });

  // 🛋️ 沙發休息區 (左下)
  const sofa = createSofa();
  sofa.position.set(-12, 0, 12);
  sofa.rotation.y = 0; // 原本方向
  scene.add(sofa);
  buildings.push({
    id: "sofa",
    name: "🛋️ Lounge",
    position: new THREE.Vector3(-12, 0, 12),
    obstacleRadius: 3,
    mesh: sofa,
  });
  obstacles.push({ x: -12, z: 12, radius: 3 });

  // 🪑 沙發前的小圓桌（沙發前方）
  const coffeeTable = createCoffeeTable();
  coffeeTable.position.set(-12, 0, 14);  // 沙發在 z:12，小圓桌在前面 z:14
  scene.add(coffeeTable);
  obstacles.push({ x: -12, z: 14, radius: 1 });

  // 📺 電視（在小圓桌更前方，面向沙發）
  const tv = createTV();
  tv.position.set(-12, 0, 17);
  tv.rotation.y = Math.PI; // 轉 180 度面向沙發
  scene.add(tv);
  obstacles.push({ x: -12, z: 17, radius: 1.5 });

  // ☕ 茶水間 (右下)
  const pantry = createPantry();
  pantry.position.set(12, 0, 12);
  scene.add(pantry);
  buildings.push({
    id: "pantry",
    name: "☕ Pantry",
    position: new THREE.Vector3(12, 0, 12),
    obstacleRadius: 2.5,
    mesh: pantry,
  });
  obstacles.push({ x: 12, z: 12, radius: 2.5 });

  // 📋 白板 (後方牆壁前)
  const whiteboard = createWhiteboard();
  whiteboard.position.set(0, 0, -18);
  scene.add(whiteboard);
  buildings.push({
    id: "whiteboard",
    name: "📋 Task Board",
    position: new THREE.Vector3(0, 0, -18),
    obstacleRadius: 2,
    mesh: whiteboard,
  });
  obstacles.push({ x: 0, z: -18, radius: 2 });

  // 🔀 PR Board (near meeting table)
  const prBoard = createPRBoard();
  prBoard.position.set(-7, 0, -2);
  scene.add(prBoard);
  buildings.push({
    id: "pr-board",
    name: "🔀 PR Board",
    position: new THREE.Vector3(-7, 0, -2),
    obstacleRadius: 1.5,
    mesh: prBoard,
  });
  obstacles.push({ x: -7, z: -2, radius: 1.5 });

  // 🚪 入口標示 (前方)
  const entrance = createEntrance();
  entrance.position.set(0, 0, 20);
  scene.add(entrance);
  buildings.push({
    id: "entrance",
    name: "🚪 Entrance",
    position: new THREE.Vector3(0, 0, 20),
    obstacleRadius: 1,
    mesh: entrance,
  });

  return { buildings, obstacles };
}

// ── Office Furniture Creators ─────────────────────────────────

function createComputerDesk(accentColor: string = "#4fc3f7"): THREE.Group {
  const group = new THREE.Group();
  group.name = "building_computer";
  group.userData.buildingId = "computer-desk";

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.8 });
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.3 });
  const glowColor = new THREE.Color(accentColor);
  const screenGlow = new THREE.MeshStandardMaterial({ color: glowColor, emissive: glowColor, emissiveIntensity: 0.3 });

  // Desk
  const desk = new THREE.Mesh(new THREE.BoxGeometry(3, 0.15, 1.5), woodMat);
  desk.position.set(0, 1.2, 0);
  desk.castShadow = true;
  desk.userData.buildingId = "computer-desk";
  group.add(desk);

  // Legs
  for (const [x, z] of [[-1.3, -0.6], [1.3, -0.6], [-1.3, 0.6], [1.3, 0.6]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), woodMat);
    leg.position.set(x, 0.6, z);
    leg.userData.buildingId = "computer-desk";
    group.add(leg);
  }

  // Monitor
  const monitor = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.05), screenMat);
  monitor.position.set(0, 1.8, 0);
  monitor.userData.buildingId = "computer-desk";
  group.add(monitor);

  // Screen glow
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), screenGlow);
  screen.position.set(0, 1.8, 0.03);
  screen.userData.buildingId = "computer-desk";
  group.add(screen);

  return group;
}

function createSofa(): THREE.Group {
  const group = new THREE.Group();
  group.name = "building_sofa";
  group.userData.buildingId = "sofa";

  const sofaMat = new THREE.MeshStandardMaterial({ color: 0x6a5acd, roughness: 0.9 }); // 紫色沙發

  // Seat
  const seat = new THREE.Mesh(new THREE.BoxGeometry(4, 0.6, 1.5), sofaMat);
  seat.position.set(0, 0.5, 0);
  seat.castShadow = true;
  seat.userData.buildingId = "sofa";
  group.add(seat);

  // Back
  const back = new THREE.Mesh(new THREE.BoxGeometry(4, 1.2, 0.4), sofaMat);
  back.position.set(0, 1.1, -0.7);
  back.castShadow = true;
  back.userData.buildingId = "sofa";
  group.add(back);

  // Armrests
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 1.5), sofaMat);
    arm.position.set(side * 2.1, 0.7, 0);
    arm.userData.buildingId = "sofa";
    group.add(arm);
  }

  return group;
}

function createMeetingTable(): THREE.Group {
  const group = new THREE.Group();
  group.name = "building_meeting";
  group.userData.buildingId = "meeting-table";

  const tableMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.7 }); // 深木色
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.3, metalness: 0.5 });

  // 長條形桌面
  const tableTop = new THREE.Mesh(new THREE.BoxGeometry(6, 0.12, 2), tableMat);
  tableTop.position.set(0, 1.0, 0);
  tableTop.castShadow = true;
  tableTop.userData.buildingId = "meeting-table";
  group.add(tableTop);

  // 四隻桌腳
  for (const [x, z] of [[-2.5, -0.7], [2.5, -0.7], [-2.5, 0.7], [2.5, 0.7]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.0, 8), metalMat);
    leg.position.set(x, 0.5, z);
    leg.userData.buildingId = "meeting-table";
    group.add(leg);
  }

  // 可以加幾張椅子在旁邊
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 });
  const chairPositions = [
    [-2, -1.8], [0, -1.8], [2, -1.8],  // 前排
    [-2, 1.8], [0, 1.8], [2, 1.8],      // 後排
  ];
  
  for (const [cx, cz] of chairPositions) {
    // 椅座
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.6), chairMat);
    seat.position.set(cx, 0.55, cz);
    seat.userData.buildingId = "meeting-table";
    group.add(seat);
    
    // 椅背
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.08), chairMat);
    back.position.set(cx, 0.95, cz > 0 ? cz + 0.26 : cz - 0.26);
    back.userData.buildingId = "meeting-table";
    group.add(back);
  }

  return group;
}

function createTV(): THREE.Group {
  const group = new THREE.Group();
  group.name = "tv";

  const standMat = new THREE.MeshStandardMaterial({ color: 0x2c2c2c, roughness: 0.5 });
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.2 });
  const screenGlow = new THREE.MeshStandardMaterial({ 
    color: 0x87ceeb, 
    emissive: 0x4488aa, 
    emissiveIntensity: 0.4 
  });

  // 電視櫃
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(3, 0.6, 0.8), standMat);
  cabinet.position.set(0, 0.3, 0);
  cabinet.castShadow = true;
  group.add(cabinet);

  // 電視螢幕外框
  const tvFrame = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.5, 0.1), standMat);
  tvFrame.position.set(0, 1.45, 0);
  tvFrame.castShadow = true;
  group.add(tvFrame);

  // 電視螢幕（發光）
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.3), screenGlow);
  screen.position.set(0, 1.45, 0.06);
  group.add(screen);

  return group;
}

function createCoffeeTable(): THREE.Group {
  const group = new THREE.Group();
  group.name = "coffee_table";

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.7 });

  // 圓形桌面
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.08, 16), woodMat);
  top.position.set(0, 0.5, 0);
  top.castShadow = true;
  group.add(top);

  // 桌腳
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.5, 8), woodMat);
  leg.position.set(0, 0.25, 0);
  group.add(leg);

  // 底座
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 12), woodMat);
  base.position.set(0, 0.025, 0);
  group.add(base);

  return group;
}

function createPantry(): THREE.Group {
  const group = new THREE.Group();
  group.name = "building_pantry";
  group.userData.buildingId = "pantry";

  const counterMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }); // 白色檯面
  const cabinetMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.7 }); // 深木色櫃子
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, roughness: 0.2, metalness: 0.8 });

  // 吧檯
  const counter = new THREE.Mesh(new THREE.BoxGeometry(3, 0.15, 1.2), counterMat);
  counter.position.set(0, 1.1, 0);
  counter.castShadow = true;
  counter.userData.buildingId = "pantry";
  group.add(counter);

  // 底櫃
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(3, 1.1, 1.2), cabinetMat);
  cabinet.position.set(0, 0.55, 0);
  cabinet.castShadow = true;
  cabinet.userData.buildingId = "pantry";
  group.add(cabinet);

  // 咖啡機
  const coffeeMachine = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.4), metalMat);
  coffeeMachine.position.set(-0.8, 1.45, 0);
  coffeeMachine.userData.buildingId = "pantry";
  group.add(coffeeMachine);

  // 杯子
  const cupMat = new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.5 });
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.25, 8), cupMat);
  cup.position.set(0.5, 1.25, 0);
  cup.userData.buildingId = "pantry";
  group.add(cup);

  return group;
}

function createEntrance(): THREE.Group {
  const group = new THREE.Group();
  group.name = "building_entrance";
  group.userData.buildingId = "entrance";

  // 歡迎地墊
  const matMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.9 });
  const welcomeMat = new THREE.Mesh(new THREE.BoxGeometry(3, 0.05, 2), matMat);
  welcomeMat.position.set(0, 0.025, 0);
  welcomeMat.userData.buildingId = "entrance";
  group.add(welcomeMat);

  // 指示牌
  const signMat = new THREE.MeshStandardMaterial({ color: 0x2196f3, roughness: 0.5 });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2, 0.8), signMat);
  sign.position.set(1.8, 1, 0);
  sign.userData.buildingId = "entrance";
  group.add(sign);

  return group;
}

function createWhiteboard(): THREE.Group {
  const group = new THREE.Group();
  group.name = "building_whiteboard";
  group.userData.buildingId = "whiteboard";

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x424242, roughness: 0.4, metalness: 0.3 });
  const boardMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.2 });

  // Whiteboard surface
  const board = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.1), boardMat);
  board.position.set(0, 2.5, 0);
  board.castShadow = true;
  group.add(board);

  // Frame (4 edges)
  const frameW = 0.15;
  const topFrame = new THREE.Mesh(new THREE.BoxGeometry(6.3, frameW, 0.15), frameMat);
  topFrame.position.set(0, 4.05, 0);
  group.add(topFrame);
  const bottomFrame = new THREE.Mesh(new THREE.BoxGeometry(6.3, frameW, 0.15), frameMat);
  bottomFrame.position.set(0, 0.95, 0);
  group.add(bottomFrame);
  const leftFrame = new THREE.Mesh(new THREE.BoxGeometry(frameW, 3.25, 0.15), frameMat);
  leftFrame.position.set(-3.15, 2.5, 0);
  group.add(leftFrame);
  const rightFrame = new THREE.Mesh(new THREE.BoxGeometry(frameW, 3.25, 0.15), frameMat);
  rightFrame.position.set(3.15, 2.5, 0);
  group.add(rightFrame);

  // Marker tray
  const tray = new THREE.Mesh(new THREE.BoxGeometry(4, 0.08, 0.3), frameMat);
  tray.position.set(0, 0.9, 0.15);
  group.add(tray);

  // Colored markers on tray
  const markerColors = [0xe53935, 0x1e88e5, 0x43a047, 0xff8f00];
  for (let i = 0; i < markerColors.length; i++) {
    const marker = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6),
      new THREE.MeshStandardMaterial({ color: markerColors[i] })
    );
    marker.rotation.z = Math.PI / 2;
    marker.position.set(-1 + i * 0.7, 0.98, 0.15);
    group.add(marker);
  }

  // CSS2D label for task content (will be updated dynamically)
  const taskEl = document.createElement("div");
  taskEl.className = "whiteboard-tasks";
  taskEl.id = "whiteboard-tasks";
  const taskLabel = new CSS2DObject(taskEl);
  taskLabel.position.set(0, 2.5, 0.1);
  group.add(taskLabel);

  group.traverse((child) => { child.userData.buildingId = "whiteboard"; });

  return group;
}

function createPRBoard(): THREE.Group {
  const group = new THREE.Group();
  group.name = "building_pr-board";
  group.userData.buildingId = "pr-board";

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.4, metalness: 0.3 });
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.3 });

  // Stand (pole)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.5, 8), frameMat);
  pole.position.set(0, 1.75, 0);
  group.add(pole);

  // Base
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 16), frameMat);
  base.position.set(0, 0.05, 0);
  group.add(base);

  // Screen (dark board)
  const screen = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 0.08), boardMat);
  screen.position.set(0, 3, 0);
  screen.castShadow = true;
  group.add(screen);

  // Screen bezel
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x00bcd4, roughness: 0.5, emissive: 0x004d54, emissiveIntensity: 0.3 });
  const topBezel = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.06, 0.1), bezelMat);
  topBezel.position.set(0, 3.83, 0);
  group.add(topBezel);
  const bottomBezel = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.06, 0.1), bezelMat);
  bottomBezel.position.set(0, 2.17, 0);
  group.add(bottomBezel);

  // "PR" label via small colored blocks as decoration
  const labelMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00acc1, emissiveIntensity: 0.5 });
  const label = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.1), labelMat);
  label.position.set(0, 3.95, 0);
  group.add(label);

  group.traverse((child) => { child.userData.buildingId = "pr-board"; });
  return group;
}

function createMoltbookBoard(): THREE.Group {
  const group = new THREE.Group();
  group.name = "building_moltbook";
  group.userData.buildingId = "moltbook";

  // Posts (two wooden poles)
  const postMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.9 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.18, 5, 8),
      postMat
    );
    post.position.set(side * 1.8, 2.5, 0);
    post.castShadow = true;
    group.add(post);
  }

  // Board (main panel)
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x795548, roughness: 0.7 });
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(4, 3, 0.15),
    boardMat
  );
  board.position.set(0, 3.5, 0);
  board.castShadow = true;
  group.add(board);

  // Board frame
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.6 });
  const frameGeo = new THREE.BoxGeometry(4.3, 3.3, 0.1);
  const frame = new THREE.Mesh(frameGeo, frameMat);
  frame.position.set(0, 3.5, -0.1);
  group.add(frame);

  // Decorative sticky notes are added as 3D meshes in createBuildings()

  // "Moltbook" title on top
  const titleBg = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 0.5, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xff7043 })
  );
  titleBg.position.set(0, 5.2, 0);
  group.add(titleBg);

  // Small roof
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4e342e, roughness: 0.8 });
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(4.8, 0.2, 1),
    roofMat
  );
  roof.position.set(0, 5.5, 0);
  roof.castShadow = true;
  group.add(roof);

  // Mark all meshes as interactable
  group.traverse((child) => {
    child.userData.buildingId = "moltbook";
  });

  return group;
}

function createClawhubSchool(): THREE.Group {
  const group = new THREE.Group();
  group.name = "building_clawhub";
  group.userData.buildingId = "clawhub";

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.6 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.5 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x00bcd4, roughness: 0.3 });
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x4fc3f7,
    emissive: 0x0288d1,
    emissiveIntensity: 0.3,
    transparent: true,
    opacity: 0.8,
  });

  // Main building body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(8, 5, 6),
    wallMat
  );
  body.position.set(0, 2.5, 0);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Roof (pitched)
  const roofGeo = new THREE.ConeGeometry(5.5, 2, 4);
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.set(0, 6, 0);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  group.add(roof);

  // Door
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 2.5, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x5d4037 })
  );
  door.position.set(0, 1.25, 3.05);
  group.add(door);

  // Door accent (arch)
  const doorArch = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.3, 0.15),
    accentMat
  );
  doorArch.position.set(0, 2.6, 3.05);
  group.add(doorArch);

  // Windows (2 rows of 3)
  for (let row = 0; row < 2; row++) {
    for (let col = -1; col <= 1; col++) {
      if (row === 0 && col === 0) continue; // Door position
      const win = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 0.8),
        windowMat
      );
      win.position.set(col * 2.2, 1.5 + row * 2, 3.06);
      group.add(win);
    }
  }

  // Side windows
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const win = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 0.8),
        windowMat
      );
      win.position.set(side * 4.06, 2.5 + (i % 2) * 1.5, -1 + i * 1.5);
      win.rotation.y = side * Math.PI / 2;
      group.add(win);
    }
  }

  // "Clawhub" sign above door
  const signBg = new THREE.Mesh(
    new THREE.BoxGeometry(3.5, 0.7, 0.1),
    accentMat
  );
  signBg.position.set(0, 4.5, 3.06);
  group.add(signBg);

  // Flag pole on roof
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 2, 6),
    new THREE.MeshStandardMaterial({ color: 0x9e9e9e })
  );
  pole.position.set(0, 7.5, 0);
  group.add(pole);

  // Flag
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 0.6),
    new THREE.MeshStandardMaterial({ color: 0x00bcd4, side: THREE.DoubleSide })
  );
  flag.position.set(0.5, 8, 0);
  group.add(flag);

  // Mark all meshes as interactable
  group.traverse((child) => {
    child.userData.buildingId = "clawhub";
  });

  return group;
}

function createWorldsPortal(): THREE.Group {
  const group = new THREE.Group();
  group.name = "building_worlds_portal";
  group.userData.buildingId = "worlds-portal";

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x78909c, roughness: 0.7 });
  const portalMat = new THREE.MeshStandardMaterial({
    color: 0x7c4dff,
    emissive: 0x4527a0,
    emissiveIntensity: 0.4,
    transparent: true,
    opacity: 0.6,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xb388ff,
    emissive: 0x7c4dff,
    emissiveIntensity: 0.2,
  });

  // Stone arch (two pillars + top)
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 7, 1.2),
      stoneMat
    );
    pillar.position.set(side * 3, 3.5, 0);
    pillar.castShadow = true;
    group.add(pillar);

    // Pillar base
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.5, 1.8),
      stoneMat
    );
    base.position.set(side * 3, 0.25, 0);
    group.add(base);

    // Pillar cap
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.4, 1.6),
      stoneMat
    );
    cap.position.set(side * 3, 7.2, 0);
    group.add(cap);
  }

  // Top arch beam
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(7.5, 1, 1.2),
    stoneMat
  );
  beam.position.set(0, 7.5, 0);
  beam.castShadow = true;
  group.add(beam);

  // Portal surface (glowing plane)
  const portalPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(4.8, 6.5),
    portalMat
  );
  portalPlane.position.set(0, 3.5, 0);
  group.add(portalPlane);

  // Portal back side
  const portalBack = new THREE.Mesh(
    new THREE.PlaneGeometry(4.8, 6.5),
    portalMat
  );
  portalBack.position.set(0, 3.5, -0.01);
  portalBack.rotation.y = Math.PI;
  group.add(portalBack);

  // Decorative runes on pillars
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const rune = new THREE.Mesh(
        new THREE.PlaneGeometry(0.4, 0.4),
        accentMat
      );
      rune.position.set(side * 3, 2 + i * 1.8, 0.65);
      group.add(rune);
    }
  }

  // Glowing orb on top
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 16, 12),
    new THREE.MeshStandardMaterial({
      color: 0xb388ff,
      emissive: 0x7c4dff,
      emissiveIntensity: 0.8,
    })
  );
  orb.position.set(0, 8.3, 0);
  group.add(orb);

  // Platform base
  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(4, 4.5, 0.4, 8),
    stoneMat
  );
  platform.position.set(0, 0.2, 0);
  platform.receiveShadow = true;
  group.add(platform);

  // Mark all meshes as interactable
  group.traverse((child) => {
    child.userData.buildingId = "worlds-portal";
  });

  return group;
}
