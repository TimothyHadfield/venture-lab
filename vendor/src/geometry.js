// geometry.js — Cone perspective projection math for card hand rendering

// === CONE PERSPECTIVE PROJECTION ===
// Coordinate system:
//   X = screen horizontal (parallel to vw)
//   Y = screen vertical (parallel to vh, positive = down)
//   Z = depth (perpendicular to screen, screen plane at z=h)
//
// Cone:
//   Apex at origin (0, 0, 0)
//   Cone axis along +Z
//   Rim: circle of radius R in X-Y plane at z=h
//     Rim point at angle φ: (R·sin(φ), R·cos(φ), h)
//     φ=0 → (0, R, h) = fan center (bottom of rim circle)
//     φ>0 → card moves right, φ<0 → left
//   Slant height: sqrt(R² + h²), with R=h → R·√2
//
// POV: (0, 0, h+d) — on cone axis, distance d beyond screen plane
// Constants: R = h = d = min(vw, vh)
// Card aspect: cardW = cardH * 0.618

function conePoint(R, h, slantH, phi, t) {
  // Point on cone surface at rim angle phi, distance t down slant from rim toward apex
  // frac=1 at rim, frac=0 at apex
  const frac = 1 - t / slantH;
  return {
    x: R * frac * Math.sin(phi),   // horizontal spread (screen X)
    y: R * frac * Math.cos(phi),   // vertical position (screen Y)
    z: h * frac                     // depth along cone axis
  };
}

function coneProject(p, POV, focalLength) {
  // View-space projection: project onto plane perpendicular to line of sight
  // (POV looking at fan center on rim), not onto the z=h screen plane.
  // This way the center card appears at its true size.
  //
  // With R=h=d, view direction = (0, 1/√2, -1/√2)
  // View basis: right=(1,0,0), up=(0,-1/√2,-1/√2), forward=(0,1/√2,-1/√2)
  const dx = p.x - POV.x;
  const dy = p.y - POV.y;
  const dz = p.z - POV.z;
  const S = Math.SQRT1_2;  // 1/√2
  const viewX = dx;                   // horizontal (unchanged)
  const viewY = -(dy + dz) * S;       // up component (positive = down on screen)
  const viewZ = (dy - dz) * S;        // depth toward scene (positive = in front of camera)
  if (viewZ <= 0) return null;
  return {
    x: viewX * (focalLength / viewZ),
    y: viewY * (focalLength / viewZ)
  };
}

function squareToQuad(x0,y0,x1,y1,x2,y2,x3,y3) {
  const dx1=x1-x3, dx2=x2-x3, dx3=x0-x1+x3-x2;
  const dy1=y1-y3, dy2=y2-y3, dy3=y0-y1+y3-y2;
  const det=dx1*dy2-dx2*dy1;
  if (Math.abs(det)<1e-10) return null;
  const g=(dx3*dy2-dx2*dy3)/det;
  const hh=(dx1*dy3-dx3*dy1)/det;
  return [x1-x0+g*x1,x2-x0+hh*x2,x0, y1-y0+g*y1,y2-y0+hh*y2,y0, g,hh,1];
}

function adjugate3x3(m) {
  return [
    m[4]*m[8]-m[5]*m[7], m[2]*m[7]-m[1]*m[8], m[1]*m[5]-m[2]*m[4],
    m[5]*m[6]-m[3]*m[8], m[0]*m[8]-m[2]*m[6], m[2]*m[3]-m[0]*m[5],
    m[3]*m[7]-m[4]*m[6], m[1]*m[6]-m[0]*m[7], m[0]*m[4]-m[1]*m[3]
  ];
}

function multiply3x3(a,b) {
  return [
    a[0]*b[0]+a[1]*b[3]+a[2]*b[6], a[0]*b[1]+a[1]*b[4]+a[2]*b[7], a[0]*b[2]+a[1]*b[5]+a[2]*b[8],
    a[3]*b[0]+a[4]*b[3]+a[5]*b[6], a[3]*b[1]+a[4]*b[4]+a[5]*b[7], a[3]*b[2]+a[4]*b[5]+a[5]*b[8],
    a[6]*b[0]+a[7]*b[3]+a[8]*b[6], a[6]*b[1]+a[7]*b[4]+a[8]*b[7], a[6]*b[2]+a[7]*b[5]+a[8]*b[8]
  ];
}

