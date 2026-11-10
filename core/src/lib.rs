//! The heavy geometry of Глина, built to WebAssembly (`cargo build --release --target wasm32-unknown-unknown`).
//!
//! Voxel remesh (ZBrush: DynaMesh) of one or more closed meshes, combined as booleans: each part adds
//! its volume, takes it away or keeps only what it shares with the parts before it. The steps follow
//! the JavaScript version in index.html, which stays as the fallback:
//!   1. inside / outside per grid point from the winding number along z columns;
//!   2. unsigned distance (and the closest triangle) in a narrow band around every triangle;
//!   3. the parts folded into one signed field (min for add, max(a, −b) for subtract, max for intersect);
//!   4. Surface Nets on the inside flags, one relaxing pass, then every new vertex projected onto the
//!      closest triangle, which also gives it that triangle's colour, mask and polygroup.
//!
//! The JavaScript side talks to it through plain exports: `mem_alloc` / `mem_free` for the inputs,
//! `voxel_csg` to run, and `out_ptr` / `out_len` / `out_res` / `out_clear` to read the result.
//! Cloth (cloth.rs) keeps its state between calls: `cloth_init`, `cloth_step`, `cloth_pos`, `cloth_free`.

pub mod brush;
pub mod cloth;
pub mod decimate;
pub mod dyntopo;
pub mod multires;
pub mod quadmesh;
pub mod subdiv;
pub mod uv;

use std::alloc::{alloc, dealloc, Layout};
use std::cell::RefCell;

pub const OP_ADD: u32 = 0;
pub const OP_SUBTRACT: u32 = 1;
pub const OP_INTERSECT: u32 = 2;

/// One input mesh: the triangles `t0..t1` of the shared arrays, and how it combines with the parts before it.
#[derive(Clone, Copy, Debug)]
pub struct Part { pub t0: usize, pub t1: usize, pub op: u32 }

pub struct Input<'a> {
    pub pos: &'a [f32],
    pub idx: &'a [u32],
    pub col: &'a [f32],
    pub mask: &'a [f32],
    pub grp: &'a [f32],
}

#[derive(Default, Debug)]
pub struct Output {
    pub pos: Vec<f32>,
    pub idx: Vec<u32>,
    pub col: Vec<f32>,
    pub mask: Vec<f32>,
    pub grp: Vec<f32>,
    /// the resolution actually used (lowered when the grid would not fit in memory)
    pub res: u32,
    /// the same surface as quads (4 corners each), where the voxel cells made them
    pub quads: Vec<u32>,
}

/// The grid may take this much memory (bytes); phones have little to spare.
const GRID_BUDGET: f64 = 300e6;

#[inline]
pub(crate) fn p3(p: &[f32], v: usize) -> [f64; 3] { [p[v * 3] as f64, p[v * 3 + 1] as f64, p[v * 3 + 2] as f64] }

/// The closest point of triangle abc to p and its squared distance (Ericson, Real-Time Collision Detection 5.1.5).
pub fn closest_on_tri(a: [f64; 3], b: [f64; 3], c: [f64; 3], p: [f64; 3]) -> ([f64; 3], f64) {
    let ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let dot = |u: [f64; 3], v: [f64; 3]| u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    let ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    let d1 = dot(ab, ap);
    let d2 = dot(ac, ap);
    let (u, v);
    if d1 <= 0.0 && d2 <= 0.0 { u = 0.0; v = 0.0; } else {
        let bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
        let d3 = dot(ab, bp);
        let d4 = dot(ac, bp);
        if d3 >= 0.0 && d4 <= d3 { u = 1.0; v = 0.0; } else {
            let vc = d1 * d4 - d3 * d2;
            if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 { u = d1 / (d1 - d3); v = 0.0; } else {
                let cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
                let d5 = dot(ab, cp);
                let d6 = dot(ac, cp);
                if d6 >= 0.0 && d5 <= d6 { u = 0.0; v = 1.0; } else {
                    let vb = d5 * d2 - d1 * d6;
                    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 { u = 0.0; v = d2 / (d2 - d6); } else {
                        let va = d3 * d6 - d5 * d4;
                        if va <= 0.0 && d4 - d3 >= 0.0 && d5 - d6 >= 0.0 {
                            let w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
                            u = 1.0 - w; v = w;
                        } else {
                            let den = 1.0 / (va + vb + vc);
                            u = vb * den; v = vc * den;
                        }
                    }
                }
            }
        }
    }
    let q = [a[0] + ab[0] * u + ac[0] * v, a[1] + ab[1] * u + ac[1] * v, a[2] + ab[2] * u + ac[2] * v];
    let d = (p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2) + (p[2] - q[2]).powi(2);
    (q, d)
}

pub(crate) fn bary(a: [f64; 3], b: [f64; 3], c: [f64; 3], p: [f64; 3]) -> [f64; 3] { bary_of(a, b, c, p) }
fn bary_of(a: [f64; 3], b: [f64; 3], c: [f64; 3], p: [f64; 3]) -> [f64; 3] {
    let v0 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let v1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let v2 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    let dot = |u: [f64; 3], v: [f64; 3]| u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    let (d00, d01, d11, d20, d21) = (dot(v0, v0), dot(v0, v1), dot(v1, v1), dot(v2, v0), dot(v2, v1));
    let den = d00 * d11 - d01 * d01;
    if den.abs() < 1e-30 { return [1.0, 0.0, 0.0]; }
    let v = (d11 * d20 - d01 * d21) / den;
    let w = (d00 * d21 - d01 * d20) / den;
    [1.0 - v - w, v, w]
}

struct Grid { ox: f64, oy: f64, oz: f64, h: f64, nx: usize, ny: usize, nz: usize }
impl Grid {
    #[inline] fn at(&self, i: usize, j: usize, k: usize) -> usize { i + j * self.nx + k * self.nx * self.ny }
    #[inline] fn sxy(&self) -> usize { self.nx * self.ny }
    #[inline] fn n(&self) -> usize { self.nx * self.ny * self.nz }
}

/// Inside flags of one part, by the winding number along z columns (nonzero rule: a shell wound the
/// other way is still solid). Column centres are nudged off the grid so no ray meets an edge exactly.
fn winding(inp: &Input, part: &Part, g: &Grid, inside: &mut [u8]) {
    let (h, nx, ny, nz, sxy) = (g.h, g.nx, g.ny, g.nz, g.sxy());
    let ex = h * 1.37e-4;
    let ey = h * 2.71e-4;
    let mut cols: Vec<Vec<(f64, i8)>> = vec![Vec::new(); nx * ny];
    for t in part.t0..part.t1 {
        let (a, b, c) = (inp.idx[t * 3] as usize, inp.idx[t * 3 + 1] as usize, inp.idx[t * 3 + 2] as usize);
        let (pa, pb, pc) = (p3(inp.pos, a), p3(inp.pos, b), p3(inp.pos, c));
        let area = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pc[0] - pa[0]) * (pb[1] - pa[1]);
        if area.abs() < 1e-20 { continue; }
        let lo = |v: f64| v.max(0.0);
        let i0 = lo(((pa[0].min(pb[0]).min(pc[0])) - g.ox - ex) / h).ceil() as i64;
        let i1 = (((pa[0].max(pb[0]).max(pc[0])) - g.ox - ex) / h).floor().min(nx as f64 - 1.0) as i64;
        let j0 = lo(((pa[1].min(pb[1]).min(pc[1])) - g.oy - ey) / h).ceil() as i64;
        let j1 = (((pa[1].max(pb[1]).max(pc[1])) - g.oy - ey) / h).floor().min(ny as f64 - 1.0) as i64;
        if i1 < i0 || j1 < j0 { continue; }
        for j in j0..=j1 {
            for i in i0..=i1 {
                let px = g.ox + i as f64 * h + ex;
                let py = g.oy + j as f64 * h + ey;
                let w0 = ((pb[0] - px) * (pc[1] - py) - (pc[0] - px) * (pb[1] - py)) / area;
                let w1 = ((pc[0] - px) * (pa[1] - py) - (pa[0] - px) * (pc[1] - py)) / area;
                let w2 = 1.0 - w0 - w1;
                if w0 < 0.0 || w1 < 0.0 || w2 < 0.0 { continue; }
                let z = w0 * pa[2] + w1 * pb[2] + w2 * pc[2];
                // a face seen from below (normal down) is where the ray enters
                cols[i as usize + j as usize * nx].push((z, if area > 0.0 { -1 } else { 1 }));
            }
        }
    }
    for (key, l) in cols.iter_mut().enumerate() {
        if l.is_empty() { continue; }
        l.sort_by(|p, q| p.0.partial_cmp(&q.0).unwrap_or(std::cmp::Ordering::Equal));
        let mut wind = 0i32;
        let mut q = 0;
        for k in 0..nz {
            let z = g.oz + k as f64 * h;
            while q < l.len() && l[q].0 < z { wind += l[q].1 as i32; q += 1; }
            if wind != 0 { inside[key + k * sxy] = 1; }
        }
    }
}

