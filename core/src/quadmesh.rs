//! Quad remesh that follows the form (ZBrush: ZRemesher, in short), after Instant Meshes (Jakob,
//! Tarini, Panozzo and Sorkine-Hornung, 2015):
//!   1. a hierarchy of the input points, pairs of neighbours merged level by level;
//!   2. a cross field (four directions in each tangent plane) smoothed from the coarsest level down,
//!      so the quads' edges lie along the form;
//!   3. a position field: in every point the nearest corner of a square lattice of the wanted edge
//!      length, smoothed the same way so neighbouring lattices agree;
//!   4. points whose lattice corners coincide become one vertex; neighbours one lattice step apart
//!      give an edge; the faces are traced around every vertex in turn (quads, a few triangles and
//!      pentagons split up), the holes left closed;
//!   5. a few passes of relaxing along the surface, each followed by a projection back onto it.

use crate::cloth::Collider;

type V = [f64; 3];
#[inline] fn add(a: V, b: V) -> V { [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
#[inline] fn sub(a: V, b: V) -> V { [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
#[inline] fn mul(a: V, s: f64) -> V { [a[0] * s, a[1] * s, a[2] * s] }
#[inline] fn dot(a: V, b: V) -> f64 { a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
#[inline] fn cross(a: V, b: V) -> V { [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
#[inline] fn norm(a: V) -> V { let l = dot(a, a).sqrt(); if l > 1e-30 { mul(a, 1.0 / l) } else { [0.0, 0.0, 0.0] } }
#[inline] fn tangent(q: V, n: V) -> V { sub(q, mul(n, dot(n, q))) }
fn any_tangent(n: V) -> V {
    let a = if n[0].abs() < 0.9 { [1.0, 0.0, 0.0] } else { [0.0, 1.0, 0.0] };
    norm(tangent(a, n))
}

struct Level {
    /// (0 free, 1 on a sharp edge, 2 a corner of sharp edges; the edge's direction)
    cons: Vec<(u8, V)>,
    p: Vec<V>,
    n: Vec<V>,
    area: Vec<f64>,
    off: Vec<u32>,
    adj: Vec<u32>,
}
impl Level {
    fn len(&self) -> usize { self.p.len() }
    fn nb(&self, i: usize) -> &[u32] { &self.adj[self.off[i] as usize..self.off[i + 1] as usize] }
}

fn csr(n: usize, edges: &mut Vec<(u32, u32)>) -> (Vec<u32>, Vec<u32>) {
    edges.sort_unstable();
    edges.dedup();
    let mut off = vec![0u32; n + 1];
    for &(a, _) in edges.iter() { off[a as usize + 1] += 1; }
    for i in 0..n { off[i + 1] += off[i]; }
    let adj = edges.iter().map(|e| e.1).collect();
    (off, adj)
}

// merge neighbours in pairs: the coarser level and which coarse point every fine one went to
fn downsample(l: &Level) -> (Level, Vec<u32>) {
    let n = l.len();
    let mut entries: Vec<(f64, u32, u32)> = Vec::with_capacity(l.adj.len() / 2);
    for i in 0..n {
        for &j in l.nb(i) {
            let j = j as usize;
            if j <= i { continue; }
            let r = if l.area[i] > 0.0 && l.area[j] > 0.0 { (l.area[i] / l.area[j]).max(l.area[j] / l.area[i]) } else { 1.0 };
            entries.push((dot(l.n[i], l.n[j]) * r, i as u32, j as u32));
        }
    }
    entries.sort_unstable_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut map = vec![u32::MAX; n];
    let (mut p, mut nn, mut area) = (Vec::new(), Vec::new(), Vec::new());
    for &(_, i, j) in &entries {
        let (i, j) = (i as usize, j as usize);
        if map[i] != u32::MAX || map[j] != u32::MAX { continue; }
        let k = p.len() as u32;
        map[i] = k; map[j] = k;
        let (ai, aj) = (l.area[i].max(1e-30), l.area[j].max(1e-30));
        p.push(mul(add(mul(l.p[i], ai), mul(l.p[j], aj)), 1.0 / (ai + aj)));
        let m = norm(add(mul(l.n[i], ai), mul(l.n[j], aj)));
        nn.push(if dot(m, m) > 0.0 { m } else { l.n[i] });
        area.push(l.area[i] + l.area[j]);
    }
    for i in 0..n {
        if map[i] != u32::MAX { continue; }
        map[i] = p.len() as u32;
        p.push(l.p[i]); nn.push(l.n[i]); area.push(l.area[i]);
    }
    let mut edges = Vec::with_capacity(l.adj.len());
    for i in 0..n { for &j in l.nb(i) { let (a, b) = (map[i], map[j as usize]); if a != b { edges.push((a, b)); } } }
    let m = p.len();
    let (off, adj) = csr(m, &mut edges);
    // a coarse point keeps the strongest constraint of the points merged into it
    let mut cons = vec![(0u8, [0.0; 3]); m];
    for i in 0..n { let c = map[i] as usize; if l.cons[i].0 > cons[c].0 { cons[c] = l.cons[i]; } }
    (Level { cons, p, n: nn, area, off, adj }, map)
}

