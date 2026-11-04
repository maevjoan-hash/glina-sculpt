//! Cloth (ZBrush: Dynamics): position-based dynamics on a triangle mesh.
//!
//! Every edge keeps its length (stretch), the two corners across every inner edge keep their distance
//! (bending, so a soft sheet folds and a firm one holds its shape), gravity pulls down −Y. Each vertex
//! has an inverse mass from 0 (masked: pinned) to 1. Collisions: other meshes, through a grid that keeps
//! the nearest triangle of every cell near their surface, and an optional floor. No self-collision.

use crate::{closest_on_tri, p3};

/// The nearest triangle of a set of meshes, per cell of a grid, in a band around their surface.
pub struct Collider {
    ox: f64, oy: f64, oz: f64, h: f64,
    nx: usize, ny: usize, nz: usize,
    tri: Vec<i32>,
    pos: Vec<f32>,
    idx: Vec<u32>,
}

impl Collider {
    /// `cell`: the wanted cell size (made bigger if the grid would get too large).
    pub fn new(pos: &[f32], idx: &[u32], cell: f64) -> Option<Collider> {
        if idx.len() < 3 { return None; }
        let mut lo = [f64::INFINITY; 3];
        let mut hi = [f64::NEG_INFINITY; 3];
        for &v in idx { let p = p3(pos, v as usize); for c in 0..3 { lo[c] = lo[c].min(p[c]); hi[c] = hi[c].max(p[c]); } }
        let mut h = cell.max(1e-6);
        let band = 3.0;
        let dims = |h: f64| -> [usize; 3] { [0, 1, 2].map(|c| ((hi[c] - lo[c]) / h).ceil() as usize + 2 * band as usize + 3) };
        while { let d = dims(h); d[0] * d[1] * d[2] > 6_000_000 } { h *= 1.25; }
        let d = dims(h);
        let (ox, oy, oz) = (lo[0] - (band + 1.0) * h, lo[1] - (band + 1.0) * h, lo[2] - (band + 1.0) * h);
        let mut tri = vec![-1i32; d[0] * d[1] * d[2]];
        let mut best = vec![f32::INFINITY; d[0] * d[1] * d[2]];
        for t in 0..idx.len() / 3 {
            let (a, b, c) = (p3(pos, idx[t * 3] as usize), p3(pos, idx[t * 3 + 1] as usize), p3(pos, idx[t * 3 + 2] as usize));
            let o = [ox, oy, oz];
            let mut r = [[0usize; 2]; 3];
            for q in 0..3 {
                let l = a[q].min(b[q]).min(c[q]) - band * h - o[q];
                let u = a[q].max(b[q]).max(c[q]) + band * h - o[q];
                r[q][0] = (l / h).ceil().max(0.0) as usize;
                r[q][1] = ((u / h).floor().max(0.0) as usize).min(d[q] - 1);
            }
            for k in r[2][0]..=r[2][1] {
                for j in r[1][0]..=r[1][1] {
                    for i in r[0][0]..=r[0][1] {
                        let g = i + j * d[0] + k * d[0] * d[1];
                        let (_, dd) = closest_on_tri(a, b, c, [ox + i as f64 * h, oy + j as f64 * h, oz + k as f64 * h]);
                        if (dd as f32) < best[g] { best[g] = dd as f32; tri[g] = t as i32; }
                    }
                }
            }
        }
        Some(Collider { ox, oy, oz, h, nx: d[0], ny: d[1], nz: d[2], tri, pos: pos.to_vec(), idx: idx.to_vec() })
    }

    /// Where a point closer than `thick` to the surface (or behind it) must go: `thick` in front of it.
    pub fn push(&self, p: [f64; 3], thick: f64) -> Option<[f64; 3]> {
        let fi = ((p[0] - self.ox) / self.h).round();
        let fj = ((p[1] - self.oy) / self.h).round();
        let fk = ((p[2] - self.oz) / self.h).round();
        if fi < 0.0 || fj < 0.0 || fk < 0.0 { return None; }
        let (i, j, k) = (fi as usize, fj as usize, fk as usize);
        if i >= self.nx || j >= self.ny || k >= self.nz { return None; }
        let t = self.tri[i + j * self.nx + k * self.nx * self.ny];
        if t < 0 { return None; }
        let t = t as usize;
        let (a, b, c) = (p3(&self.pos, self.idx[t * 3] as usize), p3(&self.pos, self.idx[t * 3 + 1] as usize), p3(&self.pos, self.idx[t * 3 + 2] as usize));
        let (q, d2) = closest_on_tri(a, b, c, p);
        let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let mut n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        let nl = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
        if nl < 1e-20 { return None; }
        for x in n.iter_mut() { *x /= nl; }
        let dp = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
        let side = dp[0] * n[0] + dp[1] * n[1] + dp[2] * n[2];
        let dist = d2.sqrt();
        if side < 0.0 {
            // behind the surface: out along its normal
            return Some([q[0] + n[0] * thick, q[1] + n[1] * thick, q[2] + n[2] * thick]);
        }
        if dist < thick {
            let dir = if dist > 1e-12 { [dp[0] / dist, dp[1] / dist, dp[2] / dist] } else { n };
            return Some([q[0] + dir[0] * thick, q[1] + dir[1] * thick, q[2] + dir[2] * thick]);
        }
        None
    }
}