/// Squared distance to the nearest triangle of one part within a band of 1.8 cells, and which triangle.
fn band_distance(inp: &Input, part: &Part, g: &Grid, d: &mut [f32], tri: &mut [i32]) {
    let (h, nx, ny, nz) = (g.h, g.nx, g.ny, g.nz);
    let band = 1.8 * h;
    for t in part.t0..part.t1 {
        let (a, b, c) = (inp.idx[t * 3] as usize, inp.idx[t * 3 + 1] as usize, inp.idx[t * 3 + 2] as usize);
        let (pa, pb, pc) = (p3(inp.pos, a), p3(inp.pos, b), p3(inp.pos, c));
        let mut r = [[0i64; 2]; 3];
        let o = [g.ox, g.oy, g.oz];
        let n = [nx, ny, nz];
        for q in 0..3 {
            let lo = pa[q].min(pb[q]).min(pc[q]) - band - o[q];
            let hi = pa[q].max(pb[q]).max(pc[q]) + band - o[q];
            r[q][0] = (lo / h).ceil().max(0.0) as i64;
            r[q][1] = (hi / h).floor().min(n[q] as f64 - 1.0) as i64;
        }
        if r[0][1] < r[0][0] || r[1][1] < r[1][0] || r[2][1] < r[2][0] { continue; }
        for k in r[2][0]..=r[2][1] {
            for j in r[1][0]..=r[1][1] {
                for i in r[0][0]..=r[0][1] {
                    let gi = g.at(i as usize, j as usize, k as usize);
                    let p = [g.ox + i as f64 * h, g.oy + j as f64 * h, g.oz + k as f64 * h];
                    let (_, dd) = closest_on_tri(pa, pb, pc, p);
                    if (dd as f32) < d[gi] { d[gi] = dd as f32; tri[gi] = t as i32; }
                }
            }
        }
    }
}

