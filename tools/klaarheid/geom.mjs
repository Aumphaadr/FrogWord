// Точная геометрия иконок: отрезки и дуги окружностей, без приближений до самого вывода.
// Исходник иконки — осевые линии (пути из отрезков и дуг) с толщиной w и круглыми концами и
// стыками. Отсюда: (1) обводка — сам путь; (2) контур заливкой — смещение на ±w/2 со стыками и
// торцами-дугами и объединение деталей. Дуги выводятся только при записи SVG: режутся на
// экстремумах (0°, 90°, 180°, 270°), каждый кусок — кубика с рычагами 4/3·tg(θ/4)·r по касательной.
//
// Углы — как в SVG: 0° вправо, 90° вниз; положительный размах дуги — по часовой на экране.

export const TAU = Math.PI * 2;
const RAD = Math.PI / 180;
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const mul = (a, k) => [a[0] * k, a[1] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len = (a) => Math.hypot(a[0], a[1]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const norm = (a) => { const l = len(a); return [a[0] / l, a[1] / l]; };
const leftN = (t) => [-t[1], t[0]];
const ang = (v) => Math.atan2(v[1], v[0]);
const onCircle = (c, r, th) => [c[0] + r * Math.cos(th), c[1] + r * Math.sin(th)];
const POS = 1e-9; // допуск на координаты
const same = (a, b, tol = 1e-7) => dist(a, b) < tol;

// ---------- рёбра ----------
export const L = (a, b) => ({ t: 'L', a, b });
// kind: 'main' — дуга самой фигуры (узлы на осях); 'cap', 'join', 'fillet' — торец, стык, скругление
// угла: их режем на равные куски симметрично середине дуги
export const A = (c, r, a0, da, kind = 'main') => ({ t: 'A', c, r, a0, da, kind });
export const startOf = (e) => (e.t === 'L' ? e.a : onCircle(e.c, e.r, e.a0));
export const endOf = (e) => (e.t === 'L' ? e.b : onCircle(e.c, e.r, e.a0 + e.da));
export const pointAt = (e, t) => (e.t === 'L' ? add(e.a, mul(sub(e.b, e.a), t)) : onCircle(e.c, e.r, e.a0 + e.da * t));
export function tangentAt(e, t) {
  if (e.t === 'L') return norm(sub(e.b, e.a));
  const th = e.a0 + e.da * t, s = Math.sign(e.da);
  return [-Math.sin(th) * s, Math.cos(th) * s];
}
export const reverseEdge = (e) => (e.t === 'L' ? L(e.b, e.a) : A(e.c, e.r, e.a0 + e.da, -e.da, e.kind));
export const edgeLen = (e) => (e.t === 'L' ? dist(e.a, e.b) : Math.abs(e.da) * e.r);

// параметр точки на дуге (0 — начало, 1 — конец) или null, если точка вне дуги
function arcParam(e, p, tol = 1e-9) {
  const th = ang(sub(p, e.c));
  const tolA = tol / e.r;
  let d = th - e.a0;
  if (e.da > 0) {
    d = ((d % TAU) + TAU) % TAU;
    if (d > e.da + tolA && d > TAU - tolA) d -= TAU;
  } else {
    d = -((((-d) % TAU) + TAU) % TAU);
    if (d < e.da - tolA && d < -TAU + tolA) d += TAU;
  }
  const t = d / e.da;
  return t >= -tol && t <= 1 + tol ? Math.min(1, Math.max(0, t)) : null;
}
function lineParam(e, p) {
  const d = sub(e.b, e.a);
  return dot(sub(p, e.a), d) / dot(d, d);
}
export function subEdge(e, t0, t1) {
  if (e.t === 'L') return L(pointAt(e, t0), pointAt(e, t1));
  return A(e.c, e.r, e.a0 + e.da * t0, e.da * (t1 - t0), e.kind);
}
function distToEdge(p, e) {
  if (e.t === 'L') {
    const d = sub(e.b, e.a), l2 = dot(d, d);
    const t = l2 ? Math.max(0, Math.min(1, dot(sub(p, e.a), d) / l2)) : 0;
    return dist(p, add(e.a, mul(d, t)));
  }
  if (arcParam(e, p, 0) !== null) return Math.abs(dist(p, e.c) - e.r);
  return Math.min(dist(p, startOf(e)), dist(p, endOf(e)));
}
export const distToEdges = (p, edges) => Math.min(...edges.map((e) => distToEdge(p, e)));

// площадь со знаком (∫ x dy − y dx / 2): у внешних контуров она положительна
function edgeArea(e) {
  if (e.t === 'L') return (e.a[0] * e.b[1] - e.b[0] * e.a[1]) / 2;
  const t0 = e.a0, t1 = e.a0 + e.da;
  return 0.5 * (e.r * e.r * e.da + e.r * (e.c[0] * (Math.sin(t1) - Math.sin(t0)) - e.c[1] * (Math.cos(t1) - Math.cos(t0))));
}
export const loopArea = (loop) => loop.reduce((s, e) => s + edgeArea(e), 0);
export const reverseLoop = (loop) => loop.slice().reverse().map(reverseEdge);

// ---------- пути (осевые линии) ----------
function checkChain(edges, closed) {
  for (let i = 0; i + 1 < edges.length; i++) if (!same(endOf(edges[i]), startOf(edges[i + 1]), 1e-6)) throw new Error(`путь рвётся после ребра ${i}`);
  if (closed && !same(endOf(edges[edges.length - 1]), startOf(edges[0]), 1e-6)) throw new Error('замкнутый путь не замкнут');
}
export function path(edges, closed = false, prim = null) { checkChain(edges, closed); return { edges, closed, prim }; }
export const line = (a, b) => path([L(a, b)], false, { kind: 'line', a, b });
// дуга: центр, радиус, начальный угол и размах в градусах (+ — по часовой)
export const arc = (c, r, a0, sweep) => A(c, r, a0 * RAD, sweep * RAD);
export const circle = (c, r) => path([A(c, r, -Math.PI / 2, Math.PI), A(c, r, Math.PI / 2, Math.PI)], true, { kind: 'circle', c, r });

// ломаная со скруглением углов (радиус осевой линии; число или массив по вершинам)
export function polyline(pts, { closed = false, r = 0 } = {}) {
  const n = pts.length, radius = (i) => (Array.isArray(r) ? r[i] : r);
  const corners = pts.map((V, i) => {
    const R = !closed && (i === 0 || i === n - 1) ? 0 : radius(i);
    if (!R) return { in: V, out: V, arc: null };
    const P = pts[(i - 1 + n) % n], Q = pts[(i + 1) % n];
    const u1 = norm(sub(P, V)), u2 = norm(sub(Q, V));
    const phi = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
    const tl = R / Math.tan(phi / 2);
    const T1 = add(V, mul(u1, tl)), T2 = add(V, mul(u2, tl));
    const C = add(V, mul(norm(add(u1, u2)), R / Math.sin(phi / 2)));
    const d1 = norm(sub(V, P)), d2 = norm(sub(Q, V));
    const turn = Math.atan2(cross(d1, d2), dot(d1, d2));
    return { in: T1, out: T2, arc: A(C, R, ang(sub(T1, C)), turn, 'fillet') };
  });
  const edges = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    // скругления соседних углов не должны заходить друг за друга: иначе ребро между ними развернётся
    if (dot(sub(corners[j].in, corners[i].out), sub(pts[j], pts[i])) < -1e-9) throw new Error(`скругления не помещаются на ребре ${i}→${j}`);
    if (!same(corners[i].out, corners[j].in, 1e-12)) edges.push(L(corners[i].out, corners[j].in));
    if (corners[j].arc && (closed || j !== n - 1)) edges.push(corners[j].arc);
  }
  return path(edges, closed, { kind: 'polyline', pts, r });
}
// путь из кусков: рёбра, дуги и ломаные (их рёбра) подряд
export function chainPath(parts, closed = false) {
  const edges = parts.flatMap((p) => (p.edges ? p.edges : [p]));
  return path(edges, closed);
}
// прямоугольник со скруглением (осевая линия)
export function rect(x, y, w, h, r = 0) {
  const p = polyline([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], { closed: true, r });
  p.prim = { kind: 'rect', x, y, w, h, r };
  return p;
}

// ---------- вырез кругом: бейджи и заслонённое ----------
// Путь без всего, что ближе R к точке C: возвращает массив открытых путей. Бейдж в углу — круг видимого
// радиуса ρ, основа вырезается по R = ρ + 3 (просвет 2 + полтолщины), так концы обрезков встают с тем же
// просветом, что у других вырезов.
// Вырезы. Функция интервалов возвращает для ребра куски [t0, t1] вне вырезаемой области;
// cutPathWith собирает из них открытые пути (у замкнутого пути кусок через начало склеивается).
function outsideIntervals(e, C, R) {
  const roots = [];
  if (e.t === 'L') {
    const d = sub(e.b, e.a), f = sub(e.a, C), A2 = dot(d, d), B2 = 2 * dot(f, d), C2 = dot(f, f) - R * R, disc = B2 * B2 - 4 * A2 * C2;
    if (disc > 0) for (const t of [(-B2 - Math.sqrt(disc)) / (2 * A2), (-B2 + Math.sqrt(disc)) / (2 * A2)]) if (t > 1e-9 && t < 1 - 1e-9) roots.push(t);
  } else {
    const dv = sub(e.c, C), d = len(dv);
    if (d > 1e-12) {
      const k = (R * R - d * d - e.r * e.r) / (2 * e.r * d);
      if (k > -1 && k < 1) {
        const phi = ang(dv), w = Math.acos(k);
        for (const th of [phi + w, phi - w]) for (let n = -3; n <= 3; n++) {
          const t = (th + n * TAU - e.a0) / e.da;
          if (t > 1e-9 && t < 1 - 1e-9) roots.push(t);
        }
      }
    }
  }
  const ts = [0, ...roots.sort((a, b) => a - b), 1], out = [];
  for (let i = 0; i + 1 < ts.length; i++) if (ts[i + 1] - ts[i] > 1e-9 && dist(pointAt(e, (ts[i] + ts[i + 1]) / 2), C) >= R) out.push([ts[i], ts[i + 1]]);
  return out;
}
// полоса s0 < n·(X − P0) < s1 (n — единичная нормаль): вырез вдоль косой черты
function outsideStripIntervals(e, P0, n, s0, s1) {
  const roots = [], sAt = (q) => dot(n, sub(q, P0));
  if (e.t === 'L') {
    const sa = sAt(e.a), ds = sAt(e.b) - sa;
    if (Math.abs(ds) > 1e-12) for (const sv of [s0, s1]) { const t = (sv - sa) / ds; if (t > 1e-9 && t < 1 - 1e-9) roots.push(t); }
  } else {
    const k = sAt(e.c), phi = ang(n);
    for (const sv of [s0, s1]) {
      const q = (sv - k) / e.r;
      if (q > -1 && q < 1) {
        const w = Math.acos(q);
        for (const th of [phi + w, phi - w]) for (let m = -3; m <= 3; m++) {
          const t = (th + m * TAU - e.a0) / e.da;
          if (t > 1e-9 && t < 1 - 1e-9) roots.push(t);
        }
      }
    }
  }
  const ts = [0, ...roots.sort((a, b) => a - b), 1], out = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    if (ts[i + 1] - ts[i] <= 1e-9) continue;
    const sm = sAt(pointAt(e, (ts[i] + ts[i + 1]) / 2));
    if (sm <= s0 || sm >= s1) out.push([ts[i], ts[i + 1]]);
  }
  return out;
}
// произвольная область inside(q) → расстояние со знаком (< 0 — внутри): корни — перебором и делением пополам
function outsideRegionIntervals(e, f) {
  const N = 480, roots = [], g = (t) => f(pointAt(e, t));
  let t0 = 0, v0 = g(0);
  for (let i = 1; i <= N; i++) {
    const t1 = i / N, v1 = g(t1);
    if ((v0 < 0) !== (v1 < 0)) { let a = t0, b = t1, va = v0; for (let k = 0; k < 60; k++) { const m = (a + b) / 2, vm = g(m); if ((vm < 0) === (va < 0)) { a = m; va = vm; } else b = m; } const r = (a + b) / 2; if (r > 1e-9 && r < 1 - 1e-9) roots.push(r); }
    t0 = t1; v0 = v1;
  }
  const ts = [0, ...roots, 1], out = [];
  for (let i = 0; i + 1 < ts.length; i++) if (ts[i + 1] - ts[i] > 1e-9 && g((ts[i] + ts[i + 1]) / 2) >= 0) out.push([ts[i], ts[i + 1]]);
  return out;
}
export const cutPath = (p, C, R) => cutPathWith(p, (e) => outsideIntervals(e, C, R));
// вырез областью, заданной расстоянием со знаком (например, капсула вокруг отрезка)
export const cutPathRegion = (p, f) => cutPathWith(p, (e) => outsideRegionIntervals(e, f));
// расстояние до отрезка ab минус d: область «капсула»
export const capsuleRegion = (a, b, d) => (q) => {
  const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(q, a), ab) / dot(ab, ab)));
  return dist(q, add(a, mul(ab, t))) - d;
};
export const cutPathStrip = (p, P0, n, s0, s1) => cutPathWith(p, (e) => outsideStripIntervals(e, P0, n, s0, s1));
function cutPathWith(p, intervals) {
  const pieces = [];
  let cur = null;
  const flush = () => { if (cur && cur.length) pieces.push(cur); cur = null; };
  p.edges.forEach((e) => {
    for (const [t0, t1] of intervals(e)) {
      const s = subEdge(e, t0, t1);
      if (t0 > 1e-9) flush();
      (cur ??= []).push(s);
      if (t1 < 1 - 1e-9) flush();
    }
  });
  flush();
  // замкнутый путь: кусок, что проходит через начало, склеить из конца и начала
  if (p.closed && pieces.length > 1 && same(endOf(pieces[pieces.length - 1].at(-1)), startOf(pieces[0][0]), 1e-9)) {
    pieces[0] = [...pieces.pop(), ...pieces[0]];
  }
  if (p.closed && pieces.length === 1 && same(endOf(pieces[0].at(-1)), startOf(pieces[0][0]), 1e-9)) return [p];
  return pieces.map((edges) => path(edges, false));
}

