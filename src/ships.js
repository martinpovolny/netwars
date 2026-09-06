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

export function makeDart(accent = 0xff4040, bulk = 1) {
  const g = new THREE.Group();
  const geo = dartGeometry(bulk);

  const hull = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0xc6cdd6, flatShading: true, roughness: 0.7, side: THREE.DoubleSide })
  );
  g.add(hull);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 18),
    new THREE.LineBasicMaterial({ color: 0xeef2f6 })
  );
  g.add(edges);

  const canopy = new THREE.Mesh(
    new THREE.ConeGeometry(1.7 * bulk, 6 * bulk, 4),
    new THREE.MeshStandardMaterial({ color: accent, flatShading: true, roughness: 0.4 })
  );
  canopy.rotation.x = -Math.PI / 2;
  canopy.position.set(0, 1.6 * bulk, -3 * bulk);
  canopy.scale.set(1, 0.6, 1.7);
  g.add(canopy);

  const stripeGeo = new THREE.BoxGeometry(0.8 * bulk, 0.8 * bulk, 22 * bulk);
  for (const sx of [-1, 1]) {
    const s = new THREE.Mesh(stripeGeo, new THREE.MeshStandardMaterial({ color: accent, flatShading: true, roughness: 0.4 }));
    s.position.set(sx * 6 * bulk, -1 * bulk, 3 * bulk);
    s.rotation.y = -sx * 0.5;
    g.add(s);
  }

  return g;
}

// Pink faceted pod with little white antenna spikes (NetWars "pods").
export function makePod() {
  const g = new THREE.Group();
  const geo = new THREE.OctahedronGeometry(9, 0);
  const body = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0xd93bd0, flatShading: true, emissive: 0x3a0038, roughness: 0.6 })
  );
  g.add(body);
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffa8f0 })));

  const pts = [];
  for (const v of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    pts.push(v[0] * 9, v[1] * 9, v[2] * 9, v[0] * 14, v[1] * 14, v[2] * 14);
  }
  const ag = new THREE.BufferGeometry();
  ag.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(ag, new THREE.LineBasicMaterial({ color: 0xffffff })));

  return g;
}