function computeHomography(sx0,sy0,sx1,sy1,sx2,sy2,sx3,sy3,dx0,dy0,dx1,dy1,dx2,dy2,dx3,dy3) {
  const srcInv = adjugate3x3(squareToQuad(sx0,sy0,sx1,sy1,sx2,sy2,sx3,sy3));
  const dstM = squareToQuad(dx0,dy0,dx1,dy1,dx2,dy2,dx3,dy3);
  if (!srcInv || !dstM) return null;
  return multiply3x3(dstM, srcInv);
}

// `dims` (optional) overrides the CSS-var card size — the layout solver passes
// its in-progress cardW/cardH to MEASURE the fan height while solving (the CSS
// vars aren't set yet). Live callers omit it and read the current vars.
function computeCone(n, containerW, dims) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = dims ? dims.cardW : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-w'));
  const cardH = dims ? dims.cardH : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-h'));

  // R = h = d = short side of display
  const R = Math.min(vw, vh);
  const h = R;
  const d = R;
  const slantH = R * Math.SQRT2;  // sqrt(R² + h²) with R=h

  // POV: on cone axis, distance h+d along Z (mirrored apex)
  const POV = { x: 0, y: 0, z: h + d };

  // Card dimensions on the cone surface
  const cardWRad = cardW / R;
  const cardHSlant = cardH;  // same units as cardW on the arc (matches prototype)

  // Focal length = distance from POV to fan center = R√2 (with R=h=d)
  // This makes the center card project at 1:1 pixel size
  const focalLen = R * Math.SQRT2;

  // Derive spacing from available screen width
  const usableW = containerW * 0.88;

  // Binary search: find arc span whose projection fills usableW
  function projectedWidth(totalArcRad) {
    const halfArc = totalArcRad / 2;
    // Rim points at ±halfArc: (R·sin(φ), R·cos(φ), h)
    const pLeft = coneProject(
      { x: R * Math.sin(-halfArc), y: R * Math.cos(-halfArc), z: h }, POV, focalLen
    );
    const pRight = coneProject(
      { x: R * Math.sin(halfArc), y: R * Math.cos(halfArc), z: h }, POV, focalLen
    );
    if (!pLeft || !pRight) return Infinity;
    return pRight.x - pLeft.x;
  }

  let lo = 0, hi = Math.PI / 2;
  for (let iter = 0; iter < 30; iter++) {
    const mid = (lo + hi) / 2;
    if (projectedWidth(mid) < usableW) lo = mid; else hi = mid;
  }
  const maxArcRad = lo;

  // Step = spacing between card centers in radians
  let stepRad;
  if (n <= 1) {
    stepRad = 0;
  } else {
    stepRad = (maxArcRad - cardWRad) / (n - 1);
    // Widest spread (least overlap): keep at least MIN_OVERLAP between neighbours
    // so the hand always reads as an overlapping fan, but otherwise let cards use
    // the available width so more of each card shows. (Was lvl(2) step ≈ lvl(3)
    // overlap; now a smaller φ⁴ overlap sliver → wider spread.)
    const minOverlapPx = lvl(4, cardH);
    const maxStepPx = cardW - minOverlapPx;
    stepRad = Math.min(stepRad, maxStepPx / R);
    // Min step for very full hands
    stepRad = Math.max(stepRad, cardWRad * 0.3);
  }

  return { cardW, cardH, R, h, d, slantH, POV, cardWRad, cardHSlant, stepRad, containerW, focalLen };
}

// DRY hand positioning function - extracts repeated cone projection logic
function computeHandCardCorners(cardIndex, totalCards, coneParams) {
  const {R, h, slantH, cardWRad, cardHSlant, stepRad, POV, focalLen} = coneParams;
  
  // Calculate card angle from center
  const phi = (cardIndex - (totalCards - 1) / 2) * stepRad;
  
  // Get card's four 3D corners
  const tl = conePoint(R, h, slantH, phi - cardWRad/2, 0);
  const tr = conePoint(R, h, slantH, phi + cardWRad/2, 0);
  const bl = conePoint(R, h, slantH, phi - cardWRad/2, cardHSlant);
  const br = conePoint(R, h, slantH, phi + cardWRad/2, cardHSlant);
  
  // Project to 2D screen coordinates
  const ptl = coneProject(tl, POV, focalLen);
  const ptr = coneProject(tr, POV, focalLen);
  const pbl = coneProject(bl, POV, focalLen);
  const pbr = coneProject(br, POV, focalLen);
  
  // Return null if any projection failed
  if (!ptl || !ptr || !pbl || !pbr) return null;
  
  return {
    TL: ptl,
    TR: ptr,
    BL: pbl,
    BR: pbr,
    // Additional data for bounding box calculations
    corners: [ptl, ptr, pbl, pbr]
  };
}