/// The remeshed (and combined) surface. `res` is the number of cells along the longest side. `sharp`:
/// each cell's vertex goes where the planes of its crossings meet (dual contouring), so edges and
/// corners stay sharp; otherwise at their mean, relaxed once (surface nets).
pub fn voxel_csg(inp: &Input, parts: &[Part], mut res: u32, sharp: bool) -> Result<Output, &'static str> {
    if parts.is_empty() || parts[0].op != OP_ADD { return Err("the first part must add"); }
    // the bounds of what adds (taking away or intersecting never reaches past it)
    let mut lo = [f64::INFINITY; 3];
    let mut hi = [f64::NEG_INFINITY; 3];
    for p in parts.iter().filter(|p| p.op == OP_ADD) {
        for q in p.t0 * 3..p.t1 * 3 {
            let v = p3(inp.pos, inp.idx[q] as usize);
            for c in 0..3 { lo[c] = lo[c].min(v[c]); hi[c] = hi[c].max(v[c]); }
        }
    }
    let ext = (hi[0] - lo[0]).max(hi[1] - lo[1]).max(hi[2] - lo[2]);
    if !(ext > 0.0) || !ext.is_finite() { return Err("empty"); }
    let per_cell = 13.0 + if parts.len() > 1 { 9.0 } else { 0.0 };
    let cells = |r: f64| ((hi[0] - lo[0]) / ext * r + 8.0) * ((hi[1] - lo[1]) / ext * r + 8.0) * ((hi[2] - lo[2]) / ext * r + 8.0);
    while res > 32 && cells(res as f64) * per_cell > GRID_BUDGET { res = (res as f64 * 0.9).floor() as u32; }
    let h = ext / res as f64;
    // a fractional offset keeps flat faces and extreme points off the grid planes
    let g = Grid {
        ox: lo[0] - 3.31 * h, oy: lo[1] - 3.27 * h, oz: lo[2] - 3.41 * h, h,
        nx: ((hi[0] - lo[0]) / h).ceil() as usize + 7, ny: ((hi[1] - lo[1]) / h).ceil() as usize + 7, nz: ((hi[2] - lo[2]) / h).ceil() as usize + 7,
    };
    let n = g.n();
    let sxy = g.sxy();
    // the combined field: inside flags, squared distance as stored, the sign from the flags, the triangle
    let mut inside = vec![0u8; n];
    let mut dist = vec![f32::INFINITY; n];
    let mut tri = vec![-1i32; n];
    // 1 where the nearest surface is a part taken away: its outside is the result's inside
    let mut turned = vec![0u8; n];
    winding(inp, &parts[0], &g, &mut inside);
    band_distance(inp, &parts[0], &g, &mut dist, &mut tri);
    if parts.len() > 1 {
        let mut ins2 = vec![0u8; n];
        let mut d2 = vec![f32::INFINITY; n];
        let mut t2 = vec![-1i32; n];
        let sd = |ins: u8, d: f32| { let r = (d.min(1e30) as f64).sqrt(); if ins != 0 { -r } else { r } };
        for part in &parts[1..] {
            ins2.iter_mut().for_each(|x| *x = 0);
            d2.iter_mut().for_each(|x| *x = f32::INFINITY);
            t2.iter_mut().for_each(|x| *x = -1);
            winding(inp, part, &g, &mut ins2);
            band_distance(inp, part, &g, &mut d2, &mut t2);
            for gi in 0..n {
                let a = sd(inside[gi], dist[gi]);
                let b = sd(ins2[gi], d2[gi]);
                let (take_b, flag) = match part.op {
                    OP_SUBTRACT => (-b > a, inside[gi] != 0 && ins2[gi] == 0),
                    OP_INTERSECT => (b > a, inside[gi] != 0 && ins2[gi] != 0),
                    _ => (b < a, inside[gi] != 0 || ins2[gi] != 0),
                };
                if take_b { dist[gi] = d2[gi]; tri[gi] = t2[gi]; turned[gi] = (part.op == OP_SUBTRACT) as u8; }
                inside[gi] = flag as u8;
            }
        }
    }
    let sdf = |gi: usize| { let d = (dist[gi].min(1e30) as f64).sqrt(); if inside[gi] != 0 { -d } else { d } };

    // Surface Nets: one vertex per cell the surface crosses, at the mean of its edge crossings
    let mut vid = vec![-1i32; n];
    let mut verts: Vec<f64> = Vec::new();
    let corner = [0, 1, g.nx, g.nx + 1, sxy, sxy + 1, sxy + g.nx, sxy + g.nx + 1];
    let c_off: [[f64; 3]; 8] = [[0., 0., 0.], [1., 0., 0.], [0., 1., 0.], [1., 1., 0.], [0., 0., 1.], [1., 0., 1.], [0., 1., 1.], [1., 1., 1.]];
    const EDGES: [[usize; 2]; 12] = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    let mut val = [0f64; 8];
    for k in 0..g.nz - 1 {
        for j in 0..g.ny - 1 {
            for i in 0..g.nx - 1 {
                let gi = g.at(i, j, k);
                let mut ins = 0;
                for q in 0..8 { ins += inside[gi + corner[q]] as u32; }
                if ins == 0 || ins == 8 { continue; }
                for q in 0..8 { val[q] = sdf(gi + corner[q]); }
                let (mut sx, mut sy, mut sz, mut cnt) = (0f64, 0f64, 0f64, 0u32);
                let mut herm: [([f64; 3], [f64; 3]); 12] = [([0.0; 3], [0.0; 3]); 12];
                let mut nh = 0;
                for [p, q] in EDGES {
                    // crossings come from the inside flags, as the cell test (a distance of 0 has no sign)
                    if inside[gi + corner[p]] == inside[gi + corner[q]] { continue; }
                    let (dp, dq) = (val[p].abs(), val[q].abs());
                    let mut t = if dp + dq > 0.0 { dp / (dp + dq) } else { 0.5 };
                    if !t.is_finite() { t = 0.5; }
                    t = t.clamp(0.0, 1.0);
                    let (lx, ly, lz) = (c_off[p][0] + (c_off[q][0] - c_off[p][0]) * t, c_off[p][1] + (c_off[q][1] - c_off[p][1]) * t, c_off[p][2] + (c_off[q][2] - c_off[p][2]) * t);
                    sx += lx; sy += ly; sz += lz;
                    cnt += 1;
                    if sharp {
                        // the crossing and the normal of the nearest triangle there (Hermite data)
                        let x = [g.ox + (i as f64 + lx) * h, g.oy + (j as f64 + ly) * h, g.oz + (k as f64 + lz) * h];
                        let mut best: Option<(f64, [f64; 3])> = None;
                        for gq in [gi + corner[p], gi + corner[q]] {
                            let t = tri[gq]; if t < 0 { continue; }
                            let t = t as usize;
                            let (pa, pb, pc) = (p3(inp.pos, inp.idx[t * 3] as usize), p3(inp.pos, inp.idx[t * 3 + 1] as usize), p3(inp.pos, inp.idx[t * 3 + 2] as usize));
                            let (_, dd) = closest_on_tri(pa, pb, pc, x);
                            let u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
                            let v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
                            let mut nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
                            let l = (nn[0] * nn[0] + nn[1] * nn[1] + nn[2] * nn[2]).sqrt();
                            if l < 1e-30 { continue; }
                            let sgn = if turned[gq] != 0 { -1.0 } else { 1.0 } / l;
                            for c in nn.iter_mut() { *c *= sgn; }
                            if best.map_or(true, |b| dd < b.0) { best = Some((dd, nn)); }
                        }
                        if let Some((_, nn)) = best { herm[nh] = (x, nn); nh += 1; }
                    }
                }
                vid[gi] = (verts.len() / 3) as i32;
                if cnt == 0 { verts.extend_from_slice(&[g.ox + (i as f64 + 0.5) * h, g.oy + (j as f64 + 0.5) * h, g.oz + (k as f64 + 0.5) * h]); continue; }
                let c = cnt as f64;
                let mass = [g.ox + (i as f64 + sx / c) * h, g.oy + (j as f64 + sy / c) * h, g.oz + (k as f64 + sz / c) * h];
                let mut at = mass;
                if sharp && nh >= 2 {
                    // the least squares point of the planes, pulled a little toward the mean (QEF)
                    let lam = 0.02;
                    let mut a = [[lam, 0.0, 0.0], [0.0, lam, 0.0], [0.0, 0.0, lam]];
                    let mut b = [lam * mass[0], lam * mass[1], lam * mass[2]];
                    for &(x, nn) in &herm[..nh] {
                        let d = nn[0] * x[0] + nn[1] * x[1] + nn[2] * x[2];
                        for r in 0..3 { for cc in 0..3 { a[r][cc] += nn[r] * nn[cc]; } b[r] += nn[r] * d; }
                    }
                    let det = a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
                    if det.abs() > 1e-12 {
                        let sol = |k: usize| { let mut m = a; for r in 0..3 { m[r][k] = b[r]; } (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])) / det };
                        let x = [sol(0), sol(1), sol(2)];
                        // (only inside the cell, grown by half a cell: past it the planes are nearly parallel)
                        let lo = [g.ox + (i as f64 - 0.5) * h, g.oy + (j as f64 - 0.5) * h, g.oz + (k as f64 - 0.5) * h];
                        if (0..3).all(|q| x[q] >= lo[q] && x[q] <= lo[q] + 2.0 * h) { at = x; }
                    }
                }
                verts.extend_from_slice(&at);
            }
        }
    }
    let mut faces: Vec<u32> = Vec::new();
    let mut quads: Vec<u32> = Vec::new();
    let mut quad = |a: i32, b: i32, c: i32, d: i32, flip: bool| {
        if a < 0 || b < 0 || c < 0 || d < 0 { return; }
        let (a, b, c, d) = (a as u32, b as u32, c as u32, d as u32);
        if flip { faces.extend_from_slice(&[a, c, b, a, d, c]); quads.extend_from_slice(&[a, d, c, b]); } else { faces.extend_from_slice(&[a, b, c, a, c, d]); quads.extend_from_slice(&[a, b, c, d]); }
    };
    let nx = g.nx;
    for k in 1..g.nz - 1 {
        for j in 1..g.ny - 1 {
            for i in 1..g.nx - 1 {
                let gi = g.at(i, j, k);
                let s0 = inside[gi];
                let flip = s0 == 0;
                if inside[gi + 1] != s0 { quad(vid[gi - nx - sxy], vid[gi - sxy], vid[gi], vid[gi - nx], flip); }
                if inside[gi + nx] != s0 { quad(vid[gi - 1 - sxy], vid[gi - 1], vid[gi], vid[gi - sxy], flip); }
                if inside[gi + sxy] != s0 { quad(vid[gi - 1 - nx], vid[gi - nx], vid[gi], vid[gi - 1], flip); }
            }
        }
    }
    drop(vid);
    let nv = verts.len() / 3;
    // faces point outward by construction; the signed volume makes sure of it
    let mut vol = 0f64;
    for f in faces.chunks_exact(3) {
        let (a, b, c) = (f[0] as usize * 3, f[1] as usize * 3, f[2] as usize * 3);
        let v = &verts;
        vol += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
    }
    if vol < 0.0 { for f in faces.chunks_exact_mut(3) { f.swap(1, 2); } for q in quads.chunks_exact_mut(4) { q.swap(1, 3); } }

    // relax once (uniform Laplacian, half way); sharp corners are kept as they were placed
    let mut nb = vec![0f64; if sharp { 0 } else { nv * 3 }];
    let mut nc = vec![0u32; nv];
    for f in faces.chunks_exact(3) {
        if sharp { break; }
        for e in 0..3 {
            let (u, v) = (f[e] as usize, f[(e + 1) % 3] as usize);
            for q in 0..3 { nb[u * 3 + q] += verts[v * 3 + q]; nb[v * 3 + q] += verts[u * 3 + q]; }
            nc[u] += 1; nc[v] += 1;
        }
    }
    for v in 0..nv { if nc[v] > 0 { for q in 0..3 { verts[v * 3 + q] += (nb[v * 3 + q] / nc[v] as f64 - verts[v * 3 + q]) * 0.5; } } }
    drop(nb); drop(nc);

    // onto the old surface: the closest of the triangles nearest to the cell's corners
    let mut out = Output { pos: vec![0.0; nv * 3], idx: faces, col: vec![1.0; nv * 3], mask: vec![0.0; nv], grp: vec![0.0; nv], res, quads };
    for v in 0..nv {
        let p = [verts[v * 3], verts[v * 3 + 1], verts[v * 3 + 2]];
        let ci = (((p[0] - g.ox) / h).floor().max(0.0) as usize).min(g.nx - 2);
        let cj = (((p[1] - g.oy) / h).floor().max(0.0) as usize).min(g.ny - 2);
        let ck = (((p[2] - g.oz) / h).floor().max(0.0) as usize).min(g.nz - 2);
        let gi = g.at(ci, cj, ck);
        let mut best = f64::INFINITY;
        let mut bt = -1i32;
        let mut bq = p;
        for q in 0..8 {
            let t = tri[gi + corner[q]];
            if t < 0 { continue; }
            let t = t as usize;
            let (a, b, c) = (inp.idx[t * 3] as usize, inp.idx[t * 3 + 1] as usize, inp.idx[t * 3 + 2] as usize);
            let (cp, d) = closest_on_tri(p3(inp.pos, a), p3(inp.pos, b), p3(inp.pos, c), p);
            if d < best { best = d; bt = t as i32; bq = cp; }
        }
        for q in 0..3 { out.pos[v * 3 + q] = bq[q] as f32; }
        if bt < 0 { continue; }
        let t = bt as usize;
        let (a, b, c) = (inp.idx[t * 3] as usize, inp.idx[t * 3 + 1] as usize, inp.idx[t * 3 + 2] as usize);
        let w = bary_of(p3(inp.pos, a), p3(inp.pos, b), p3(inp.pos, c), bq);
        for q in 0..3 {
            out.col[v * 3 + q] = (inp.col[a * 3 + q] as f64 * w[0] + inp.col[b * 3 + q] as f64 * w[1] + inp.col[c * 3 + q] as f64 * w[2]) as f32;
        }
        out.mask[v] = (inp.mask[a] as f64 * w[0] + inp.mask[b] as f64 * w[1] + inp.mask[c] as f64 * w[2]) as f32;
        out.grp[v] = inp.grp[if w[0] >= w[1] && w[0] >= w[2] { a } else if w[1] >= w[2] { b } else { c }];
    }
    Ok(out)
}