// ---------- пересечения ----------
function intersect(e1, e2) {
  const out = [];
  if (e1.t === 'L' && e2.t === 'L') {
    const d1 = sub(e1.b, e1.a), d2 = sub(e2.b, e2.a), den = cross(d1, d2);
    if (Math.abs(den) < 1e-12 * len(d1) * len(d2)) {
      // параллельны: совпадающие прямые — ошибка построения
      // на одной прямой: режем каждый отрезок концами другого, дальше куски либо совпадают, либо нет
      if (Math.abs(cross(d1, sub(e2.a, e1.a))) / len(d1) < 1e-7) {
        for (const [p, t2] of [[e2.a, 0], [e2.b, 1]]) { const t1 = lineParam(e1, p); if (t1 > 1e-9 && t1 < 1 - 1e-9) out.push({ t1, t2, p }); }
        for (const [p, t1] of [[e1.a, 0], [e1.b, 1]]) { const t2 = lineParam(e2, p); if (t2 > 1e-9 && t2 < 1 - 1e-9) out.push({ t1, t2, p }); }
      }
      return out;
    }
    const w = sub(e2.a, e1.a);
    const t1 = cross(w, d2) / den, t2 = cross(w, d1) / den;
    const tol = 1e-9;
    if (t1 >= -tol && t1 <= 1 + tol && t2 >= -tol && t2 <= 1 + tol) out.push({ t1: Math.min(1, Math.max(0, t1)), t2: Math.min(1, Math.max(0, t2)), p: pointAt(e1, t1) });
    return out;
  }
  if (e1.t === 'A' && e2.t === 'L') return intersect(e2, e1).map((q) => ({ t1: q.t2, t2: q.t1, p: q.p }));
  if (e1.t === 'L') {
    const d = sub(e1.b, e1.a), ld = len(d), u = mul(d, 1 / ld);
    const f = sub(e1.a, e2.c);
    const along = -dot(f, u), foot = add(e1.a, mul(u, along));
    const h = dist(foot, e2.c);
    let pts = [];
    if (Math.abs(h - e2.r) < 1e-9) pts = [foot]; // касание
    else if (h < e2.r) { const k = Math.sqrt(e2.r * e2.r - h * h); pts = [add(foot, mul(u, -k)), add(foot, mul(u, k))]; }
    for (const p of pts) {
      const t1 = lineParam(e1, p);
      if (t1 < -1e-9 || t1 > 1 + 1e-9) continue;
      const t2 = arcParam(e2, p);
      if (t2 === null) continue;
      out.push({ t1: Math.min(1, Math.max(0, t1)), t2, p });
    }
    return out;
  }
  // дуга — дуга
  const d = dist(e1.c, e2.c);
  if (d < 1e-9) {
    if (Math.abs(e1.r - e2.r) < 1e-9) {
      // одна окружность: режем каждую дугу концами другой
      for (const [p, t2] of [[startOf(e2), 0], [endOf(e2), 1]]) { const t1 = arcParam(e1, p); if (t1 !== null && t1 > 1e-9 && t1 < 1 - 1e-9) out.push({ t1, t2, p }); }
      for (const [p, t1] of [[startOf(e1), 0], [endOf(e1), 1]]) { const t2 = arcParam(e2, p); if (t2 !== null && t2 > 1e-9 && t2 < 1 - 1e-9) out.push({ t1, t2, p }); }
    }
    return out;
  }
  const u = mul(sub(e2.c, e1.c), 1 / d);
  let pts = [];
  if (Math.abs(d - (e1.r + e2.r)) < 1e-9) pts = [add(e1.c, mul(u, e1.r))];
  else if (Math.abs(d - Math.abs(e1.r - e2.r)) < 1e-9) pts = [add(e1.c, mul(u, e1.r >= e2.r ? e1.r : -e1.r))];
  else if (d < e1.r + e2.r && d > Math.abs(e1.r - e2.r)) {
    const a = (e1.r * e1.r - e2.r * e2.r + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, e1.r * e1.r - a * a));
    const p0 = add(e1.c, mul(u, a)), pr = leftN(u);
    pts = [add(p0, mul(pr, hh)), add(p0, mul(pr, -hh))];
  }
  for (const p of pts) {
    const t1 = arcParam(e1, p), t2 = arcParam(e2, p);
    if (t1 !== null && t2 !== null) out.push({ t1, t2, p });
  }
  return out;
}
// точка подрезки внутреннего стыка: пересечение продолженных рёбер; сначала — точки, лежащие на
// обоих рёбрах (на острие-каспе две точки равноудалены от вершины, верная — только одна)
function intersectFull(e1, e2, P) {
  const big = (e) => (e.t === 'L' ? (() => { const d = mul(norm(sub(e.b, e.a)), 1000); return L(sub(e.a, d), add(e.b, d)); })() : A(e.c, e.r, 0, TAU - 1e-12));
  const cand = intersect(big(e1), big(e2)).map((q) => q.p);
  if (!cand.length) return null;
  const on = (e, X) => (e.t === 'L' ? (() => { const t = lineParam(e, X); return t >= -1e-6 && t <= 1 + 1e-6; })() : arcParam(e, X, 1e-6) !== null);
  const both = cand.filter((X) => on(e1, X) && on(e2, X));
  return (both.length ? both : cand).reduce((a, b) => (dist(a, P) <= dist(b, P) ? a : b));
}
function trimEnd(e, X) {
  if (e.t === 'L') return L(e.a, X);
  const t = arcParam({ ...e, da: e.da * 1.5 }, X, 1e-7);
  if (t === null) throw new Error('подрезка дуги: точка вне дуги');
  return A(e.c, e.r, e.a0, e.da * 1.5 * t, e.kind);
}
function trimStart(e, X) {
  if (e.t === 'L') return L(X, e.b);
  const re = reverseEdge(e);
  return reverseEdge(trimEnd(re, X));
}