// the two of the four directions (of q0 and of q1) that agree best
#[inline]
fn compat_orient(q0: V, n0: V, q1: V, n1: V) -> (V, V) {
    let a = [q0, cross(n0, q0)];
    let b = [q1, cross(n1, q1)];
    let (mut bs, mut bi, mut bj) = (-1.0, 0, 0);
    for (i, ai) in a.iter().enumerate() { for (j, bjv) in b.iter().enumerate() { let s = dot(*ai, *bjv).abs(); if s > bs { bs = s; bi = i; bj = j; } } }
    let d = dot(a[bi], b[bj]);
    (a[bi], if d < 0.0 { mul(b[bj], -1.0) } else { b[bj] })
}

fn smooth_orient(l: &Level, q: &mut [V], iters: usize) {
    for _ in 0..iters {
        for i in 0..l.len() {
            let ni = l.n[i];
            let mut qi = q[i];
            let mut wsum = 0.0;
            for &j in l.nb(i) {
                let j = j as usize;
                let (a, b) = compat_orient(qi, ni, q[j], l.n[j]);
                qi = add(mul(a, wsum), b);
                wsum += 1.0;
                let t = norm(tangent(qi, ni));
                qi = if dot(t, t) > 0.0 { t } else { q[i] };
            }
            // along a sharp edge one of the four directions is the edge's own
            if l.cons[i].0 == 1 { let t = norm(tangent(l.cons[i].1, ni)); if dot(t, t) > 0.0 { qi = t; } }
            q[i] = qi;
        }
    }
}

// the point between two tangent planes nearest to both
#[inline]
fn middle(p0: V, n0: V, p1: V, n1: V) -> V {
    let (n0p0, n0p1, n1p0, n1p1, n0n1) = (dot(n0, p0), dot(n0, p1), dot(n1, p0), dot(n1, p1), dot(n0, n1));
    let den = 1.0 / (1.0 - n0n1 * n0n1 + 1e-4);
    let l0 = 2.0 * (n0p1 - n0p0 - n0n1 * (n1p0 - n1p1)) * den;
    let l1 = 2.0 * (n1p0 - n1p1 - n0n1 * (n0p1 - n0p0)) * den;
    sub(mul(add(p0, p1), 0.5), mul(add(mul(n0, l0), mul(n1, l1)), 0.25))
}
#[inline]
fn lattice_floor(o: V, q: V, n: V, p: V, h: f64) -> V {
    let t = cross(n, q);
    let d = sub(p, o);
    add(o, add(mul(q, (dot(q, d) / h).floor() * h), mul(t, (dot(t, d) / h).floor() * h)))
}
#[inline]
fn lattice_round(o: V, q: V, n: V, p: V, h: f64) -> V {
    let t = cross(n, q);
    let d = sub(p, o);
    add(o, add(mul(q, (dot(q, d) / h).round() * h), mul(t, (dot(t, d) / h).round() * h)))
}
#[allow(clippy::too_many_arguments)]
#[inline]
fn compat_pos(p0: V, n0: V, q0: V, o0: V, p1: V, n1: V, q1: V, o1: V, h: f64) -> (V, V) {
    let (t0, t1) = (cross(n0, q0), cross(n1, q1));
    let mid = middle(p0, n0, p1, n1);
    let a = lattice_floor(o0, q0, n0, mid, h);
    let b = lattice_floor(o1, q1, n1, mid, h);
    let (mut best, mut bi) = (f64::INFINITY, 0usize);
    for i in 0..16usize {
        let ca = add(a, mul(add(mul(q0, (i & 1) as f64), mul(t0, ((i & 2) >> 1) as f64)), h));
        let cb = add(b, mul(add(mul(q1, ((i & 4) >> 2) as f64), mul(t1, ((i & 8) >> 3) as f64)), h));
        let d = sub(ca, cb);
        let c = dot(d, d);
        if c < best { best = c; bi = i; }
    }
    (
        add(a, mul(add(mul(q0, (bi & 1) as f64), mul(t0, ((bi & 2) >> 1) as f64)), h)),
        add(b, mul(add(mul(q1, ((bi & 4) >> 2) as f64), mul(t1, ((bi & 8) >> 3) as f64)), h)),
    )
}

fn smooth_pos(l: &Level, q: &[V], o: &mut [V], h: f64, iters: usize, fine: bool) {
    for _ in 0..iters {
        for i in 0..l.len() {
            let (pi, ni, qi) = (l.p[i], l.n[i], q[i]);
            let mut s = o[i];
            let mut wsum = 0.0;
            for &j in l.nb(i) {
                let j = j as usize;
                let (a, b) = compat_pos(pi, ni, qi, s, l.p[j], l.n[j], q[j], o[j], h);
                s = mul(add(mul(a, wsum), b), 1.0 / (wsum + 1.0));
                wsum += 1.0;
                s = sub(s, mul(ni, dot(ni, sub(s, pi))));
            }
            o[i] = lattice_round(s, qi, ni, pi, h);
            // (on the finest level: a lattice line runs along a sharp edge, a corner is a lattice point)
            if fine {
                match l.cons[i].0 {
                    1 => { let t = cross(ni, qi); o[i] = sub(o[i], mul(t, dot(sub(o[i], pi), t))); }
                    2 => { o[i] = pi; }
                    _ => {}
                }
            }
        }
    }
}

fn find(uf: &mut [u32], mut x: u32) -> u32 {
    while uf[x as usize] != x { let g = uf[uf[x as usize] as usize]; uf[x as usize] = g; x = g; }
    x
}