/* ---------- the WebAssembly interface ---------- */

thread_local! { static OUT: RefCell<Output> = RefCell::new(Output::default()); }

#[no_mangle]
pub extern "C" fn mem_alloc(size: usize) -> *mut u8 {
    unsafe { alloc(Layout::from_size_align(size.max(1), 8).unwrap()) }
}
/// # Safety
/// `p` must come from `mem_alloc` with the same `size`.
#[no_mangle]
pub unsafe extern "C" fn mem_free(p: *mut u8, size: usize) {
    dealloc(p, Layout::from_size_align(size.max(1), 8).unwrap())
}

/// Runs the remesh. `parts` holds `nparts` triples (first triangle, end triangle, op).
/// Returns 0, or −1 when the input is unusable. The result stays until `out_clear`.
/// # Safety
/// Every pointer must point to as many values as its count says (`col` 3 per vertex, `mask` and `grp` 1).
#[no_mangle]
pub unsafe extern "C" fn voxel_csg_raw(
    pos: *const f32, nv: usize, idx: *const u32, nt: usize, col: *const f32, mask: *const f32, grp: *const f32,
    parts: *const u32, nparts: usize, res: u32, flags: u32,
) -> i32 {
    let inp = Input {
        pos: std::slice::from_raw_parts(pos, nv * 3),
        idx: std::slice::from_raw_parts(idx, nt * 3),
        col: std::slice::from_raw_parts(col, nv * 3),
        mask: std::slice::from_raw_parts(mask, nv),
        grp: std::slice::from_raw_parts(grp, nv),
    };
    let raw = std::slice::from_raw_parts(parts, nparts * 3);
    let mut list = Vec::with_capacity(nparts);
    for p in raw.chunks_exact(3) {
        let (t0, t1) = (p[0] as usize, p[1] as usize);
        if t0 > t1 || t1 > nt { return -1; }
        list.push(Part { t0, t1, op: p[2] });
    }
    if inp.idx.iter().any(|&v| v as usize >= nv) { return -1; }
    match voxel_csg(&inp, &list, res, flags & 1 != 0) {
        Ok(o) => { OUT.with(|c| *c.borrow_mut() = o); 0 }
        Err(_) => -1,
    }
}

/// Where the result's arrays are: 0 pos, 1 idx, 2 col, 3 mask, 4 grp.
#[no_mangle]
pub extern "C" fn out_ptr(kind: u32) -> *const u8 {
    OUT.with(|c| {
        let o = c.borrow();
        match kind { 0 => o.pos.as_ptr() as *const u8, 1 => o.idx.as_ptr() as *const u8, 2 => o.col.as_ptr() as *const u8, 3 => o.mask.as_ptr() as *const u8, 5 => o.quads.as_ptr() as *const u8, _ => o.grp.as_ptr() as *const u8 }
    })
}
/// How many values (not bytes) each result array has.
#[no_mangle]
pub extern "C" fn out_len(kind: u32) -> usize {
    OUT.with(|c| {
        let o = c.borrow();
        match kind { 0 => o.pos.len(), 1 => o.idx.len(), 2 => o.col.len(), 3 => o.mask.len(), 5 => o.quads.len(), _ => o.grp.len() }
    })
}
#[no_mangle]
pub extern "C" fn out_res() -> u32 { OUT.with(|c| c.borrow().res) }
#[no_mangle]
pub extern "C" fn out_clear() { OUT.with(|c| *c.borrow_mut() = Output::default()); }