// ---------- обводка: смещение на ±h со стыками-дугами ----------
function offsetEdge(e, d) {
  if (e.t === 'L') { const n = leftN(tangentAt(e, 0)); return L(add(e.a, mul(n, d)), add(e.b, mul(n, d))); }
  const r = e.r - Math.sign(e.da) * d;
  if (r <= 1e-9) throw new Error(`дуга r ${e.r} вырождается при смещении ${d}`);
  return A(e.c, r, e.a0, e.da, e.kind);
}
function offsetChain(edges, d, closed) {
  const n = edges.length;
  const off = edges.map((e) => offsetEdge(e, d));
  const joins = new Array(n).fill(null);
  const joints = closed ? n : n - 1;
  for (let i = 0; i < joints; i++) {
    const j = (i + 1) % n;
    const P = endOf(edges[i]);
    const t1 = tangentAt(edges[i], 1), t2 = tangentAt(edges[j], 0);
    let turn = Math.atan2(cross(t1, t2), dot(t1, t2));
    if (Math.abs(turn) < 1e-9) continue;
    if (Math.PI - Math.abs(turn) < 1e-6) {
      // острие (касп): путь разворачивается назад. Внутренняя сторона — та, куда уходит следующее
      // ребро (видно по кривизне), там подрезка; с другой стороны — полукруглый стык.
      const q = pointAt(edges[j], 1e-3);
      turn = (Math.sign(dot(sub(q, P), leftN(t1))) || 1) * Math.PI;
    }
    if (Math.sign(turn) === Math.sign(d)) {
      const X = intersectFull(off[i], off[j], P);
      if (!X) throw new Error('внутренний стык: смещения не пересекаются');
      off[i] = trimEnd(off[i], X);
      off[j] = trimStart(off[j], X);
    } else {
      const p1 = add(P, mul(leftN(t1), d));
      joins[i] = A(P, Math.abs(d), ang(sub(p1, P)), turn, 'join');
    }
  }
  const chain = [];
  for (let i = 0; i < n; i++) { chain.push(off[i]); if (joins[i]) chain.push(joins[i]); }
  return chain.filter((e) => edgeLen(e) > 1e-12);
}
export function strokeLoops(p, h) {
  if (p.closed) return [offsetChain(p.edges, h, true), offsetChain(p.edges, -h, true)];
  const left = offsetChain(p.edges, h, false), right = offsetChain(p.edges, -h, false);
  const e0 = p.edges[0], e1 = p.edges[p.edges.length - 1];
  const Pe = endOf(e1), Ps = startOf(e0);
  const ne = leftN(tangentAt(e1, 1)), ns = leftN(tangentAt(e0, 0));
  const endCap = A(Pe, h, ang(ne), -Math.PI, 'cap');
  const startCap = A(Ps, h, ang(mul(ns, -1)), -Math.PI, 'cap');
  return [[...left, endCap, ...reverseLoop(right), startCap]];
}
function orient(loops) {
  // внешний (наибольший по площади) — положительный, остальные — отрицательные
  const areas = loops.map(loopArea);
  const big = areas.reduce((bi, a, i) => (Math.abs(a) > Math.abs(areas[bi]) ? i : bi), 0);
  return loops.map((lp, i) => ((i === big) === (areas[i] > 0) ? lp : reverseLoop(lp)));
}