#[derive(Clone, Copy, Debug)]
pub struct ClothParams {
    /// downward acceleration, in model units per second²
    pub gravity: f64,
    /// 0…1: how firmly edges keep their length
    pub stretch: f64,
    /// 0…1: how firmly the sheet keeps its folds (0: hangs like silk, 1: like leather)
    pub bend: f64,
    /// 0…1 of the speed kept each step
    pub damping: f64,
    /// how far from colliders and the floor the cloth stays
    pub thick: f64,
    /// the floor's height (−∞: none)
    pub floor: f64,
    /// constraint passes per step
    pub iters: u32,
    /// the most a vertex may move in one step (a cell of the collider), so nothing jumps through a wall
    pub max_step: f64,
}

pub struct Cloth {
    pub x: Vec<f64>,
    prev: Vec<f64>,
    w: Vec<f64>,
    cons: Vec<(u32, u32, f64, f64)>,
    collider: Option<Collider>,
    p: ClothParams,
}

impl Cloth {
    pub fn new(pos: &[f32], idx: &[u32], inv_mass: &[f32], collider: Option<Collider>, p: ClothParams) -> Cloth {
        let n = pos.len() / 3;
        let x: Vec<f64> = pos.iter().map(|&v| v as f64).collect();
        let w: Vec<f64> = (0..n).map(|i| (inv_mass[i] as f64).clamp(0.0, 1.0)).collect();
        // edges, each with the third corners of its (up to two) faces
        let mut edges: std::collections::HashMap<(u32, u32), (u32, i64)> = std::collections::HashMap::new();
        for f in idx.chunks_exact(3) {
            for e in 0..3 {
                let (a, b, c) = (f[e], f[(e + 1) % 3], f[(e + 2) % 3]);
                let key = (a.min(b), a.max(b));
                edges.entry(key).and_modify(|v| { if v.1 < 0 { v.1 = c as i64; } }).or_insert((c, -1));
            }
        }
        let len = |a: u32, b: u32| {
            let (a, b) = (a as usize * 3, b as usize * 3);
            ((x[a] - x[b]).powi(2) + (x[a + 1] - x[b + 1]).powi(2) + (x[a + 2] - x[b + 2]).powi(2)).sqrt()
        };
        let mut cons = Vec::with_capacity(edges.len() * 2);
        for (&(a, b), &(c, d)) in &edges {
            cons.push((a, b, len(a, b), p.stretch));
            if d >= 0 && p.bend > 0.0 { let d = d as u32; cons.push((c, d, len(c, d), p.bend)); }
        }
        // a fixed order, so a run is the same every time
        cons.sort_by(|p, q| (p.0, p.1).cmp(&(q.0, q.1)));
        Cloth { prev: x.clone(), x, w, cons, collider, p }
    }

    fn collide(&mut self, i: usize) {
        let k = i * 3;
        let mut q = [self.x[k], self.x[k + 1], self.x[k + 2]];
        let mut hit = false;
        if q[1] < self.p.floor + self.p.thick { q[1] = self.p.floor + self.p.thick; hit = true; }
        if let Some(c) = &self.collider { if let Some(r) = c.push(q, self.p.thick) { q = r; hit = true; } }
        if hit {
            // friction: what was left of this step's motion slows down
            for c in 0..3 { self.x[k + c] = q[c]; self.prev[k + c] += (q[c] - self.prev[k + c]) * 0.6; }
        }
    }