/// Project (ZBrush: Project All): every point of `pos` goes along its normal `nrm` to where that line
/// meets the source surface (no farther than `reach`; where it does not settle, to the nearest point),
/// blended by `w` (0: stays … 1: all the way), and takes its colour. Along the normal, a soft copy under
/// a sharp tip reaches the tip; the nearest point would slide off to its side.
/// Writes `out_pos` and `out_col`; returns how many points found the surface.
pub fn project(pos: &[f32], nrm: &[f32], w: &[f32], src_pos: &[f32], src_idx: &[u32], src_col: &[f32], reach: f64, out_pos: &mut [f32], out_col: &mut [f32]) -> usize {
    let n = pos.len() / 3;
    let Some(c) = cloth::Collider::new(src_pos, src_idx, reach / 3.0) else { return 0 };
    let mut found = 0;
    for i in 0..n {
        let p = p3(pos, i);
        let wi = w[i] as f64;
        if wi <= 0.0 { continue; }
        let mut nn = p3(nrm, i);
        let nl = (nn[0] * nn[0] + nn[1] * nn[1] + nn[2] * nn[2]).sqrt();
        let Some((mut q, mut t, mut b)) = c.closest(p) else { continue };
        if nl > 1e-12 {
            for x in nn.iter_mut() { *x /= nl; }
            // slide along the normal line: the nearest point's height on it, again from there
            let mut x = p;
            let mut ok = false;
            for _ in 0..8 {
                let Some((qq, tt, bb)) = c.closest(x) else { break };
                let h = (qq[0] - p[0]) * nn[0] + (qq[1] - p[1]) * nn[1] + (qq[2] - p[2]) * nn[2];
                if h.abs() > reach { break; }
                let nx = [p[0] + nn[0] * h, p[1] + nn[1] * h, p[2] + nn[2] * h];
                let moved = ((nx[0] - x[0]).powi(2) + (nx[1] - x[1]).powi(2) + (nx[2] - x[2]).powi(2)).sqrt();
                x = nx; q = qq; t = tt; b = bb;
                if moved < reach * 1e-4 { ok = true; break; }
            }
            // (on the line, unless it never came close to the surface: then the nearest point)
            let off = ((q[0] - x[0]).powi(2) + (q[1] - x[1]).powi(2) + (q[2] - x[2]).powi(2)).sqrt();
            if ok || off < reach * 0.05 { q = x; }
        }
        let d2 = (q[0] - p[0]).powi(2) + (q[1] - p[1]).powi(2) + (q[2] - p[2]).powi(2);
        if d2 > reach * reach { continue; }
        found += 1;
        for k in 0..3 {
            out_pos[i * 3 + k] = (p[k] + (q[k] - p[k]) * wi) as f32;
            let col = (0..3).map(|cc| src_col[c.corner(t, cc) * 3 + k] as f64 * b[cc]).sum::<f64>();
            out_col[i * 3 + k] = (out_col[i * 3 + k] as f64 + (col - out_col[i * 3 + k] as f64) * wi) as f32;
        }
    }
    found
}
/// # Safety
/// Every pointer must point to as many values as its count says; `opos`/`ocol` hold the target's
/// positions and colours on the way in and the projected ones on the way out.
#[no_mangle]
pub unsafe extern "C" fn project_raw(pos: *const f32, nrm: *const f32, w: *const f32, nv: usize, spos: *const f32, snv: usize, sidx: *const u32, snt: usize, scol: *const f32, reach: f32, opos: *mut f32, ocol: *mut f32) -> i32 {
    let sidx = std::slice::from_raw_parts(sidx, snt * 3);
    if sidx.iter().any(|&v| v as usize >= snv) { return -1; }
    project(std::slice::from_raw_parts(pos, nv * 3), std::slice::from_raw_parts(nrm, nv * 3), std::slice::from_raw_parts(w, nv), std::slice::from_raw_parts(spos, snv * 3), sidx, std::slice::from_raw_parts(scol, snv * 3), reach as f64, std::slice::from_raw_parts_mut(opos, nv * 3), std::slice::from_raw_parts_mut(ocol, nv * 3)) as i32
}

/// Decimation into the shared result (`out_ptr` / `out_len`): about `target` triangles.
/// # Safety
/// Every pointer must point to as many values as its count says.
#[no_mangle]
pub unsafe extern "C" fn decimate_raw(pos: *const f32, nv: usize, idx: *const u32, nt: usize, col: *const f32, mask: *const f32, grp: *const f32, target: usize) -> i32 {
    let idx = std::slice::from_raw_parts(idx, nt * 3);
    if idx.iter().any(|&v| v as usize >= nv) { return -1; }
    let m = decimate::decimate(std::slice::from_raw_parts(pos, nv * 3), idx, std::slice::from_raw_parts(col, nv * 3), std::slice::from_raw_parts(mask, nv), std::slice::from_raw_parts(grp, nv), target);
    OUT.with(|c| *c.borrow_mut() = Output { pos: m.pos, idx: m.idx, col: m.col, mask: m.mask, grp: m.grp, res: 0, quads: Vec::new() });
    0
}

thread_local! { static UV: RefCell<(Vec<f32>, Vec<u32>, Vec<u8>)> = const { RefCell::new((Vec::new(), Vec::new(), Vec::new())) }; }
/// Unwrap: the UVs and the corners' UV vertices go to `uv_ptr(0)` / `uv_ptr(1)`; returns the charts.
/// # Safety
/// Every pointer must point to as many values as its count says.
#[no_mangle]
pub unsafe extern "C" fn uv_unwrap_raw(pos: *const f32, nv: usize, idx: *const u32, nt: usize) -> i32 {
    let idx = std::slice::from_raw_parts(idx, nt * 3);
    if idx.iter().any(|&v| v as usize >= nv) { return -1; }
    let u = uv::unwrap(std::slice::from_raw_parts(pos, nv * 3), idx);
    UV.with(|c| { let mut c = c.borrow_mut(); c.0 = u.uv; c.1 = u.corner; });
    u.charts as i32
}
/// The colour map into `uv_ptr(2)` (RGBA), from the last unwrap.
/// # Safety
/// As above.
#[no_mangle]
pub unsafe extern "C" fn uv_bake_color_raw(idx: *const u32, nt: usize, col: *const f32, nv: usize, size: usize) -> i32 {
    let idx = std::slice::from_raw_parts(idx, nt * 3);
    let col = std::slice::from_raw_parts(col, nv * 3);
    UV.with(|c| { let mut c = c.borrow_mut(); let img = uv::bake_color(&c.0, &c.1, idx, col, size); c.2 = img; });
    0
}
/// The normal map into `uv_ptr(2)` (RGBA), from the last unwrap, against a finer surface.
/// # Safety
/// As above.
#[no_mangle]
pub unsafe extern "C" fn uv_bake_normals_raw(pos: *const f32, nv: usize, idx: *const u32, nt: usize, nrm: *const f32, hpos: *const f32, hnv: usize, hidx: *const u32, hnt: usize, size: usize, reach: f32) -> i32 {
    let hidx = std::slice::from_raw_parts(hidx, hnt * 3);
    if hidx.iter().any(|&v| v as usize >= hnv) { return -1; }
    let (pos, idx, nrm, hpos) = (std::slice::from_raw_parts(pos, nv * 3), std::slice::from_raw_parts(idx, nt * 3), std::slice::from_raw_parts(nrm, nv * 3), std::slice::from_raw_parts(hpos, hnv * 3));
    UV.with(|c| { let mut c = c.borrow_mut(); let img = uv::bake_normals(pos, idx, nrm, &c.0, &c.1, hpos, hidx, size, reach as f64); c.2 = img; });
    0
}
#[no_mangle]
pub extern "C" fn uv_ptr(kind: u32) -> *const u8 { UV.with(|c| { let c = c.borrow(); match kind { 0 => c.0.as_ptr() as *const u8, 1 => c.1.as_ptr() as *const u8, _ => c.2.as_ptr() } }) }
#[no_mangle]
pub extern "C" fn uv_len(kind: u32) -> usize { UV.with(|c| { let c = c.borrow(); match kind { 0 => c.0.len(), 1 => c.1.len(), _ => c.2.len() } }) }

/// One dab of a sculpting brush on the points under it (brush.rs). `aux` may be null when the kind
/// needs none. Returns how many points changed, or −1 for bad input.
/// # Safety
/// Every non-null pointer must point to as many values as its count says.
#[no_mangle]
pub unsafe extern "C" fn brush_dab_raw(kind: u32, n: usize, pos: *mut f32, nrm: *const f32, mask: *const f32, fall: *const f32, par: *const f64, aux: *mut f32, aux_len: usize, changed: *mut u8) -> i32 {
    if pos.is_null() || nrm.is_null() || mask.is_null() || fall.is_null() || par.is_null() || changed.is_null() { return -1; }
    let aux: &mut [f32] = if aux.is_null() { &mut [] } else { std::slice::from_raw_parts_mut(aux, aux_len) };
    brush::dab(kind, std::slice::from_raw_parts_mut(pos, n * 3), std::slice::from_raw_parts(nrm, n * 3), std::slice::from_raw_parts(mask, n), std::slice::from_raw_parts(fall, n), std::slice::from_raw_parts(par, 28), aux, std::slice::from_raw_parts_mut(changed, n)) as i32
}