// ---------- детали ----------
function windingInside(p, edges) {
  // многоугольник по осевой (дуги — по 256 точек): только для точек не у самой границы
  const pts = [];
  for (const e of edges) { const m = e.t === 'L' ? 1 : 256; for (let k = 0; k < m; k++) pts.push(pointAt(e, k / m)); }
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function strokePiece(p, h) {
  return { loops: orient(strokeLoops(p, h)), bd: (q) => distToEdges(q, p.edges) - h };
}
export function solidPiece(p, h) {
  if (!p.closed) throw new Error('заливка возможна только у замкнутого пути');
  // только внешнее смещение: внутреннее заливке не нужно, а у мелкой фигуры (модуль QR, скругление
  // радиусом в полтолщины) оно вырождается. Обход по часовой на экране (площадь > 0) — наружу −h.
  const outer = offsetChain(p.edges, loopArea(p.edges) > 0 ? -h : h, true);
  return { loops: orient([outer]), bd: (q) => (windingInside(q, p.edges) ? -h : distToEdges(q, p.edges) - h) };
}
// чистая заливка по замкнутому пути, без линии по краю (как диск) — например, кусок зрачка, разрезанного косой
export function fillPiece(p) {
  if (!p.closed) throw new Error('заливка возможна только у замкнутого пути');
  return { loops: orient([p.edges.slice()]), bd: (q) => (windingInside(q, p.edges) ? -distToEdges(q, p.edges) : distToEdges(q, p.edges)) };
}
export function diskPiece(c, r) {
  return { loops: [[A(c, r, -Math.PI / 2, Math.PI), A(c, r, Math.PI / 2, Math.PI)]], bd: (q) => dist(q, c) - r };
}

// ---------- объединение деталей ----------
export function union(pieces) {
  const edges = [];
  pieces.forEach((pc, k) => pc.loops.forEach((lp) => lp.forEach((e) => edges.push({ e, k }))));
  const cuts = edges.map(() => []);
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    if (edges[i].k === edges[j].k) continue;
    for (const q of intersect(edges[i].e, edges[j].e)) { cuts[i].push(q.t1); cuts[j].push(q.t2); }
  }
  const kept = [];
  edges.forEach(({ e, k }, i) => {
    const ts = [0, ...cuts[i].filter((t) => t > 1e-9 && t < 1 - 1e-9).sort((a, b) => a - b), 1];
    for (let q = 0; q + 1 < ts.length; q++) {
      if (ts[q + 1] - ts[q] < 1e-9) continue;
      const s = subEdge(e, ts[q], ts[q + 1]);
      if (edgeLen(s) < 1e-9) continue;
      const m = pointAt(s, 0.5);
      let drop = false;
      const onB = [];
      for (let q = 0; q < pieces.length && !drop; q++) {
        if (q === k) continue;
        const d = pieces[q].bd(m);
        if (d < -1e-7) drop = true;
        else if (d <= 1e-7) onB.push(q);
      }
      if (drop) continue;
      if (onB.length) {
        // кусок лежит на границе другой детали: щуп наружу (справа от обхода — вне своей детали).
        // Если снаружи другая деталь — это шов внутри объединения; иначе — общая граница, оставляем
        // одну копию (у детали с меньшим номером).
        const tg = tangentAt(s, 0.5), probe = add(m, mul([tg[1], -tg[0]], 1e-5));
        if (onB.some((q) => pieces[q].bd(probe) < 0)) continue;
        if (onB.some((q) => q < k)) continue;
      }
      kept.push({ e: s, k });
    }
  });
  return chain(kept.map((q) => q.e));
}
function chain(list) {
  const used = new Array(list.length).fill(false);
  const loops = [];
  for (let s = 0; s < list.length; s++) {
    if (used[s]) continue;
    const loop = [list[s]];
    used[s] = true;
    const first = startOf(list[s]);
    let cur = list[s];
    for (let guard = 0; guard < 10000; guard++) {
      const P = endOf(cur);
      if (same(P, first, 1e-6) && loop.length > 1) break;
      const cand = [];
      for (let i = 0; i < list.length; i++) if (!used[i] && same(startOf(list[i]), P, 1e-6)) cand.push(i);
      if (!cand.length) {
        if (same(P, first, 1e-6)) break;
        throw new Error(`контур не замкнулся у (${P.map((v) => v.toFixed(4)).join(', ')})`);
      }
      let pick = cand[0];
      if (cand.length > 1) {
        // из нескольких — ближайший поворот по часовой от обратного направления прихода
        const back = ang(mul(tangentAt(cur, 1), -1));
        let best = Infinity;
        for (const i of cand) {
          let d = back - ang(tangentAt(list[i], 0));
          d = ((d % TAU) + TAU) % TAU;
          if (d < 1e-9) d = TAU;
          if (d < best) { best = d; pick = i; }
        }
      }
      used[pick] = true;
      loop.push(list[pick]);
      cur = list[pick];
    }
    loops.push(loop);
  }
  return loops.map(mergeLoop);
}
// склеить соседние отрезки на одной прямой и дуги одной окружности
export function mergeLoop(loop) {
  const out = [];
  for (const e of loop) {
    const p = out[out.length - 1];
    if (p && p.t === 'L' && e.t === 'L' && Math.abs(cross(norm(sub(p.b, p.a)), norm(sub(e.b, e.a)))) < 1e-9 && dot(sub(p.b, p.a), sub(e.b, e.a)) > 0) out[out.length - 1] = L(p.a, e.b);
    else if (p && p.t === 'A' && e.t === 'A' && same(p.c, e.c, 1e-7) && Math.abs(p.r - e.r) < 1e-7 && Math.sign(p.da) === Math.sign(e.da)) out[out.length - 1] = A(p.c, p.r, p.a0, p.da + e.da, p.kind === e.kind ? p.kind : 'main');
    else out.push(e);
  }
  // стык последнего с первым
  while (out.length > 1) {
    const p = out[out.length - 1], e = out[0];
    if (p.t === 'L' && e.t === 'L' && Math.abs(cross(norm(sub(p.b, p.a)), norm(sub(e.b, e.a)))) < 1e-9 && dot(sub(p.b, p.a), sub(e.b, e.a)) > 0) { out[0] = L(p.a, e.b); out.pop(); }
    else if (p.t === 'A' && e.t === 'A' && same(p.c, e.c, 1e-7) && Math.abs(p.r - e.r) < 1e-7 && Math.sign(p.da) === Math.sign(e.da)) { out[0] = A(p.c, p.r, p.a0, p.da + e.da, p.kind === e.kind ? p.kind : 'main'); out.pop(); }
    else break;
  }
  return out;
}

