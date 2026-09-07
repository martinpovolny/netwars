import * as THREE from 'three';

// --- hand-built low-poly dart -------------------------------------------------
// nose points -Z. Vertices chosen to give a sleek faceted fuselage + swept
// delta wings + a tail fin, like the NetWars ship-select shapes.
const V = [
  [0.0, 0.0, -20],   // 0  nose
  [0.0, 3.5, -4],    // 1  spine top, front
  [-4.0, -2.0, -4],  // 2  hip L, front
  [4.0, -2.0, -4],   // 3  hip R, front
  [0.0, 3.0, 12],    // 4  spine top, back
  [-4.5, -2.5, 12],  // 5  hip L, back
  [4.5, -2.5, 12],   // 6  hip R, back
  [-17.0, -1.0, 8],  // 7  wing tip L
  [17.0, -1.0, 8],   // 8  wing tip R
  [-4.0, -1.5, 13],  // 9  wing root back L
  [4.0, -1.5, 13],   // 10 wing root back R
  [0.0, 8.5, 11],    // 11 fin tip
  [0.0, -1.0, 13],   // 12 tail bottom
];
const TRIS = [
  [0, 1, 2], [0, 3, 1], [0, 2, 3],          // nose
  [1, 4, 5], [1, 5, 2],                      // body left
  [3, 1, 4], [3, 4, 6],                      // body right
  [2, 5, 6], [2, 6, 3],                      // belly
  [4, 6, 5],                                 // tail cap
  [2, 5, 9], [2, 9, 7],                      // wing L
  [3, 6, 10], [3, 10, 8],                    // wing R
  [4, 11, 12],                               // fin
];

// global size multiplier — NetWars ships loom large and fights are close
export const SHIP_SCALE = 2.0;

const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _w = new THREE.Color(0xffffff);
function mix(base, accent, amount) {
  return _c.set(base).lerp(_c2.set(accent), amount).getHex();
}
function bright(accent, amount = 0.5) {
  return _c.set(accent).lerp(_w, amount).getHex();
}

function dartGeometry(scale) {
  const pos = [];
  for (const [a, b, c] of TRIS) {
    for (const idx of [a, b, c]) {
      pos.push(V[idx][0] * scale, V[idx][1] * scale, V[idx][2] * scale);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// swept-delta interceptor — hull strongly tinted toward the class accent
export function makeDart(accent = 0xff4040, bulk = 1) {
  const g = new THREE.Group();
  const sc = bulk * SHIP_SCALE;
  const geo = dartGeometry(sc);

  const hull = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: mix(0xc6cdd6, accent, 0.42), flatShading: true, roughness: 0.65, side: THREE.DoubleSide })
  );
  g.add(hull);

  g.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 18),
    new THREE.LineBasicMaterial({ color: bright(accent, 0.55) })
  ));

  const trim = new THREE.MeshStandardMaterial({ color: accent, flatShading: true, roughness: 0.35, emissive: mix(0x000000, accent, 0.25) });

  const canopy = new THREE.Mesh(new THREE.ConeGeometry(2.0 * sc, 7 * sc, 4), trim);
  canopy.rotation.x = -Math.PI / 2;
  canopy.position.set(0, 1.7 * sc, -3 * sc);
  canopy.scale.set(1, 0.6, 1.8);
  g.add(canopy);

  const stripeGeo = new THREE.BoxGeometry(1.1 * sc, 1.0 * sc, 24 * sc);
  for (const sx of [-1, 1]) {
    const s = new THREE.Mesh(stripeGeo, trim);
    s.position.set(sx * 7 * sc, -1 * sc, 3 * sc);
    s.rotation.y = -sx * 0.5;
    g.add(s);
  }

  return g;
}