/// Smooth on a patch (brush.rs). Returns how many points changed, or −1 for bad input.
/// # Safety
/// Every pointer must point to as many values as its count says.
#[no_mangle]
pub unsafe extern "C" fn brush_smooth_raw(count: usize, ext: usize, pos: *const f32, nb_off: *const u32, nb: *const u32, nb_len: usize, edge: *const u8, mask: *const f32, fall: *const f32, s: f64, out: *mut f32, changed: *mut u8) -> i32 {
    let nb_off = std::slice::from_raw_parts(nb_off, count + 1);
    let nb = std::slice::from_raw_parts(nb, nb_len);
    if nb.iter().any(|&u| u as usize >= ext) || nb_off[count] as usize > nb_len { return -1; }
    brush::smooth(count, std::slice::from_raw_parts(pos, ext * 3), nb_off, nb, std::slice::from_raw_parts(edge, count), std::slice::from_raw_parts(mask, count), std::slice::from_raw_parts(fall, count), s, std::slice::from_raw_parts_mut(out, count * 3), std::slice::from_raw_parts_mut(changed, count)) as i32
}
/// A cloth-brush dab on a patch (brush.rs); `pos` (ext·3) in and out. Returns 0, or −1 for bad input.
/// # Safety
/// Every pointer must point to as many values as its count says.
#[no_mangle]
pub unsafe extern "C" fn brush_cloth_raw(kind: u32, count: usize, ext: usize, ids: *const u32, pos: *mut f32, nrm: *const f32, orig: *const f32, w: *const f64, nb_off: *const u32, nb: *const u32, nb_len: usize, par: *const f64) -> i32 {
    let nb_off = std::slice::from_raw_parts(nb_off, count + 1);
    let nb = std::slice::from_raw_parts(nb, nb_len);
    if nb.iter().any(|&u| u as usize >= ext) || nb_off[count] as usize > nb_len { return -1; }
    brush::cloth(kind, count, std::slice::from_raw_parts(ids, ext), std::slice::from_raw_parts_mut(pos, ext * 3), std::slice::from_raw_parts(nrm, ext * 3), std::slice::from_raw_parts(orig, ext * 3), std::slice::from_raw_parts(w, count), nb_off, nb, std::slice::from_raw_parts(par, 17));
    0
}

thread_local! { static DYN: RefCell<Option<(dyntopo::Patch, Vec<u32>, Vec<u8>, bool)>> = const { RefCell::new(None) }; }
/// Dynamic topology on a patch (dyntopo.rs). `par`: centre (3), r² (∞ for all), max², min², split and
/// collapse budgets, split?, collapse?, all?, the brush's group (−1: any), sample tick, room for faces.
/// Read with `dyn_ptr` / `dyn_len` (0 pos, 1 nrm, 2 col, 3 mask, 4 grp, 5 hid: every patch vertex, the new
/// ones after the old; 6 the faces left; 7 removed flags; 8 dirty vertices) and `dyn_info` (0 vertices,
/// 1 changed, 2 hit the face limit, 3 splits, 4 collapses). Returns 1 changed, 0 not, −1 bad input.
/// # Safety
/// Every pointer must point to as many values as its count says.
#[no_mangle]
pub unsafe extern "C" fn dyn_patch_raw(nv: usize, pos: *const f32, nrm: *const f32, col: *const f32, mask: *const f32, grp: *const f32, hid: *const f32, nf: usize, faces: *const u32, locked: *const u8, extra: *const u32, nfrozen: usize, frozen: *const u32, nverts: usize, verts: *const u32, par: *const f64) -> i32 {
    let faces = std::slice::from_raw_parts(faces, nf * 3);
    let verts = std::slice::from_raw_parts(verts, nverts);
    let frozen = if nfrozen == 0 { &[][..] } else { std::slice::from_raw_parts(frozen, nfrozen * 2) };
    if faces.iter().chain(verts.iter()).chain(frozen.iter()).any(|&v| v as usize >= nv) { return -1; }
    let f = |p: *const f32, k: usize| std::slice::from_raw_parts(p, nv * k);
    let par = std::slice::from_raw_parts(par, 14);
    let mut patch = dyntopo::Patch::new(f(pos, 3), f(nrm, 3), f(col, 3), f(mask, 1), f(grp, 1), f(hid, 1), faces, std::slice::from_raw_parts(locked, nv), std::slice::from_raw_parts(extra, nv), frozen, par[13] as i64);
    let budget = |x: f64| if x.is_finite() { x.max(0.0) as usize } else { usize::MAX };
    let p = dyntopo::Params { c: [par[0], par[1], par[2]], r2: par[3], max2: par[4], min2: par[5], split_budget: budget(par[6]), collapse_budget: budget(par[7]), do_split: par[8] != 0.0, do_collapse: par[9] != 0.0, all: par[10] != 0.0, cur_group: par[11] as f32, tick: par[12] as usize };
    let changed = patch.remesh(verts, &p);
    let left: Vec<u32> = patch.faces.iter().zip(patch.alive.iter()).filter(|(_, &a)| a).flat_map(|(f, _)| f.iter().copied()).collect();
    let removed: Vec<u8> = patch.removed.iter().map(|&r| r as u8).collect();
    DYN.with(|c| *c.borrow_mut() = Some((patch, left, removed, changed)));
    changed as i32
}
#[no_mangle]
pub extern "C" fn dyn_ptr(kind: u32) -> *const u8 {
    DYN.with(|c| match c.borrow().as_ref() {
        None => std::ptr::null(),
        Some((p, left, removed, _)) => match kind {
            0 => p.pos.as_ptr() as *const u8, 1 => p.nrm.as_ptr() as *const u8, 2 => p.col.as_ptr() as *const u8, 3 => p.mask.as_ptr() as *const u8,
            4 => p.grp.as_ptr() as *const u8, 5 => p.hid.as_ptr() as *const u8, 6 => left.as_ptr() as *const u8, 7 => removed.as_ptr(), _ => p.dirty.as_ptr() as *const u8,
        },
    })
}
#[no_mangle]
pub extern "C" fn dyn_len(kind: u32) -> usize {
    DYN.with(|c| match c.borrow().as_ref() {
        None => 0,
        Some((p, left, removed, _)) => match kind { 0 | 1 | 2 => p.pos.len(), 3 | 4 | 5 => p.mask.len(), 6 => left.len(), 7 => removed.len(), _ => p.dirty.len() },
    })
}
#[no_mangle]
pub extern "C" fn dyn_info(kind: u32) -> f64 {
    DYN.with(|c| match c.borrow().as_ref() {
        None => 0.0,
        Some((p, _, _, ch)) => match kind { 0 => p.mask.len() as f64, 1 => *ch as u8 as f64, 2 => p.hit_cap as u8 as f64, 3 => p.splits as f64, _ => p.collapses as f64 },
    })
}
#[no_mangle]
pub extern "C" fn dyn_free() { DYN.with(|c| *c.borrow_mut() = None); }