    /// `steps` steps of `dt` seconds each.
    pub fn step(&mut self, steps: u32, dt: f64) {
        let n = self.w.len();
        for _ in 0..steps {
            let g = self.p.gravity * dt * dt;
            for i in 0..n {
                let w = self.w[i];
                if w <= 0.0 { continue; }
                let k = i * 3;
                let mut v = [0f64; 3];
                for c in 0..3 { v[c] = (self.x[k + c] - self.prev[k + c]) * self.p.damping - if c == 1 { g * w } else { 0.0 }; }
                let vl = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
                if vl > self.p.max_step { for x in v.iter_mut() { *x *= self.p.max_step / vl; } }
                for c in 0..3 { self.prev[k + c] = self.x[k + c]; self.x[k + c] += v[c]; }
            }
            for _ in 0..self.p.iters.max(1) {
                for &(a, b, rest, stiff) in &self.cons {
                    let (a, b) = (a as usize, b as usize);
                    let (wa, wb) = (self.w[a], self.w[b]);
                    let ws = wa + wb;
                    if ws <= 0.0 { continue; }
                    let (ka, kb) = (a * 3, b * 3);
                    let d = [self.x[kb] - self.x[ka], self.x[kb + 1] - self.x[ka + 1], self.x[kb + 2] - self.x[ka + 2]];
                    let l = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
                    if l < 1e-12 { continue; }
                    let s = (l - rest) / l * stiff / ws;
                    for c in 0..3 { self.x[ka + c] += d[c] * s * wa; self.x[kb + c] -= d[c] * s * wb; }
                }
            }
            for i in 0..n { if self.w[i] > 0.0 { self.collide(i); } }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // a square sheet in the xz plane at height y, s×s cells
    fn sheet(s: usize, size: f64, y: f64) -> (Vec<f32>, Vec<u32>) {
        let (mut pos, mut idx) = (Vec::new(), Vec::new());
        for j in 0..=s { for i in 0..=s { pos.extend_from_slice(&[(i as f64 / s as f64 - 0.5) as f32 * size as f32, y as f32, (j as f64 / s as f64 - 0.5) as f32 * size as f32]); } }
        for j in 0..s { for i in 0..s { let a = (j * (s + 1) + i) as u32; let b = a + 1; let c = a + s as u32 + 1; let d = c + 1; idx.extend_from_slice(&[a, c, b, b, c, d]); } }
        (pos, idx)
    }
    fn params(floor: f64) -> ClothParams { ClothParams { gravity: 9.8, stretch: 1.0, bend: 0.1, damping: 0.99, thick: 0.01, floor, iters: 8, max_step: 0.03 } }

    #[test]
    fn falls_and_stops_on_the_floor() {
        let (pos, idx) = sheet(10, 1.0, 1.0);
        let w = vec![1.0f32; pos.len() / 3];
        let mut c = Cloth::new(&pos, &idx, &w, None, params(0.0));
        c.step(600, 1.0 / 120.0);
        for i in 0..w.len() { assert!((c.x[i * 3 + 1] - 0.01).abs() < 0.01, "y {}", c.x[i * 3 + 1]); }
    }

    #[test]
    fn pinned_corner_stays_and_edges_keep_their_length() {
        let (pos, idx) = sheet(10, 1.0, 1.0);
        let mut w = vec![1.0f32; pos.len() / 3];
        w[0] = 0.0;
        let mut c = Cloth::new(&pos, &idx, &w, None, params(f64::NEG_INFINITY));
        c.step(300, 1.0 / 120.0);
        assert_eq!([c.x[0], c.x[1], c.x[2]], [pos[0] as f64, pos[1] as f64, pos[2] as f64]);
        // hanging from one corner: the far corner ends up far below it, but not stretched much
        let far = (w.len() - 1) * 3;
        assert!(c.x[far + 1] < 0.5);
        let a = (0, 1usize);
        let l = ((c.x[a.0 * 3] - c.x[a.1 * 3]).powi(2) + (c.x[a.0 * 3 + 1] - c.x[a.1 * 3 + 1]).powi(2) + (c.x[a.0 * 3 + 2] - c.x[a.1 * 3 + 2]).powi(2)).sqrt();
        assert!((l - 0.1).abs() < 0.03, "edge {}", l);
    }

    #[test]
    fn drapes_over_a_box_instead_of_passing_through() {
        let (pos, idx) = sheet(20, 1.2, 0.8);
        let w = vec![1.0f32; pos.len() / 3];
        // a box from −0.25 to 0.25, top at y = 0.5
        let (mut bp, mut bi) = (Vec::new(), Vec::new());
        for k in 0..8u32 { bp.extend_from_slice(&[if k & 1 != 0 { 0.25 } else { -0.25 }, if k & 2 != 0 { 0.5 } else { -0.5 }, if k & 4 != 0 { 0.25 } else { -0.25 }]); }
        for f in [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]] { bi.extend_from_slice(&[f[0], f[1], f[2], f[0], f[2], f[3]]); }
        let col = Collider::new(&bp, &bi, 0.03);
        let mut c = Cloth::new(&pos, &idx, &w, col, params(-0.5));
        c.step(400, 1.0 / 120.0);
        // the middle of the sheet rests on the top of the box
        let mid = (10 * 21 + 10) * 3;
        assert!((c.x[mid + 1] - 0.51).abs() < 0.03, "mid y {}", c.x[mid + 1]);
    }
}