// ---------- вывод ----------
const fmt = (v, dp) => { const s = (Math.round(v * 10 ** dp) / 10 ** dp).toFixed(dp).replace(/\.?0+$/, ''); return s === '-0' ? '0' : s; };
const P = (p, dp) => `${fmt(p[0], dp)} ${fmt(p[1], dp)}`;
// дуга → куски по четвертям (узлы на экстремумах) → кубики с каноническими рычагами
export function arcPieces(e) {
  const out = [], s = Math.sign(e.da), end = e.a0 + e.da;
  const q = Math.PI / 2;
  const cuts = [];
  if (e.kind && e.kind !== 'main') {
    // торец, стык, скругление: равные куски не больше 90°, симметрично середине дуги
    const n = Math.max(1, Math.ceil(Math.abs(e.da) / q - 1e-9));
    for (let i = 1; i < n; i++) cuts.push(e.a0 + (e.da * i) / n);
  } else {
    let k = s > 0 ? Math.floor(e.a0 / q + 1e-9) + 1 : Math.ceil(e.a0 / q - 1e-9) - 1;
    for (;; k += s) {
      const a = k * q;
      if (s > 0 ? a >= end - 1e-9 : a <= end + 1e-9) break;
      cuts.push(a);
    }
  }
  const angles = [e.a0, ...cuts, end];
  for (let i = 0; i + 1 < angles.length; i++) {
    const a0 = angles[i], a1 = angles[i + 1], dth = a1 - a0;
    if (Math.abs(dth) < 1e-9) continue;
    const h = (4 / 3) * Math.tan(dth / 4) * e.r;
    const p0 = onCircle(e.c, e.r, a0), p3 = onCircle(e.c, e.r, a1);
    const c1 = add(p0, mul([-Math.sin(a0), Math.cos(a0)], h)), c2 = sub(p3, mul([-Math.sin(a1), Math.cos(a1)], h));
    out.push({ p0, c1, c2, p3 });
  }
  return out;
}
// замкнутые контуры → d; начало — самый верхний (затем левый) узел
export function loopsToD(loops, dp = 4) {
  let d = '';
  for (const loop of loops) {
    const segs = [];
    for (const e of loop) {
      if (e.t === 'L') segs.push({ t: 'L', p0: e.a, p3: e.b });
      else for (const pc of arcPieces(e)) segs.push({ t: 'C', ...pc });
    }
    let si = 0;
    segs.forEach((sg, i) => { const a = sg.p0, b = segs[si].p0; if (a[1] < b[1] - 1e-9 || (Math.abs(a[1] - b[1]) <= 1e-9 && a[0] < b[0])) si = i; });
    const ord = [...segs.slice(si), ...segs.slice(0, si)];
    d += `M${P(ord[0].p0, dp)}`;
    for (const sg of ord) {
      if (sg.t === 'L') {
        const a = sg.p0, b = sg.p3;
        if (Math.abs(a[1] - b[1]) < 1e-9) d += `H${fmt(b[0], dp)}`;
        else if (Math.abs(a[0] - b[0]) < 1e-9) d += `V${fmt(b[1], dp)}`;
        else d += `L${P(b, dp)}`;
      } else d += `C${P(sg.c1, dp)} ${P(sg.c2, dp)} ${P(sg.p3, dp)}`;
    }
    d += 'Z';
  }
  return d;
}
// открытый/замкнутый путь осевой линии → d (дуги — теми же каноническими кубиками)
export function pathToD(p, dp = 4) {
  const e0 = p.edges[0];
  let d = `M${P(startOf(e0), dp)}`;
  for (const e of p.edges) {
    if (e.t === 'L') {
      const a = e.a, b = e.b;
      if (Math.abs(a[1] - b[1]) < 1e-9) d += `H${fmt(b[0], dp)}`;
      else if (Math.abs(a[0] - b[0]) < 1e-9) d += `V${fmt(b[1], dp)}`;
      else d += `L${P(b, dp)}`;
    } else for (const pc of arcPieces(e)) d += `C${P(pc.c1, dp)} ${P(pc.c2, dp)} ${P(pc.p3, dp)}`;
  }
  return p.closed ? `${d}Z` : d;
}
export { fmt };