/// Subdivision levels (multires.rs): the detail of `pos` over the subdivided surface `sub`, written to
/// `out` (3 per vertex). Returns 0, or −1 when a face names a vertex that is not there.
/// # Safety
/// `pos`, `sub` and `out` hold `n` × 3 values, `idx` `nf` × 3.
#[no_mangle]
pub unsafe extern "C" fn mr_encode_raw(n: usize, pos: *const f32, sub: *const f32, nf: usize, idx: *const u32, out: *mut f32) -> i32 {
    let idx = std::slice::from_raw_parts(idx, nf * 3);
    if idx.iter().any(|&v| v as usize >= n) { return -1; }
    multires::encode(std::slice::from_raw_parts(pos, n * 3), std::slice::from_raw_parts(sub, n * 3), idx, n, std::slice::from_raw_parts_mut(out, n * 3));
    0
}
/// The surface `sub` with the detail `d` put back, into `out`. Returns 0 or −1.
/// # Safety
/// `sub`, `d` and `out` hold `n` × 3 values, `idx` `nf` × 3.
#[no_mangle]
pub unsafe extern "C" fn mr_decode_raw(n: usize, sub: *const f32, d: *const f32, nf: usize, idx: *const u32, out: *mut f32) -> i32 {
    let idx = std::slice::from_raw_parts(idx, nf * 3);
    if idx.iter().any(|&v| v as usize >= n) { return -1; }
    multires::decode(std::slice::from_raw_parts(sub, n * 3), std::slice::from_raw_parts(d, n * 3), idx, n, std::slice::from_raw_parts_mut(out, n * 3));
    0
}
/// The lower level's positions (`n_low` × 3, into `out`) from the higher level's. Returns 0 or −1.
/// # Safety
/// `high` holds `n_high` × 3 values, `idx` `nf` × 3, `out` `n_low` × 3.
#[no_mangle]
pub unsafe extern "C" fn mr_lower_raw(n_high: usize, high: *const f32, nf: usize, idx: *const u32, n_low: usize, out: *mut f32) -> i32 {
    let idx = std::slice::from_raw_parts(idx, nf * 3);
    if n_low > n_high || idx.iter().any(|&v| v as usize >= n_high) { return -1; }
    multires::lower(std::slice::from_raw_parts(high, n_high * 3), idx, n_high, n_low, std::slice::from_raw_parts_mut(out, n_low * 3));
    0
}

thread_local! { static SUB: RefCell<Option<subdiv::Sub>> = const { RefCell::new(None) }; }
/// Loop subdivision (subdiv.rs). `col`, `mask`, `grp` may be null. `flags`: 1 smooth, 2 crease.
/// The result is read with `sub_ptr` / `sub_len` (0 pos, 1 idx, 2 col, 3 mask, 4 grp). Returns 0 or −1.
/// # Safety
/// Every non-null pointer must point to as many values as its count says.
#[no_mangle]
pub unsafe extern "C" fn subdiv_raw(pos: *const f32, nv: usize, idx: *const u32, nt: usize, col: *const f32, mask: *const f32, grp: *const f32, flags: u32) -> i32 {
    let idx = std::slice::from_raw_parts(idx, nt * 3);
    if idx.iter().any(|&v| v as usize >= nv) { return -1; }
    let opt = |p: *const f32, k: usize| if p.is_null() { None } else { Some(std::slice::from_raw_parts(p, nv * k)) };
    let r = subdiv::subdivide(std::slice::from_raw_parts(pos, nv * 3), idx, opt(col, 3), opt(mask, 1), opt(grp, 1), flags & 1 != 0, flags & 2 != 0);
    SUB.with(|c| *c.borrow_mut() = Some(r));
    0
}
#[no_mangle]
pub extern "C" fn sub_ptr(kind: u32) -> *const u8 {
    SUB.with(|c| match c.borrow().as_ref() {
        None => std::ptr::null(),
        Some(r) => match kind { 0 => r.pos.as_ptr() as *const u8, 1 => r.idx.as_ptr() as *const u8, 2 => r.col.as_ptr() as *const u8, 3 => r.mask.as_ptr() as *const u8, _ => r.grp.as_ptr() as *const u8 },
    })
}
#[no_mangle]
pub extern "C" fn sub_len(kind: u32) -> usize {
    SUB.with(|c| match c.borrow().as_ref() { None => 0, Some(r) => match kind { 0 => r.pos.len(), 1 => r.idx.len(), 2 => r.col.len(), 3 => r.mask.len(), _ => r.grp.len() } })
}
#[no_mangle]
pub extern "C" fn sub_free() { SUB.with(|c| *c.borrow_mut() = None); }

thread_local! { static QUAD: RefCell<Option<quadmesh::QuadMesh>> = const { RefCell::new(None) }; }
/// Quad remesh along the form (quadmesh.rs), about `target` quads. Read with `quad_ptr` / `quad_len`
/// (0 positions, 1 faces: four corners each, u32::MAX as the fourth of a triangle, 2 colour, 3 mask,
/// 4 polygroup). `col`, `mask`, `grp` may be null. Returns the face count, or −1.
/// # Safety
/// Every pointer must point to as many values as its count says.
#[no_mangle]
pub unsafe extern "C" fn quad_raw(pos: *const f32, nv: usize, idx: *const u32, nt: usize, col: *const f32, mask: *const f32, grp: *const f32, target: u32, seed: u32) -> i32 {
    let opt = |p: *const f32, k: usize| if p.is_null() { &[][..] } else { std::slice::from_raw_parts(p, nv * k) };
    let at = quadmesh::Attrs { col: opt(col, 3), mask: opt(mask, 1), grp: opt(grp, 1) };
    let r = quadmesh::remesh(std::slice::from_raw_parts(pos, nv * 3), std::slice::from_raw_parts(idx, nt * 3), target as usize, seed as u64, &at);
    let n = r.as_ref().map_or(-1, |q| (q.faces.len() / 4) as i32);
    QUAD.with(|c| *c.borrow_mut() = r);
    n
}
#[no_mangle]
pub extern "C" fn quad_ptr(kind: u32) -> *const u8 {
    QUAD.with(|c| match c.borrow().as_ref() { None => std::ptr::null(), Some(q) => match kind { 0 => q.pos.as_ptr() as *const u8, 1 => q.faces.as_ptr() as *const u8, 2 => q.col.as_ptr() as *const u8, 3 => q.mask.as_ptr() as *const u8, _ => q.grp.as_ptr() as *const u8 } })
}
#[no_mangle]
pub extern "C" fn quad_len(kind: u32) -> usize {
    QUAD.with(|c| match c.borrow().as_ref() { None => 0, Some(q) => match kind { 0 => q.pos.len(), 1 => q.faces.len(), 2 => q.col.len(), 3 => q.mask.len(), _ => q.grp.len() } })
}
#[no_mangle]
pub extern "C" fn quad_free() { QUAD.with(|c| *c.borrow_mut() = None); }

thread_local! { static CLOTH: RefCell<Option<(cloth::Cloth, Vec<f32>)>> = const { RefCell::new(None) }; }

/// Starts a cloth run. `inv` is the inverse mass per vertex (0: pinned … 1: free). The collider is
/// every other mesh in one set of arrays (`cnt` 0: none). `par`: gravity, stretch, bend, damping,
/// thickness, floor height, constraint passes, collider cell size, self-collision distance (0: none).
/// Returns 0, or −1 for bad input.
/// # Safety
/// Every pointer must point to as many values as its count says.
#[no_mangle]
pub unsafe extern "C" fn cloth_init(
    pos: *const f32, nv: usize, idx: *const u32, nt: usize, inv: *const f32,
    cpos: *const f32, cnv: usize, cidx: *const u32, cnt: usize, par: *const f32,
) -> i32 {
    let pos = std::slice::from_raw_parts(pos, nv * 3);
    let idx = std::slice::from_raw_parts(idx, nt * 3);
    let inv = std::slice::from_raw_parts(inv, nv);
    let par = std::slice::from_raw_parts(par, 9);
    if idx.iter().any(|&v| v as usize >= nv) { return -1; }
    let collider = if cnt > 0 {
        let cpos = std::slice::from_raw_parts(cpos, cnv * 3);
        let cidx = std::slice::from_raw_parts(cidx, cnt * 3);
        if cidx.iter().any(|&v| v as usize >= cnv) { return -1; }
        cloth::Collider::new(cpos, cidx, par[7] as f64)
    } else { None };
    let p = cloth::ClothParams {
        gravity: par[0] as f64, stretch: par[1] as f64, bend: par[2] as f64, damping: par[3] as f64,
        thick: par[4] as f64, floor: par[5] as f64, iters: par[6] as u32, max_step: par[7] as f64, self_dist: par[8] as f64,
    };
    let c = cloth::Cloth::new(pos, idx, inv, collider, p);
    CLOTH.with(|s| *s.borrow_mut() = Some((c, pos.to_vec())));
    0
}
/// Runs `steps` steps of `dt` seconds; returns how far the farthest vertex moved (to see it settle).
#[no_mangle]
pub extern "C" fn cloth_step(steps: u32, dt: f32) -> f32 {
    CLOTH.with(|s| {
        let mut s = s.borrow_mut();
        let Some((c, out)) = s.as_mut() else { return -1.0 };
        c.step(steps, dt as f64);
        let mut most = 0f32;
        for (o, &x) in out.iter_mut().zip(c.x.iter()) { most = most.max((x as f32 - *o).abs()); *o = x as f32; }
        most
    })
}
/// The cloth's positions after the last step (3 per vertex).
#[no_mangle]
pub extern "C" fn cloth_pos() -> *const f32 {
    CLOTH.with(|s| s.borrow().as_ref().map_or(std::ptr::null(), |(_, o)| o.as_ptr()))
}
#[no_mangle]
pub extern "C" fn cloth_free() { CLOTH.with(|s| *s.borrow_mut() = None); }

