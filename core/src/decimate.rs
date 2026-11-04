//! Decimation (ZBrush: Decimation Master): fewer triangles, the same shape.
//!
//! Garland and Heckbert's quadric error metric: every vertex carries the sum of the planes of its faces
//! (a quadric); an edge collapses to the point that is nearest to both ends' planes, and the cheapest
//! edge goes first. Open rims and polygroup borders get extra planes square to them, so they keep their
//! line. An edge collapses only if that keeps the mesh a manifold (the link condition) and turns no face
//! over. Colour, mask and group follow the vertex that stays (blended at the new point).

use std::cmp::Ordering;
use std::collections::BinaryHeap;

#[derive(Clone, Copy, Default)]
struct Q([f64; 10]);   // a symmetric 4×4 matrix: aa ab ac ad bb bc bd cc cd dd

impl Q {
    fn plane(a: f64, b: f64, c: f64, d: f64, w: f64) -> Q {
        Q([a * a * w, a * b * w, a * c * w, a * d * w, b * b * w, b * c * w, b * d * w, c * c * w, c * d * w, d * d * w])
    }
    fn add(&mut self, o: &Q) { for i in 0..10 { self.0[i] += o.0[i]; } }
    fn sum(a: &Q, b: &Q) -> Q { let mut q = *a; q.add(b); q }
    fn err(&self, p: [f64; 3]) -> f64 {
        let q = &self.0;
        let (x, y, z) = (p[0], p[1], p[2]);
        q[0] * x * x + 2.0 * q[1] * x * y + 2.0 * q[2] * x * z + 2.0 * q[3] * x + q[4] * y * y + 2.0 * q[5] * y * z + 2.0 * q[6] * y + q[7] * z * z + 2.0 * q[8] * z + q[9]
    }
    // the point of least error, if the 3×3 part can be solved
    fn best(&self) -> Option<[f64; 3]> {
        let q = &self.0;
        let m = [[q[0], q[1], q[2]], [q[1], q[4], q[5]], [q[2], q[5], q[7]]];
        let b = [-q[3], -q[6], -q[8]];
        let det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
        let scale = m[0][0].abs() + m[1][1].abs() + m[2][2].abs();
        if !(det.abs() > 1e-10 * scale * scale * scale) { return None; }
        let inv = 1.0 / det;
        let col = |k: usize| { let mut a = m; for r in 0..3 { a[r][k] = b[r]; } a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]) };
        Some([col(0) * inv, col(1) * inv, col(2) * inv])
    }
}

#[derive(PartialEq)]
struct Cand { cost: f64, a: u32, b: u32, sa: u32, sb: u32 }
impl Eq for Cand {}
impl PartialOrd for Cand { fn partial_cmp(&self, o: &Self) -> Option<Ordering> { Some(self.cmp(o)) } }
impl Ord for Cand {
    // (BinaryHeap is a max-heap: the cheapest first)
    fn cmp(&self, o: &Self) -> Ordering { o.cost.partial_cmp(&self.cost).unwrap_or(Ordering::Equal).then_with(|| (o.a, o.b).cmp(&(self.a, self.b))) }
}

// the vertices around v (corners of its live faces)
fn ring(vf: &[Vec<u32>], alive: &[bool], faces: &[[u32; 3]], v: usize, out: &mut Vec<u32>) {
    out.clear();
    for &t in &vf[v] { if !alive[t as usize] { continue; } for &u in &faces[t as usize] { if u as usize != v && !out.contains(&u) { out.push(u); } } }
}

pub struct Mesh { pub pos: Vec<f32>, pub idx: Vec<u32>, pub col: Vec<f32>, pub mask: Vec<f32>, pub grp: Vec<f32> }