// distant-fire sniper — a long needle with a prominent forward gun barrel and
// a rear fin cluster. Deliberately a very different silhouette from the dart.
export function makeSniper(accent = 0x3a6bff, bulk = 1.2) {
  const g = new THREE.Group();
  const sc = bulk * SHIP_SCALE;
  const hullMat = new THREE.MeshStandardMaterial({ color: mix(0xb9c0c9, accent, 0.5), flatShading: true, roughness: 0.6, side: THREE.DoubleSide });

  // slender fuselage
  const bodyGeo = new THREE.CylinderGeometry(2.4 * sc, 1.0 * sc, 30 * sc, 6);
  bodyGeo.rotateX(-Math.PI / 2);
  const hull = new THREE.Mesh(bodyGeo, hullMat);
  hull.position.z = 2 * sc;
  g.add(hull);
  const hullEdges = new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeo, 20), new THREE.LineBasicMaterial({ color: bright(accent, 0.6) }));
  hullEdges.position.z = 2 * sc;
  g.add(hullEdges);

  // chunky central hub — gives the ship mass head-on and tail-on
  const hubGeo = new THREE.IcosahedronGeometry(6.5 * sc, 0);
  hubGeo.scale(1.35, 1.0, 0.8);
  const hub = new THREE.Mesh(hubGeo, hullMat);
  hub.position.z = 3 * sc;
  g.add(hub);
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(hubGeo, 8), new THREE.LineBasicMaterial({ color: bright(accent, 0.55) })));
  g.children[g.children.length - 1].position.z = 3 * sc;

  // forward gun barrel + glowing muzzle ring
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6 * sc, 2.1 * sc, 26 * sc, 8),
    new THREE.MeshStandardMaterial({ color: 0x6a7078, flatShading: true, roughness: 0.55 })
  );
  barrel.rotation.x = -Math.PI / 2;
  barrel.position.z = -22 * sc;
  g.add(barrel);
  const muzzle = new THREE.Mesh(
    new THREE.TorusGeometry(2.4 * sc, 0.8 * sc, 6, 14),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.9, flatShading: true })
  );
  muzzle.position.z = -35 * sc;
  g.add(muzzle);

  // rear engine block + glow disc
  const eng = new THREE.Mesh(new THREE.CylinderGeometry(4.5 * sc, 3.4 * sc, 7 * sc, 6), hullMat);
  eng.rotation.x = -Math.PI / 2;
  eng.position.z = 18 * sc;
  g.add(eng);
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(3.4 * sc, 12),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  );
  glow.position.z = 21.6 * sc;
  g.add(glow);

  // bigger rear stabiliser fin cluster (4 blades)
  const finGeo = new THREE.BoxGeometry(0.6 * sc, 14 * sc, 10 * sc);
  const finMat = new THREE.MeshStandardMaterial({ color: mix(0x8b939c, accent, 0.4), flatShading: true, roughness: 0.7 });
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(finGeo, finMat);
    fin.position.z = 14 * sc;
    fin.rotation.z = i * Math.PI / 2;
    fin.translateY(8 * sc);
    g.add(fin);
  }

  return g;
}

// Collectible bonus pod. kind: 'missiles' (cyan) | 'repair' (green).
// A slowly spinning octahedron with a bright inner core and an orbit ring.
export function makeBonus(kind) {
  const col = kind === 'repair' ? 0x2fe06a : 0x3ad0ff;
  const g = new THREE.Group();

  const shell = new THREE.Mesh(
    new THREE.OctahedronGeometry(11, 0),
    new THREE.MeshStandardMaterial({ color: col, flatShading: true, emissive: col, emissiveIntensity: 0.35, transparent: true, opacity: 0.55, roughness: 0.4 })
  );
  g.add(shell);
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(shell.geometry), new THREE.LineBasicMaterial({ color: bright(col, 0.5) })));

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(4.5, 0),
    new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
  );
  g.add(core);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(15, 0.7, 6, 20),
    new THREE.MeshBasicMaterial({ color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 })
  );
  ring.rotation.x = Math.PI / 2.3;
  g.add(ring);
  g.userData.ring = ring;

  // a tiny glyph so the two kinds read differently up close
  const glyphMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  if (kind === 'repair') {
    const v = new THREE.Mesh(new THREE.BoxGeometry(2, 8, 2), glyphMat);
    const h = new THREE.Mesh(new THREE.BoxGeometry(8, 2, 2), glyphMat);
    g.add(v, h);
  } else {
    const rocket = new THREE.Mesh(new THREE.ConeGeometry(2, 9, 6), glyphMat);
    rocket.rotation.x = -Math.PI / 2;
    g.add(rocket);
  }

  return g;
}

// Pink faceted pod with little white antenna spikes (NetWars "pods").
export function makePod() {
  const g = new THREE.Group();
  const R = 22;
  const geo = new THREE.OctahedronGeometry(R, 0);
  const body = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0xd93bd0, flatShading: true, emissive: 0x3a0038, roughness: 0.6 })
  );
  g.add(body);
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffa8f0 })));

  const pts = [];
  for (const v of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    pts.push(v[0] * R, v[1] * R, v[2] * R, v[0] * R * 1.6, v[1] * R * 1.6, v[2] * R * 1.6);
  }
  const ag = new THREE.BufferGeometry();
  ag.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(ag, new THREE.LineBasicMaterial({ color: 0xffffff })));

  return g;
}