pub struct QuadMesh {
    pub pos: Vec<f32>,
    /// colour, mask and polygroup, taken from the nearest point of the old surface
    pub col: Vec<f32>,
    pub mask: Vec<f32>,
    pub grp: Vec<f32>,
    /// four corners per face; a triangle has u32::MAX as its fourth
    pub faces: Vec<u32>,
}

// a polygon cut into quads (and one triangle when the count is odd), fanned from its first corner;
// spikes (… a b a …, from a vertex with one edge) are taken out first, and a polygon that still passes
// one vertex twice is left out
fn split_poly(c: &[u32], out: &mut Vec<u32>) {
    let mut c: Vec<u32> = c.to_vec();
    loop {
        let k = c.len();
        if k < 3 { return; }
        let mut cut = None;
        for i in 0..k { if c[(i + k - 1) % k] == c[(i + 1) % k] { cut = Some(i); break; } }
        match cut {
            Some(i) => { let j = (i + 1) % k; let (a, b) = if i < j { (i, j) } else { (j, i) }; c.remove(b); c.remove(a); }
            None => break,
        }
    }
    let mut sorted = c.clone();
    sorted.sort_unstable();
    if sorted.windows(2).any(|w| w[0] == w[1]) { return; }
    let k = c.len();
    if k < 3 { return; }
    let mut i = 1;
    while i + 2 < k { out.extend_from_slice(&[c[0], c[i], c[i + 1], c[i + 2]]); i += 2; }
    if i + 1 < k { out.extend_from_slice(&[c[0], c[i], c[i + 1], u32::MAX]); }
}

fn corners(f: &[u32]) -> usize { if f[3] == u32::MAX { 3 } else { 4 } }
// every edge in exactly two faces, one each way: faces that pass an edge the same way as an earlier
// face (or a third time) go, faces with a corner twice go, and the holes left are closed with
// polygons going the other way round; a few rounds
// a hole closed: fanned from the first corner whose cuts are not edges already, or else round a new
// vertex in its middle
fn fill_hole(c: &[u32], faces: &mut Vec<u32>, und: &mut std::collections::BTreeSet<(u32, u32)>, v: &mut Verts) {
    let k = c.len();
    let ek = |a: u32, b: u32| (a.min(b), a.max(b));
    let rim: std::collections::BTreeSet<(u32, u32)> = (0..k).map(|i| ek(c[i], c[(i + 1) % k])).collect();
    for r in 0..k {
        let rot: Vec<u32> = (0..k).map(|i| c[(i + r) % k]).collect();
        let mut tmp = Vec::new();
        split_poly(&rot, &mut tmp);
        if tmp.is_empty() { continue; }
        let mut ok = true;
        let mut new_e = Vec::new();
        for f in tmp.chunks(4) { let n = corners(f); for e in 0..n { let x = ek(f[e], f[(e + 1) % n]); if !rim.contains(&x) { if und.contains(&x) { ok = false; } new_e.push(x); } } }
        if ok { for x in new_e { und.insert(x); } faces.extend_from_slice(&tmp); return; }
    }
    let mid = v.p.len() as u32;
    let (mut s, mut n) = ([0.0; 3], [0.0; 3]);
    for &x in c { s = add(s, v.p[x as usize]); n = add(n, v.n[x as usize]); }
    v.p.push(mul(s, 1.0 / k as f64));
    let nn = norm(n);
    v.n.push(if dot(nn, nn) > 0.0 { nn } else { [0.0, 0.0, 1.0] });
    v.kind.push((0, [0.0; 3]));
    if k % 2 == 0 && k >= 6 {
        for i in (0..k).step_by(2) { faces.extend_from_slice(&[c[i], c[(i + 1) % k], c[(i + 2) % k], mid]); und.insert(ek(c[i], mid)); }
    } else {
        for i in 0..k { faces.extend_from_slice(&[c[i], c[(i + 1) % k], mid, u32::MAX]); und.insert(ek(c[i], mid)); }
    }
}
// the output vertices while faces are made: position, normal, sharp-edge constraint
struct Verts { p: Vec<V>, n: Vec<V>, kind: Vec<(u8, V)> }
fn make_manifold(faces: &mut Vec<u32>, v: &mut Verts) {
    use std::collections::{BTreeMap, BTreeSet};
    for round in 0..6 {
        let mut changed = false;
        // two faces on the same corners (back to back, a closed pocket): both go
        let mut by: BTreeMap<Vec<u32>, usize> = BTreeMap::new();
        for f in faces.chunks(4) { let mut k: Vec<u32> = f[..corners(f)].to_vec(); k.sort_unstable(); *by.entry(k).or_insert(0) += 1; }
        if by.values().any(|&c| c > 1) {
            let old = std::mem::take(faces);
            for f in old.chunks(4) { let mut k: Vec<u32> = f[..corners(f)].to_vec(); k.sort_unstable(); if by[&k] == 1 { faces.extend_from_slice(f); } else { changed = true; } }
        }
        // drop the faces that break it
        let mut dir: BTreeSet<(u32, u32)> = BTreeSet::new();
        let mut keep = Vec::with_capacity(faces.len());
        for f in faces.chunks(4) {
            let k = corners(f);
            let mut bad = false;
            for x in 0..k { for y in x + 1..k { if f[x] == f[y] { bad = true; } } }
            if !bad { for e in 0..k { if dir.contains(&(f[e], f[(e + 1) % k])) { bad = true; } } }
            if bad { changed = true; continue; }
            for e in 0..k { dir.insert((f[e], f[(e + 1) % k])); }
            keep.extend_from_slice(f);
        }
        *faces = keep;
        if round == 5 { break; }
        // the holes: a new face gets b→a wherever a→b has no twin
        let mut next: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
        for &(a, b) in dir.iter() { if !dir.contains(&(b, a)) { next.entry(b).or_default().push(a); } }
        if next.is_empty() && !changed { break; }
        let mut und: BTreeSet<(u32, u32)> = dir.iter().map(|&(a, b)| (a.min(b), a.max(b))).collect();
        let mut done: BTreeSet<(u32, u32)> = BTreeSet::new();
        let starts: Vec<(u32, u32)> = next.iter().flat_map(|(&a, l)| l.iter().map(move |&b| (a, b))).collect();
        for (a0, b0) in starts {
            if done.contains(&(a0, b0)) { continue; }
            // walk the hole's rim; where it comes back to a corner it passed (a figure 8), that
            // part is a hole of its own
            let mut lp = vec![a0];
            let (mut a, mut b) = (a0, b0);
            for _ in 0..400 {
                done.insert((a, b));
                if let Some(j) = lp.iter().position(|&x| x == b) {
                    let part: Vec<u32> = lp[j..].to_vec();
                    if part.len() >= 3 && part.len() <= 64 { fill_hole(&part, faces, &mut und, v); }
                    lp.truncate(j + 1);
                    if j == 0 { break; }
                } else {
                    lp.push(b);
                }
                let nx = next.get(&b).and_then(|l| l.iter().copied().find(|&x| !done.contains(&(b, x))));
                match nx { Some(x) => { a = b; b = x; } None => break }
            }
        }
    }
}