#[cfg(test)]
mod tests {
    use super::*;

    // an axis-aligned box, faces outward
    fn cube(c: [f32; 3], s: f32, pos: &mut Vec<f32>, idx: &mut Vec<u32>) {
        let b = (pos.len() / 3) as u32;
        for k in 0..8 { pos.extend_from_slice(&[c[0] + if k & 1 != 0 { s } else { -s }, c[1] + if k & 2 != 0 { s } else { -s }, c[2] + if k & 4 != 0 { s } else { -s }]); }
        let q = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
        for f in q { idx.extend_from_slice(&[b + f[0], b + f[1], b + f[2], b + f[0], b + f[2], b + f[3]]); }
    }
    fn volume(o: &Output) -> f64 {
        o.idx.chunks_exact(3).map(|f| {
            let p = |v: u32| [o.pos[v as usize * 3] as f64, o.pos[v as usize * 3 + 1] as f64, o.pos[v as usize * 3 + 2] as f64];
            let (a, b, c) = (p(f[0]), p(f[1]), p(f[2]));
            a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
        }).sum::<f64>() / 6.0
    }
    fn closed(o: &Output) -> bool {
        let mut m = std::collections::HashMap::new();
        for f in o.idx.chunks_exact(3) { for e in 0..3 { let (a, b) = (f[e], f[(e + 1) % 3]); *m.entry((a.min(b), a.max(b))).or_insert(0) += 1; } }
        m.values().all(|&c| c % 2 == 0)
    }
    fn run(boxes: &[([f32; 3], f32, u32)], res: u32) -> Output {
        let (mut pos, mut idx) = (Vec::new(), Vec::new());
        let mut parts = Vec::new();
        for &(c, s, op) in boxes { let t0 = idx.len() / 3; cube(c, s, &mut pos, &mut idx); parts.push(Part { t0, t1: idx.len() / 3, op }); }
        let nv = pos.len() / 3;
        let (col, mask, grp) = (vec![1.0; nv * 3], vec![0.0; nv], vec![0.0; nv]);
        voxel_csg(&Input { pos: &pos, idx: &idx, col: &col, mask: &mask, grp: &grp }, &parts, res, false).unwrap()
    }
    #[test]
    fn sharp_keeps_the_corners_of_a_cube_and_makes_quads() {
        let (mut pos, mut idx) = (Vec::new(), Vec::new());
        cube([0.0; 3], 0.5, &mut pos, &mut idx);
        let nv = pos.len() / 3;
        let (col, mask, grp) = (vec![1.0; nv * 3], vec![0.0; nv], vec![0.0; nv]);
        let inp = Input { pos: &pos, idx: &idx, col: &col, mask: &mask, grp: &grp };
        let parts = [Part { t0: 0, t1: idx.len() / 3, op: OP_ADD }];
        let soft = voxel_csg(&inp, &parts, 32, false).unwrap();
        let sharp = voxel_csg(&inp, &parts, 32, true).unwrap();
        // the corner nearest (0.5, 0.5, 0.5)
        let nearest = |o: &Output| (0..o.pos.len() / 3).map(|i| ((o.pos[i * 3] - 0.5).powi(2) + (o.pos[i * 3 + 1] - 0.5).powi(2) + (o.pos[i * 3 + 2] - 0.5).powi(2)).sqrt()).fold(f32::INFINITY, f32::min);
        assert!(nearest(&sharp) < 0.01, "sharp corner {}", nearest(&sharp));
        assert!(nearest(&soft) > nearest(&sharp));
        assert!((volume(&sharp) - 1.0).abs() < 0.01, "{}", volume(&sharp));
        assert!(closed(&sharp));
        assert_eq!(sharp.quads.len() / 4 * 2, sharp.idx.len() / 3);
    }
    #[test]
    fn project_puts_points_on_the_source() {
        // a flat square grid at y = 0.1 onto a flat square at y = 0 (two triangles), red
        let src = [-1.0f32, 0.0, -1.0, 1.0, 0.0, -1.0, 1.0, 0.0, 1.0, -1.0, 0.0, 1.0];
        let sidx = [0u32, 2, 1, 0, 3, 2];
        let scol = [1.0f32, 0.0, 0.0].repeat(4);
        let mut pos = Vec::new();
        for j in 0..5 { for i in 0..5 { pos.extend_from_slice(&[i as f32 * 0.3 - 0.6, 0.1, j as f32 * 0.3 - 0.6]); } }
        let w = vec![1.0f32; 25];
        let nrm = [0.0f32, 1.0, 0.0].repeat(25);
        let (mut op, mut oc) = (pos.clone(), vec![1.0f32; 75]);
        let found = project(&pos, &nrm, &w, &src, &sidx, &scol, 0.5, &mut op, &mut oc);
        assert_eq!(found, 25);
        for i in 0..25 { assert!(op[i * 3 + 1].abs() < 1e-6); assert!((oc[i * 3] - 1.0).abs() < 1e-6 && oc[i * 3 + 1].abs() < 1e-6); }
    }

    #[test]
    fn remesh_keeps_the_volume() {
        let o = run(&[([0.0; 3], 0.5, OP_ADD)], 48);
        assert!(closed(&o));
        assert!((volume(&o) - 1.0).abs() < 0.03, "{}", volume(&o));
    }
    #[test]
    fn union_subtract_intersect() {
        // two unit cubes overlapping by half along x
        let a = ([0.0, 0.0, 0.0], 0.5, OP_ADD);
        let u = run(&[a, ([0.5, 0.0, 0.0], 0.5, OP_ADD)], 64);
        let s = run(&[a, ([0.5, 0.0, 0.0], 0.5, OP_SUBTRACT)], 64);
        let i = run(&[a, ([0.5, 0.0, 0.0], 0.5, OP_INTERSECT)], 64);
        for (o, want) in [(&u, 1.5), (&s, 0.5), (&i, 0.5)] {
            assert!(closed(o));
            assert!((volume(o) - want).abs() < 0.04, "{} vs {}", volume(o), want);
        }
    }
    #[test]
    fn subtract_inside_makes_a_hollow() {
        let o = run(&[([0.0; 3], 0.5, OP_ADD), ([0.0; 3], 0.25, OP_SUBTRACT)], 64);
        assert!(closed(&o));
        assert!((volume(&o) - (1.0 - 0.125)).abs() < 0.04, "{}", volume(&o));
    }
}