/// Down to about `target` triangles.
pub fn decimate(pos: &[f32], idx: &[u32], col: &[f32], mask: &[f32], grp: &[f32], target: usize) -> Mesh {
    let n = pos.len() / 3;
    let mut p: Vec<[f64; 3]> = (0..n).map(|i| [pos[i * 3] as f64, pos[i * 3 + 1] as f64, pos[i * 3 + 2] as f64]).collect();
    let mut c: Vec<[f32; 3]> = (0..n).map(|i| [col[i * 3], col[i * 3 + 1], col[i * 3 + 2]]).collect();
    let mut mk: Vec<f32> = mask.to_vec();
    let g: Vec<f32> = grp.to_vec();
    let mut faces: Vec<[u32; 3]> = idx.chunks_exact(3).map(|f| [f[0], f[1], f[2]]).collect();
    let mut alive = vec![true; faces.len()];
    let mut vf: Vec<Vec<u32>> = vec![Vec::new(); n];
    for (t, f) in faces.iter().enumerate() { for &v in f { vf[v as usize].push(t as u32); } }
    let face_n = |p: &Vec<[f64; 3]>, f: &[u32; 3]| -> ([f64; 3], f64) {
        let (a, b, cc) = (p[f[0] as usize], p[f[1] as usize], p[f[2] as usize]);
        let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let v = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]];
        let nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        let l = (nn[0] * nn[0] + nn[1] * nn[1] + nn[2] * nn[2]).sqrt();
        if l < 1e-30 { ([0.0; 3], 0.0) } else { ([nn[0] / l, nn[1] / l, nn[2] / l], l * 0.5) }
    };
    // quadrics: the faces' planes, weighted by area
    let mut q = vec![Q::default(); n];
    for f in &faces {
        let (nn, area) = face_n(&p, f);
        if area <= 0.0 { continue; }
        let a = p[f[0] as usize];
        let d = -(nn[0] * a[0] + nn[1] * a[1] + nn[2] * a[2]);
        let pl = Q::plane(nn[0], nn[1], nn[2], d, area);
        for &v in f { q[v as usize].add(&pl); }
    }
    // rims and group borders: a heavy plane square to the face through the edge
    let mut count: std::collections::HashMap<(u32, u32), (u32, usize)> = std::collections::HashMap::new();
    for (t, f) in faces.iter().enumerate() { for e in 0..3 { let (a, b) = (f[e], f[(e + 1) % 3]); count.entry((a.min(b), a.max(b))).and_modify(|x| x.0 += 1).or_insert((1, t)); } }
    for (&(a, b), &(k, t)) in &count {
        let border = k == 1 || g[a as usize] != g[b as usize];
        if !border { continue; }
        let (nn, area) = face_n(&p, &faces[t]);
        if area <= 0.0 { continue; }
        let (pa, pb) = (p[a as usize], p[b as usize]);
        let e = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
        let s = [e[1] * nn[2] - e[2] * nn[1], e[2] * nn[0] - e[0] * nn[2], e[0] * nn[1] - e[1] * nn[0]];
        let sl = (s[0] * s[0] + s[1] * s[1] + s[2] * s[2]).sqrt();
        if sl < 1e-30 { continue; }
        let s = [s[0] / sl, s[1] / sl, s[2] / sl];
        let d = -(s[0] * pa[0] + s[1] * pa[1] + s[2] * pa[2]);
        let w = (e[0] * e[0] + e[1] * e[1] + e[2] * e[2]) * 100.0;
        let pl = Q::plane(s[0], s[1], s[2], d, w);
        q[a as usize].add(&pl); q[b as usize].add(&pl);
    }
    // each vertex's quadric changes only when an edge collapses into it: entries made before are stale
    let mut stamp = vec![0u32; n];
    let place = |q: &Q, a: [f64; 3], b: [f64; 3]| -> ([f64; 3], f64) {
        let mid = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0, (a[2] + b[2]) / 2.0];
        let mut best = (mid, q.err(mid));
        for cand in [a, b] { let e = q.err(cand); if e < best.1 { best = (cand, e); } }
        if let Some(o) = q.best() {
            // (only near the edge: far away the solution of a nearly flat quadric is noise)
            let len = ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt();
            let off = ((o[0] - mid[0]).powi(2) + (o[1] - mid[1]).powi(2) + (o[2] - mid[2]).powi(2)).sqrt();
            if off < len * 0.5 { let e = q.err(o); if e <= best.1 { best = (o, e); } }
        }
        best
    };
    let mut heap = BinaryHeap::new();
    for &(a, b) in count.keys() {
        let qq = Q::sum(&q[a as usize], &q[b as usize]);
        let (_, e) = place(&qq, p[a as usize], p[b as usize]);
        heap.push(Cand { cost: e.max(0.0), a, b, sa: 0, sb: 0 });
    }
    let mut live = faces.len();
    let mut nbuf: Vec<u32> = Vec::new();
    while live > target {
        let Some(cd) = heap.pop() else { break };
        let (a, b) = (cd.a as usize, cd.b as usize);
        if cd.sa != stamp[a] || cd.sb != stamp[b] { continue; }   // (an older entry: an end has changed since)
        if vf[a].is_empty() || vf[b].is_empty() { continue; }
        // the faces on the edge, and the link condition: the ends share exactly the corners of those faces
        let shared: Vec<u32> = vf[a].iter().copied().filter(|&t| alive[t as usize] && faces[t as usize].contains(&(b as u32))).collect();
        if shared.is_empty() || shared.len() > 2 { continue; }
        ring(&vf, &alive, &faces, a, &mut nbuf);
        let ra = nbuf.clone();
        ring(&vf, &alive, &faces, b, &mut nbuf);
        let common = ra.iter().filter(|u| nbuf.contains(u)).count();
        if common != shared.len() { continue; }
        let qq = Q::sum(&q[a], &q[b]);
        let (np, _) = place(&qq, p[a], p[b]);
        // no face may turn over
        let mut flips = false;
        for &v in &[a, b] {
            for &t in &vf[v] {
                let t = t as usize;
                if !alive[t] || shared.contains(&(t as u32)) { continue; }
                let f = faces[t];
                let (before, _) = face_n(&p, &f);
                let mut pp = [p[f[0] as usize], p[f[1] as usize], p[f[2] as usize]];
                for k in 0..3 { if f[k] as usize == a || f[k] as usize == b { pp[k] = np; } }
                let u = [pp[1][0] - pp[0][0], pp[1][1] - pp[0][1], pp[1][2] - pp[0][2]];
                let w = [pp[2][0] - pp[0][0], pp[2][1] - pp[0][1], pp[2][2] - pp[0][2]];
                let nn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
                let l = (nn[0] * nn[0] + nn[1] * nn[1] + nn[2] * nn[2]).sqrt();
                if l < 1e-30 || (nn[0] * before[0] + nn[1] * before[1] + nn[2] * before[2]) / l < 0.2 { flips = true; break; }
            }
            if flips { break; }
        }
        if flips { continue; }
        // collapse b into a
        let la = ((np[0] - p[a][0]).powi(2) + (np[1] - p[a][1]).powi(2) + (np[2] - p[a][2]).powi(2)).sqrt();
        let lb = ((np[0] - p[b][0]).powi(2) + (np[1] - p[b][1]).powi(2) + (np[2] - p[b][2]).powi(2)).sqrt();
        let t = if la + lb > 0.0 { (la / (la + lb)) as f32 } else { 0.5 };
        for k in 0..3 { c[a][k] += (c[b][k] - c[a][k]) * t; }
        mk[a] += (mk[b] - mk[a]) * t;
        p[a] = np;
        q[a] = qq;
        for &s in &shared { alive[s as usize] = false; live -= 1; }
        let moved: Vec<u32> = vf[b].drain(..).collect();
        for t in moved {
            let tt = t as usize;
            if !alive[tt] { continue; }
            for k in 0..3 { if faces[tt][k] as usize == b { faces[tt][k] = a as u32; } }
            vf[a].push(t);
        }
        vf[a].retain(|&t| alive[t as usize]);
        stamp[a] += 1;
        ring(&vf, &alive, &faces, a, &mut nbuf);
        for &u in nbuf.clone().iter() {
            let u = u as usize;
            let qq = Q::sum(&q[a], &q[u]);
            let (_, e) = place(&qq, p[a], p[u]);
            heap.push(Cand { cost: e.max(0.0), a: a as u32, b: u as u32, sa: stamp[a], sb: stamp[u] });
        }
    }
    // compact
    let mut map = vec![u32::MAX; n];
    let mut out = Mesh { pos: Vec::new(), idx: Vec::new(), col: Vec::new(), mask: Vec::new(), grp: Vec::new() };
    for (t, f) in faces.iter().enumerate() {
        if !alive[t] { continue; }
        for &v in f {
            let v = v as usize;
            if map[v] == u32::MAX {
                map[v] = (out.pos.len() / 3) as u32;
                out.pos.extend_from_slice(&[p[v][0] as f32, p[v][1] as f32, p[v][2] as f32]);
                out.col.extend_from_slice(&c[v]); out.mask.push(mk[v]); out.grp.push(g[v]);
            }
            out.idx.push(map[v]);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sphere(sub: usize) -> (Vec<f32>, Vec<u32>) {
        // a UV sphere
        let (mut pos, mut idx) = (Vec::new(), Vec::new());
        let (nu, nv) = (sub * 2, sub);
        pos.extend_from_slice(&[0.0, 1.0, 0.0]);
        for j in 1..nv { let th = std::f32::consts::PI * j as f32 / nv as f32; for i in 0..nu { let ph = 2.0 * std::f32::consts::PI * i as f32 / nu as f32; pos.extend_from_slice(&[th.sin() * ph.cos(), th.cos(), th.sin() * ph.sin()]); } }
        pos.extend_from_slice(&[0.0, -1.0, 0.0]);
        let last = (pos.len() / 3 - 1) as u32;
        let r = |j: usize, i: usize| (1 + (j - 1) * nu + i % nu) as u32;
        for i in 0..nu { idx.extend_from_slice(&[0, r(1, i + 1), r(1, i)]); }
        for j in 1..nv - 1 { for i in 0..nu { idx.extend_from_slice(&[r(j, i), r(j, i + 1), r(j + 1, i + 1), r(j, i), r(j + 1, i + 1), r(j + 1, i)]); } }
        for i in 0..nu { idx.extend_from_slice(&[last, r(nv - 1, i), r(nv - 1, i + 1)]); }
        (pos, idx)
    }
    #[test]
    fn two_groups_and_few_triangles_stay_on_the_sphere() {
        let (pos, idx) = sphere(60);
        let n = pos.len() / 3;
        let grp: Vec<f32> = (0..n).map(|i| if pos[i * 3 + 1] > 0.0 { 1.0 } else { 0.0 }).collect();
        let f0 = idx.len() / 3;
        let m = decimate(&pos, &idx, &vec![1.0; n * 3], &vec![0.0; n], &grp, f0 / 60);
        let mut worst = 0f32;
        for i in 0..m.pos.len() / 3 { let r = (m.pos[i * 3].powi(2) + m.pos[i * 3 + 1].powi(2) + m.pos[i * 3 + 2].powi(2)).sqrt(); worst = worst.max((r - 1.0).abs()); }
        assert!(worst < 0.08, "worst {} with {} triangles", worst, m.idx.len() / 3);
    }

    #[test]
    fn a_sphere_keeps_its_shape_with_a_tenth_of_the_triangles() {
        let (pos, idx) = sphere(60);
        let n = pos.len() / 3;
        let f0 = idx.len() / 3;
        let m = decimate(&pos, &idx, &vec![1.0; n * 3], &vec![0.0; n], &vec![0.0; n], f0 / 10);
        let f1 = m.idx.len() / 3;
        assert!(f1 <= f0 / 10 + 2 && f1 > f0 / 12, "{} → {}", f0, f1);
        for i in 0..m.pos.len() / 3 { let r = (m.pos[i * 3].powi(2) + m.pos[i * 3 + 1].powi(2) + m.pos[i * 3 + 2].powi(2)).sqrt(); assert!((r - 1.0).abs() < 0.03, "r {}", r); }
        // still closed
        let mut e = std::collections::HashMap::new();
        for f in m.idx.chunks_exact(3) { for k in 0..3 { let (a, b) = (f[k], f[(k + 1) % 3]); *e.entry((a.min(b), a.max(b))).or_insert(0) += 1; } }
        assert!(e.values().all(|&c| c == 2));
    }
}