/// The old vertices' colour, mask and polygroup, for `remesh` to carry over (any may be empty).
#[derive(Default)]
pub struct Attrs<'a> { pub col: &'a [f32], pub mask: &'a [f32], pub grp: &'a [f32] }

/// `target`: the wanted number of quads.
pub fn remesh(pos: &[f32], idx: &[u32], target: usize, seed: u64, at: &Attrs) -> Option<QuadMesh> {
    let nv = pos.len() / 3;
    let nt = idx.len() / 3;
    if nt < 4 || nv < 4 { return None; }
    if idx.iter().any(|&v| v as usize >= nv) { return None; }
    // the fine level: the input points, area-weighted normals, a third of their triangles' area
    let p: Vec<V> = (0..nv).map(|i| [pos[i * 3] as f64, pos[i * 3 + 1] as f64, pos[i * 3 + 2] as f64]).collect();
    let mut n = vec![[0.0f64; 3]; nv];
    let mut area = vec![0.0f64; nv];
    let mut total = 0.0;
    let mut edges = Vec::with_capacity(nt * 6);
    for t in 0..nt {
        let (a, b, c) = (idx[t * 3] as usize, idx[t * 3 + 1] as usize, idx[t * 3 + 2] as usize);
        let fnrm = cross(sub(p[b], p[a]), sub(p[c], p[a]));
        let ar = dot(fnrm, fnrm).sqrt() * 0.5;
        total += ar;
        for v in [a, b, c] { n[v] = add(n[v], fnrm); area[v] += ar / 3.0; }
        for (x, y) in [(a, b), (b, c), (c, a)] { edges.push((x as u32, y as u32)); edges.push((y as u32, x as u32)); }
    }
    for v in n.iter_mut() { let m = norm(*v); *v = if dot(m, m) > 0.0 { m } else { [0.0, 0.0, 1.0] }; }
    if total <= 0.0 { return None; }
    let h = (total / target.max(4) as f64).sqrt();
    let (off, adj) = csr(nv, &mut edges);
    // sharp edges (the faces on them bend apart by more than ~50°): per point how many, and which way
    let mut cons = vec![(0u8, [0.0; 3]); nv];
    {
        let mut first: std::collections::HashMap<(u32, u32), V> = std::collections::HashMap::with_capacity(nt * 2);
        let mut dirs: Vec<Vec<V>> = vec![Vec::new(); nv];
        for t in 0..nt {
            let (a, b, c) = (idx[t * 3] as usize, idx[t * 3 + 1] as usize, idx[t * 3 + 2] as usize);
            let fnrm = norm(cross(sub(p[b], p[a]), sub(p[c], p[a])));
            for (x, y) in [(a, b), (b, c), (c, a)] {
                let k = ((x.min(y)) as u32, (x.max(y)) as u32);
                match first.get(&k) {
                    None => { first.insert(k, fnrm); }
                    Some(&m) => {
                        if dot(m, fnrm) < 0.64 {
                            let d = norm(sub(p[y], p[x]));
                            dirs[x].push(d);
                            dirs[y].push(mul(d, -1.0));
                        }
                    }
                }
            }
        }
        for v in 0..nv {
            cons[v] = match dirs[v].len() {
                0 => (0, [0.0; 3]),
                1 => (1, dirs[v][0]),
                2 => (1, norm(sub(dirs[v][1], dirs[v][0]))),
                _ => (2, [0.0; 3]),
            };
        }
    }
    let mut levels = vec![Level { cons, p, n, area, off, adj }];
    let mut maps: Vec<Vec<u32>> = Vec::new();
    while levels.last().unwrap().len() > 600 && levels.len() < 16 {
        let (c, m) = downsample(levels.last().unwrap());
        if c.len() as f64 > levels.last().unwrap().len() as f64 * 0.9 { break; }
        levels.push(c);
        maps.push(m);
    }
    // the cross field, coarse to fine
    let mut rng = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    let mut rnd = || { rng = rng.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407); ((rng >> 11) as f64) / ((1u64 << 53) as f64) };
    let top = levels.len() - 1;
    let mut q: Vec<V> = levels[top].n.iter().map(|&nn| {
        let a = any_tangent(nn);
        let b = cross(nn, a);
        let ang = rnd() * std::f64::consts::PI * 2.0;
        add(mul(a, ang.cos()), mul(b, ang.sin()))
    }).collect();
    smooth_orient(&levels[top], &mut q, 30);
    for k in (0..top).rev() {
        let l = &levels[k];
        let map = &maps[k];
        let mut qf: Vec<V> = (0..l.len()).map(|i| { let t = norm(tangent(q[map[i] as usize], l.n[i])); if dot(t, t) > 0.0 { t } else { any_tangent(l.n[i]) } }).collect();
        smooth_orient(l, &mut qf, if k == 0 { 12 } else { 10 });
        q = qf;
    }
    // the position field the same way: every level needs its own orientation, so do it again per level
    let mut qs: Vec<Vec<V>> = vec![Vec::new(); levels.len()];
    qs[0] = q;
    for k in 1..levels.len() {
        // the coarse level's directions: those of its first fine point, made tangent
        let l = &levels[k];
        let mut qc = vec![[0.0f64; 3]; l.len()];
        let mut seen = vec![false; l.len()];
        for (i, &c) in maps[k - 1].iter().enumerate() {
            let c = c as usize;
            if seen[c] { continue; }
            seen[c] = true;
            let t = norm(tangent(qs[k - 1][i], l.n[c]));
            qc[c] = if dot(t, t) > 0.0 { t } else { any_tangent(l.n[c]) };
        }
        qs[k] = qc;
    }
    let mut o: Vec<V> = levels[top].p.clone();
    smooth_pos(&levels[top], &qs[top], &mut o, h, 30, top == 0);
    for k in (0..top).rev() {
        let l = &levels[k];
        let map = &maps[k];
        let mut of: Vec<V> = (0..l.len()).map(|i| { let c = o[map[i] as usize]; sub(c, mul(l.n[i], dot(l.n[i], sub(c, l.p[i])))) }).collect();
        smooth_pos(l, &qs[k], &mut of, h, if k == 0 { 14 } else { 10 }, k == 0);
        o = of;
    }
    let fine = &levels[0];
    let q = &qs[0];
    // extraction: same lattice corner → one vertex; one step apart → an edge
    let mut uf: Vec<u32> = (0..nv as u32).collect();
    let mut steps: Vec<(u32, u32)> = Vec::new();
    for i in 0..nv {
        for &j in fine.nb(i) {
            let j = j as usize;
            if j <= i { continue; }
            let (a, b) = compat_pos(fine.p[i], fine.n[i], q[i], o[i], fine.p[j], fine.n[j], q[j], o[j], h);
            // (a and b are the nearest pair of the two lattices; o[i], o[j] the corners themselves)
            let (qi, ti) = (q[i], cross(fine.n[i], q[i]));
            let d = sub(o[j], o[i]);
            let du = (dot(d, qi) / h).round() as i64;
            let dv = (dot(d, ti) / h).round() as i64;
            let gap = sub(b, a);
            if du == 0 && dv == 0 && dot(gap, gap) < 0.25 * h * h {
                let (ra, rb) = (find(&mut uf, i as u32), find(&mut uf, j as u32));
                if ra != rb { uf[ra as usize] = rb; }
            } else if du.abs() + dv.abs() == 1 {
                steps.push((i as u32, j as u32));
            }
        }
    }
    let mut cid = vec![u32::MAX; nv];
    let mut cpos: Vec<V> = Vec::new();
    let mut cnrm: Vec<V> = Vec::new();
    let mut ccount: Vec<f64> = Vec::new();
    // (a vertex on a sharp edge or corner is placed by those of its points that are on it)
    let mut ckind: Vec<(u8, V)> = Vec::new();
    for i in 0..nv {
        let r = find(&mut uf, i as u32) as usize;
        if cid[r] == u32::MAX { cid[r] = cpos.len() as u32; cpos.push([0.0; 3]); cnrm.push([0.0; 3]); ccount.push(0.0); ckind.push((0, [0.0; 3])); }
        let c = cid[r] as usize;
        let k = fine.cons[i];
        let src = if k.0 == 2 { fine.p[i] } else { o[i] };
        if k.0 > ckind[c].0 { ckind[c] = k; cpos[c] = [0.0; 3]; ccount[c] = 0.0; }
        if k.0 == ckind[c].0 { cpos[c] = add(cpos[c], src); ccount[c] += 1.0; }
        cnrm[c] = add(cnrm[c], fine.n[i]);
        cid[i] = cid[r];
    }
    let nc = cpos.len();
    for c in 0..nc { cpos[c] = mul(cpos[c], 1.0 / ccount[c]); let m = norm(cnrm[c]); cnrm[c] = if dot(m, m) > 0.0 { m } else { [0.0, 0.0, 1.0] }; }
    let mut cedges: Vec<(u32, u32)> = Vec::with_capacity(steps.len() * 2);
    for &(i, j) in &steps { let (a, b) = (cid[i as usize], cid[j as usize]); if a != b { cedges.push((a, b)); cedges.push((b, a)); } }
    let (coff, mut cadj) = csr(nc, &mut cedges);
    // every vertex's neighbours counter-clockwise round its normal (seen from outside)
    for c in 0..nc {
        let (s, e) = (coff[c] as usize, coff[c + 1] as usize);
        let e1 = any_tangent(cnrm[c]);
        let e2 = cross(cnrm[c], e1);
        let mut v: Vec<(f64, u32)> = cadj[s..e].iter().map(|&u| { let d = sub(cpos[u as usize], cpos[c]); (dot(d, e2).atan2(dot(d, e1)), u) }).collect();
        v.sort_unstable_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        for (k, (_, u)) in v.into_iter().enumerate() { cadj[s + k] = u; }
    }
    let pos_in = |c: usize, u: u32| -> Option<usize> { cadj[coff[c] as usize..coff[c + 1] as usize].iter().position(|&x| x == u) };
    // faces: from u→v the next corner is the neighbour of v just before u (counter-clockwise)
    let mut used = vec![false; cadj.len()];
    let mut faces: Vec<u32> = Vec::new();
    for c in 0..nc {
        for k in coff[c] as usize..coff[c + 1] as usize {
            if used[k] { continue; }
            let mut cyc: Vec<u32> = Vec::new();
            let (mut u, mut slot) = (c, k);
            let mut ok = false;
            for _ in 0..16 {
                used[slot] = true;
                cyc.push(u as u32);
                let v = cadj[slot] as usize;
                let deg = (coff[v + 1] - coff[v]) as usize;
                let at = match pos_in(v, u as u32) { Some(a) => a, None => break };
                let w_k = coff[v] as usize + (at + deg - 1) % deg;
                if w_k == k { ok = true; break; }
                if used[w_k] { break; }
                u = v; slot = w_k;
            }
            if ok && (3..=12).contains(&cyc.len()) { split_poly(&cyc, &mut faces); }
        }
    }
    let mut verts = Verts { p: cpos, n: cnrm, kind: ckind };
    make_manifold(&mut faces, &mut verts);
    let Verts { p: cpos, n: cnrm, kind: ckind } = verts;
    let nc = cpos.len();
    // relax along the surface and project back onto it
    let col = Collider::new(pos, idx, h * 0.5);
    let mut vn: Vec<Vec<u32>> = vec![Vec::new(); nc];
    for f in faces.chunks(4) {
        let k = if f[3] == u32::MAX { 3 } else { 4 };
        for e in 0..k { let (a, b) = (f[e], f[(e + 1) % k]); vn[a as usize].push(b); vn[b as usize].push(a); }
    }
    for l in vn.iter_mut() { l.sort_unstable(); l.dedup(); }
    let mut cur = cpos.clone();
    if let Some(cl) = &col { for x in cur.iter_mut() { if let Some((pp, _, _)) = cl.closest(*x) { *x = pp; } } }
    for _ in 0..4 {
        let mut nxt = cur.clone();
        for c in 0..nc {
            if vn[c].is_empty() { continue; }
            let mut s = [0.0; 3];
            for &u in &vn[c] { s = add(s, cur[u as usize]); }
            let s = mul(s, 1.0 / vn[c].len() as f64);
            let d = sub(s, cur[c]);
            let nrm = cnrm[c];
            // corners stay, points on a sharp edge slide only along it
            let step = match ckind[c].0 { 2 => [0.0; 3], 1 => mul(ckind[c].1, dot(d, ckind[c].1)), _ => sub(d, mul(nrm, dot(nrm, d))) };
            nxt[c] = add(cur[c], mul(step, 0.5));
            if let Some(cl) = &col { if let Some((pp, _, _)) = cl.closest(nxt[c]) { nxt[c] = pp; } }
        }
        cur = nxt;
    }
    // only the vertices some face uses, numbered again
    let mut remap = vec![u32::MAX; nc];
    let mut out_p = Vec::new();
    let (mut out_c, mut out_m, mut out_g) = (Vec::new(), Vec::new(), Vec::new());
    let mut out_f = Vec::with_capacity(faces.len());
    for &v in &faces {
        if v == u32::MAX { out_f.push(v); continue; }
        if remap[v as usize] == u32::MAX {
            remap[v as usize] = (out_p.len() / 3) as u32;
            let x = cur[v as usize];
            out_p.extend_from_slice(&[x[0] as f32, x[1] as f32, x[2] as f32]);
            let hit = col.as_ref().and_then(|cl| cl.closest(x).map(|(_, t, w)| ([cl.corner(t, 0), cl.corner(t, 1), cl.corner(t, 2)], w)));
            let (cs, w) = hit.unwrap_or(([idx[0] as usize, idx[0] as usize, idx[0] as usize], [1.0, 0.0, 0.0]));
            for k in 0..3 { out_c.push(if at.col.len() >= nv * 3 { (0..3).map(|q| at.col[cs[q] * 3 + k] as f64 * w[q]).sum::<f64>() as f32 } else { 1.0 }); }
            out_m.push(if at.mask.len() >= nv { (0..3).map(|q| at.mask[cs[q]] as f64 * w[q]).sum::<f64>() as f32 } else { 0.0 });
            let big = (0..3).max_by(|&a, &b| w[a].partial_cmp(&w[b]).unwrap_or(std::cmp::Ordering::Equal)).unwrap_or(0);
            out_g.push(if at.grp.len() >= nv { at.grp[cs[big]] } else { 0.0 });
        }
        out_f.push(remap[v as usize]);
    }
    Some(QuadMesh { pos: out_p, col: out_c, mask: out_m, grp: out_g, faces: out_f })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sphere(level: usize) -> (Vec<f32>, Vec<u32>) {
        let t = (1.0 + 5f64.sqrt()) / 2.0;
        let mut p: Vec<V> = vec![[-1.0, t, 0.0], [1.0, t, 0.0], [-1.0, -t, 0.0], [1.0, -t, 0.0], [0.0, -1.0, t], [0.0, 1.0, t], [0.0, -1.0, -t], [0.0, 1.0, -t], [t, 0.0, -1.0], [t, 0.0, 1.0], [-t, 0.0, -1.0], [-t, 0.0, 1.0]];
        let mut f: Vec<[u32; 3]> = vec![[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
        for v in p.iter_mut() { *v = norm(*v); }
        for _ in 0..level {
            let mut mid = std::collections::HashMap::new();
            let mut nf = Vec::new();
            let mut m = |a: u32, b: u32, p: &mut Vec<V>| -> u32 { *mid.entry((a.min(b), a.max(b))).or_insert_with(|| { p.push(norm(mul(add(p[a as usize], p[b as usize]), 0.5))); (p.len() - 1) as u32 }) };
            for t in &f { let (a, b, c) = (m(t[0], t[1], &mut p), m(t[1], t[2], &mut p), m(t[2], t[0], &mut p)); nf.extend_from_slice(&[[t[0], a, c], [a, t[1], b], [c, b, t[2]], [a, b, c]]); }
            f = nf;
        }
        (p.iter().flat_map(|v| v.iter().map(|&x| x as f32)).collect(), f.iter().flatten().copied().collect())
    }
    fn cube(seg: usize) -> (Vec<f32>, Vec<u32>) {
        let mut p: Vec<V> = Vec::new();
        let mut f: Vec<u32> = Vec::new();
        let mut key = std::collections::HashMap::new();
        let faces = [(0, 1, 2, 1.0), (0, 1, 2, -1.0), (1, 2, 0, 1.0), (1, 2, 0, -1.0), (2, 0, 1, 1.0), (2, 0, 1, -1.0)];
        for &(u, v, w, sgn) in &faces {
            let mut id = |i: usize, j: usize, p: &mut Vec<V>| -> u32 {
                let mut x = [0.0; 3]; x[u] = i as f64 / seg as f64 * 2.0 - 1.0; x[v] = j as f64 / seg as f64 * 2.0 - 1.0; x[w] = sgn;
                let k = ((x[0] * 1e4).round() as i64, (x[1] * 1e4).round() as i64, (x[2] * 1e4).round() as i64);
                *key.entry(k).or_insert_with(|| { p.push(x); (p.len() - 1) as u32 })
            };
            for j in 0..seg { for i in 0..seg {
                let (a, b, c, d) = (id(i, j, &mut p), id(i + 1, j, &mut p), id(i, j + 1, &mut p), id(i + 1, j + 1, &mut p));
                if sgn > 0.0 { f.extend_from_slice(&[a, b, d, a, d, c]); } else { f.extend_from_slice(&[a, d, b, a, c, d]); }
            } }
        }
        (p.iter().flat_map(|v| v.iter().map(|&x| x as f32)).collect(), f)
    }
    fn report(q: &QuadMesh) -> (usize, usize, usize, usize) {
        let mut cnt = std::collections::HashMap::new();
        for f in q.faces.chunks(4) { let k = if f[3] == u32::MAX { 3 } else { 4 }; for e in 0..k { let (a, b) = (f[e], f[(e + 1) % k]); *cnt.entry((a.min(b), a.max(b))).or_insert(0) += 1; } }
        let bad = cnt.values().filter(|&&c| c != 2).count();
        let quads = q.faces.chunks(4).filter(|f| f[3] != u32::MAX).count();
        // faces turned the wrong way: their normal against the outward direction from the middle
        let at = |i: u32| [q.pos[i as usize * 3] as f64, q.pos[i as usize * 3 + 1] as f64, q.pos[i as usize * 3 + 2] as f64];
        let flipped = q.faces.chunks(4).filter(|f| { let (a, b, c) = (at(f[0]), at(f[1]), at(f[2])); let n = cross(sub(b, a), sub(c, a)); dot(n, add(add(a, b), c)) < 0.0 }).count();
        (q.faces.len() / 4, quads, bad, flipped)
    }
    #[test]
    #[ignore]
    fn from_files() {
        // GLINA_MESH=/path/name (name.pos: f32 xyz, name.idx: u32)
        let base = std::env::var("GLINA_MESH").unwrap();
        let rd = |e: &str| std::fs::read(format!("{base}.{e}")).unwrap();
        let pos: Vec<f32> = rd("pos").chunks(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
        let idx: Vec<u32> = rd("idx").chunks(4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
        let target: usize = std::env::var("GLINA_TARGET").map(|s| s.parse().unwrap()).unwrap_or(2500);
        let q = remesh(&pos, &idx, target, 1, &Attrs::default()).unwrap();
        let mut dir = std::collections::BTreeMap::new();
        for f in q.faces.chunks(4) { let k = if f[3] == u32::MAX { 3 } else { 4 }; for e in 0..k { *dir.entry((f[e], f[(e + 1) % k])).or_insert(0) += 1; } }
        let open: Vec<_> = dir.keys().filter(|&&(a, b)| !dir.contains_key(&(b, a))).collect();
        eprintln!("faces {} open {:?}", q.faces.len() / 4, open);
    }
    #[test]
    fn cube_keeps_its_edges() {
        let (pos, idx) = cube(40);
        let q = remesh(&pos, &idx, 600, 1, &Attrs::default()).unwrap();
        let (nf, quads, bad, flipped) = report(&q);
        let nv = q.pos.len() / 3;
        let corner = (0..nv).map(|i| (0..3).map(|k| (q.pos[i * 3 + k] as f64).abs()).sum::<f64>()).fold(0.0f64, f64::max);
        let on_edge = (0..nv).filter(|&i| { let a: Vec<f64> = (0..3).map(|k| (q.pos[i * 3 + k] as f64).abs()).collect(); a.iter().filter(|&&x| x > 0.995).count() >= 2 }).count();
        eprintln!("cube: faces {nf} quads {quads} bad {bad} flipped {flipped} corner {corner:.3} on edges {on_edge}");
        assert_eq!(bad, 0);
        assert_eq!(flipped, 0);
        assert!(quads as f64 > nf as f64 * 0.9, "quads {quads} of {nf}");
        assert!(corner > 2.95, "corner {corner}");
        assert!(on_edge >= 100, "vertices on the edges {on_edge}");
    }
    #[test]
    fn manifold_at_several_sizes() {
        let (pos, idx) = sphere(6);
        for target in [300usize, 1500, 3000, 6000] {
            let q = remesh(&pos, &idx, target, 1, &Attrs::default()).unwrap();
            let mut cnt = std::collections::HashMap::new();
            for f in q.faces.chunks(4) { let k = if f[3] == u32::MAX { 3 } else { 4 }; for e in 0..k { let (a, b) = (f[e], f[(e + 1) % k]); *cnt.entry((a.min(b), a.max(b))).or_insert(0) += 1; } }
            let bad = cnt.values().filter(|&&c| c != 2).count();
            eprintln!("target {target}: faces {} bad edges {bad}", q.faces.len() / 4);
            for (e, c) in cnt.iter() { if *c != 2 { let fs: Vec<_> = q.faces.chunks(4).filter(|f| { let k = if f[3] == u32::MAX { 3 } else { 4 }; (0..k).any(|i| { let (a, b) = (f[i], f[(i + 1) % k]); (a.min(b), a.max(b)) == *e }) }).collect(); eprintln!("  edge {e:?} count {c} faces {fs:?}"); } }
            assert_eq!(bad, 0, "target {target}");
        }
    }
    #[test]
    fn sphere_becomes_quads() {
        let (pos, idx) = sphere(5);
        let q = remesh(&pos, &idx, 1500, 1, &Attrs::default()).unwrap();
        let nf = q.faces.len() / 4;
        let quads = q.faces.chunks(4).filter(|f| f[3] != u32::MAX).count();
        let nv = q.pos.len() / 3;
        // on the sphere
        let worst = (0..nv).map(|i| ((q.pos[i * 3] as f64).powi(2) + (q.pos[i * 3 + 1] as f64).powi(2) + (q.pos[i * 3 + 2] as f64).powi(2)).sqrt()).fold(0.0f64, |a, r| a.max((r - 1.0).abs()));
        // edges: each in two faces (closed)
        let mut cnt = std::collections::HashMap::new();
        for f in q.faces.chunks(4) { let k = if f[3] == u32::MAX { 3 } else { 4 }; for e in 0..k { let (a, b) = (f[e], f[(e + 1) % k]); *cnt.entry((a.min(b), a.max(b))).or_insert(0) += 1; } }
        let open = cnt.values().filter(|&&c| c != 2).count();
        // valence 4 for most vertices
        let mut val = vec![0usize; nv];
        for (&(a, b), _) in cnt.iter() { val[a as usize] += 1; val[b as usize] += 1; }
        let v4 = val.iter().filter(|&&v| v == 4).count();
        eprintln!("faces {nf} quads {quads} verts {nv} worst {worst:.4} open {open} v4 {v4}");
        assert!(nf > 900 && nf < 2400, "faces {nf}");
        assert!(quads as f64 > nf as f64 * 0.85, "quads {quads} of {nf}");
        assert!(worst < 0.01, "off the sphere {worst}");
        assert!((open as f64) < cnt.len() as f64 * 0.01, "open edges {open}");
        assert!(v4 as f64 > nv as f64 * 0.8, "valence 4: {v4} of {nv}");
    }
}
