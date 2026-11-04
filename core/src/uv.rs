//! UVs and baked maps, for exporting to game engines and texture painters (ZBrush: UV Master, and
//! Texture / Normal Map from the subdivision levels).
//!
//! Unwrap: every face goes to the side of a box it faces most (±X, ±Y, ±Z); the connected pieces of the
//! same side become charts, each flattened onto its side's plane (a face within ~55° of its side never
//! turns over), all at the same scale, then packed on shelves into the unit square with a margin.
//! Bake: the vertex colours painted into the charts; a tangent-space normal map from a finer copy of the
//! surface (the highest subdivision level), found along each texel's normal.

use crate::p3;
use std::collections::HashMap;

pub struct Unwrap {
    /// one (u, v) per UV vertex
    pub uv: Vec<f32>,
    /// for every face corner, its UV vertex
    pub corner: Vec<u32>,
    pub charts: usize,
}

fn sides(k: usize) -> ([f64; 3], [f64; 3]) {
    // U, V of each side, so that U × V points out of it
    match k {
        0 => ([0.0, 0.0, -1.0], [0.0, 1.0, 0.0]),
        1 => ([0.0, 0.0, 1.0], [0.0, 1.0, 0.0]),
        2 => ([1.0, 0.0, 0.0], [0.0, 0.0, -1.0]),
        3 => ([1.0, 0.0, 0.0], [0.0, 0.0, 1.0]),
        4 => ([1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
        _ => ([-1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
    }
}

pub fn unwrap(pos: &[f32], idx: &[u32]) -> Unwrap {
    let nf = idx.len() / 3;
    let mut side = vec![0u8; nf];
    for f in 0..nf {
        let (a, b, c) = (p3(pos, idx[f * 3] as usize), p3(pos, idx[f * 3 + 1] as usize), p3(pos, idx[f * 3 + 2] as usize));
        let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        let ax = (0..3).max_by(|&i, &j| n[i].abs().partial_cmp(&n[j].abs()).unwrap()).unwrap();
        side[f] = (ax * 2 + if n[ax] >= 0.0 { 0 } else { 1 }) as u8;
    }
    // faces next to each other across an edge
    let mut by_edge: HashMap<(u32, u32), Vec<u32>> = HashMap::new();
    for f in 0..nf { for e in 0..3 { let (a, b) = (idx[f * 3 + e], idx[f * 3 + (e + 1) % 3]); by_edge.entry((a.min(b), a.max(b))).or_default().push(f as u32); } }
    let mut chart = vec![u32::MAX; nf];
    let mut charts = 0u32;
    let mut stack = Vec::new();
    for f0 in 0..nf {
        if chart[f0] != u32::MAX { continue; }
        chart[f0] = charts;
        stack.push(f0);
        while let Some(f) = stack.pop() {
            for e in 0..3 {
                let (a, b) = (idx[f * 3 + e], idx[f * 3 + (e + 1) % 3]);
                for &g in &by_edge[&(a.min(b), a.max(b))] {
                    let g = g as usize;
                    if chart[g] == u32::MAX && side[g] == side[f] { chart[g] = charts; stack.push(g); }
                }
            }
        }
        charts += 1;
    }
    // a UV vertex per (vertex, chart); projected onto its side
    let mut uv: Vec<f64> = Vec::new();
    let mut corner = vec![0u32; nf * 3];
    let mut key: HashMap<(u32, u32), u32> = HashMap::new();
    let mut cside = vec![0u8; charts as usize];
    for f in 0..nf {
        cside[chart[f] as usize] = side[f];
        let (su, sv) = sides(side[f] as usize);
        for e in 0..3 {
            let v = idx[f * 3 + e];
            let id = *key.entry((v, chart[f])).or_insert_with(|| {
                let p = p3(pos, v as usize);
                uv.push(p[0] * su[0] + p[1] * su[1] + p[2] * su[2]);
                uv.push(p[0] * sv[0] + p[1] * sv[1] + p[2] * sv[2]);
                (uv.len() / 2 - 1) as u32
            });
            corner[f * 3 + e] = id;
        }
    }
    // each chart's box, then shelves
    let nc = charts as usize;
    let mut lo = vec![[f64::INFINITY; 2]; nc];
    let mut hi = vec![[f64::NEG_INFINITY; 2]; nc];
    let mut owner = vec![0u32; uv.len() / 2];
    for f in 0..nf { for e in 0..3 { owner[corner[f * 3 + e] as usize] = chart[f]; } }
    for (k, &c) in owner.iter().enumerate() { let c = c as usize; for d in 0..2 { lo[c][d] = lo[c][d].min(uv[k * 2 + d]); hi[c][d] = hi[c][d].max(uv[k * 2 + d]); } }
    let biggest = (0..nc).map(|c| (hi[c][0] - lo[c][0]).max(hi[c][1] - lo[c][1])).fold(0.0, f64::max).max(1e-9);
    let pad = biggest * 0.02;
    let area: f64 = (0..nc).map(|c| (hi[c][0] - lo[c][0] + pad) * (hi[c][1] - lo[c][1] + pad)).sum();
    let width = (area.sqrt() * 1.15).max(biggest + pad);
    let mut order: Vec<usize> = (0..nc).collect();
    order.sort_by(|&a, &b| (hi[b][1] - lo[b][1]).partial_cmp(&(hi[a][1] - lo[a][1])).unwrap());
    let mut at = vec![[0.0f64; 2]; nc];
    let (mut x, mut y, mut row) = (pad, pad, 0.0f64);
    for &c in &order {
        let (w, h) = (hi[c][0] - lo[c][0], hi[c][1] - lo[c][1]);
        if x + w + pad > width && x > pad { x = pad; y += row + pad; row = 0.0; }
        at[c] = [x - lo[c][0], y - lo[c][1]];
        x += w + pad; row = row.max(h);
    }
    let size = width.max(y + row + pad);
    let out: Vec<f32> = (0..uv.len() / 2).flat_map(|k| { let c = owner[k] as usize; [((uv[k * 2] + at[c][0]) / size) as f32, ((uv[k * 2 + 1] + at[c][1]) / size) as f32] }).collect();
    Unwrap { uv: out, corner, charts: nc }
}

// every texel of each face in UV space: f(face, barycentric weights, x, y)
fn raster<F: FnMut(usize, [f64; 3], usize, usize)>(uv: &[f32], corner: &[u32], nf: usize, size: usize, mut f: F) {
    let s = size as f64;
    for t in 0..nf {
        let p: Vec<[f64; 2]> = (0..3).map(|e| { let k = corner[t * 3 + e] as usize; [uv[k * 2] as f64 * s, (1.0 - uv[k * 2 + 1] as f64) * s] }).collect();
        let x0 = p.iter().map(|q| q[0]).fold(f64::INFINITY, f64::min).floor().max(0.0) as usize;
        let x1 = (p.iter().map(|q| q[0]).fold(f64::NEG_INFINITY, f64::max).ceil() as usize).min(size - 1);
        let y0 = p.iter().map(|q| q[1]).fold(f64::INFINITY, f64::min).floor().max(0.0) as usize;
        let y1 = (p.iter().map(|q| q[1]).fold(f64::NEG_INFINITY, f64::max).ceil() as usize).min(size - 1);
        let area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
        if area.abs() < 1e-12 { continue; }
        for y in y0..=y1 {
            for x in x0..=x1 {
                let (px, py) = (x as f64 + 0.5, y as f64 + 0.5);
                let w0 = ((p[1][0] - px) * (p[2][1] - py) - (p[2][0] - px) * (p[1][1] - py)) / area;
                let w1 = ((p[2][0] - px) * (p[0][1] - py) - (p[0][0] - px) * (p[2][1] - py)) / area;
                let w2 = 1.0 - w0 - w1;
                // (a little over the edges, so neighbouring faces leave no gaps)
                let e = -0.02;
                if w0 < e || w1 < e || w2 < e { continue; }
                f(t, [w0, w1, w2], x, y);
            }
        }
    }
}

// grow the filled texels out over empty ones, so seams do not show the background when filtered
fn dilate(img: &mut [u8], filled: &mut [bool], size: usize, passes: usize) {
    for _ in 0..passes {
        let was = filled.to_vec();
        for y in 0..size { for x in 0..size {
            let k = y * size + x; if was[k] { continue; }
            let (mut s, mut c) = ([0u32; 4], 0u32);
            for (dx, dy) in [(1i64, 0i64), (-1, 0), (0, 1), (0, -1)] {
                let (xx, yy) = (x as i64 + dx, y as i64 + dy);
                if xx < 0 || yy < 0 || xx >= size as i64 || yy >= size as i64 { continue; }
                let o = yy as usize * size + xx as usize;
                if was[o] { for q in 0..4 { s[q] += img[o * 4 + q] as u32; } c += 1; }
            }
            if c > 0 { for q in 0..4 { img[k * 4 + q] = (s[q] / c) as u8; } filled[k] = true; }
        } }
    }
}

/// The vertex colours painted into the charts (RGBA, `size` × `size`).
pub fn bake_color(uv: &[f32], corner: &[u32], idx: &[u32], col: &[f32], size: usize) -> Vec<u8> {
    let mut img = vec![0u8; size * size * 4];
    let mut filled = vec![false; size * size];
    raster(uv, corner, idx.len() / 3, size, |t, w, x, y| {
        let k = y * size + x;
        for q in 0..3 {
            let v = (0..3).map(|e| col[idx[t * 3 + e] as usize * 3 + q] as f64 * w[e]).sum::<f64>();
            img[k * 4 + q] = (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
        }
        img[k * 4 + 3] = 255; filled[k] = true;
    });
    dilate(&mut img, &mut filled, size, 6);
    img
}

/// A tangent-space normal map: for each texel of the low surface, the normal of the high surface found
/// along the low one's normal, in the frame of the texel (tangent along U, bitangent along V, normal).
pub fn bake_normals(pos: &[f32], idx: &[u32], nrm: &[f32], uv: &[f32], corner: &[u32], hpos: &[f32], hidx: &[u32], size: usize, reach: f64) -> Vec<u8> {
    let mut img = vec![0u8; size * size * 4];
    let mut filled = vec![false; size * size];
    let Some(hc) = crate::cloth::Collider::new(hpos, hidx, reach / 3.0) else { return img };
    // per face: tangent and bitangent from the UV directions
    let nf = idx.len() / 3;
    let mut tb = vec![[[0f64; 3]; 2]; nf];
    for t in 0..nf {
        let p: Vec<[f64; 3]> = (0..3).map(|e| p3(pos, idx[t * 3 + e] as usize)).collect();
        let w: Vec<[f64; 2]> = (0..3).map(|e| { let k = corner[t * 3 + e] as usize; [uv[k * 2] as f64, uv[k * 2 + 1] as f64] }).collect();
        let (e1, e2) = ([p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]]);
        let (du1, dv1, du2, dv2) = (w[1][0] - w[0][0], w[1][1] - w[0][1], w[2][0] - w[0][0], w[2][1] - w[0][1]);
        let r = du1 * dv2 - du2 * dv1;
        if r.abs() < 1e-20 { continue; }
        let r = 1.0 / r;
        tb[t][0] = [(e1[0] * dv2 - e2[0] * dv1) * r, (e1[1] * dv2 - e2[1] * dv1) * r, (e1[2] * dv2 - e2[2] * dv1) * r];
        tb[t][1] = [(e2[0] * du1 - e1[0] * du2) * r, (e2[1] * du1 - e1[1] * du2) * r, (e2[2] * du1 - e1[2] * du2) * r];
    }
    raster(uv, corner, nf, size, |t, w, x, y| {
        let at = |a: &[f32], e: usize, q: usize| a[idx[t * 3 + e] as usize * 3 + q] as f64;
        let p = [0, 1, 2].map(|q| (0..3).map(|e| at(pos, e, q) * w[e]).sum::<f64>());
        let mut n = [0, 1, 2].map(|q| (0..3).map(|e| at(nrm, e, q) * w[e]).sum::<f64>());
        let nl = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt(); if nl < 1e-12 { return; }
        for c in n.iter_mut() { *c /= nl; }
        // along the normal to the high surface (as Project All does)
        let mut xq = p;
        let mut hit = None;
        for _ in 0..8 {
            let Some((q, ht, _)) = hc.closest(xq) else { break };
            let h = (q[0] - p[0]) * n[0] + (q[1] - p[1]) * n[1] + (q[2] - p[2]) * n[2];
            if h.abs() > reach { break; }
            xq = [p[0] + n[0] * h, p[1] + n[1] * h, p[2] + n[2] * h];
            hit = Some(ht);
        }
        let Some(ht) = hit else { return };
        let (a, b, c) = (p3(hpos, hidx[ht * 3] as usize), p3(hpos, hidx[ht * 3 + 1] as usize), p3(hpos, hidx[ht * 3 + 2] as usize));
        let (u, v) = ([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
        let mut hn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        let hl = (hn[0] * hn[0] + hn[1] * hn[1] + hn[2] * hn[2]).sqrt(); if hl < 1e-20 { return; }
        for c in hn.iter_mut() { *c /= hl; }
        // the frame: tangent made square to the normal, bitangent from them (with the UV's handedness)
        let dot = |a: [f64; 3], b: [f64; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        let mut tt = tb[t][0];
        let d = dot(tt, n); for q in 0..3 { tt[q] -= n[q] * d; }
        let tl = dot(tt, tt).sqrt(); if tl < 1e-20 { return; }
        for c in tt.iter_mut() { *c /= tl; }
        let mut bb = [n[1] * tt[2] - n[2] * tt[1], n[2] * tt[0] - n[0] * tt[2], n[0] * tt[1] - n[1] * tt[0]];
        if dot(bb, tb[t][1]) < 0.0 { for c in bb.iter_mut() { *c = -*c; } }
        let local = [dot(hn, tt), dot(hn, bb), dot(hn, n)];
        let k = y * size + x;
        for q in 0..3 { img[k * 4 + q] = ((local[q] * 0.5 + 0.5).clamp(0.0, 1.0) * 255.0 + 0.5) as u8; }
        img[k * 4 + 3] = 255; filled[k] = true;
    });
    // (texels between charts: the flat normal)
    dilate(&mut img, &mut filled, size, 6);
    for k in 0..size * size { if !filled[k] { img[k * 4] = 128; img[k * 4 + 1] = 128; img[k * 4 + 2] = 255; img[k * 4 + 3] = 255; } }
    img
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_cube_unwraps_into_six_charts_without_overlaps() {
        let mut pos = Vec::new();
        for k in 0..8u32 { pos.extend_from_slice(&[if k & 1 != 0 { 0.5f32 } else { -0.5 }, if k & 2 != 0 { 0.5 } else { -0.5 }, if k & 4 != 0 { 0.5 } else { -0.5 }]); }
        let mut idx = Vec::new();
        for f in [[0u32, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]] { idx.extend_from_slice(&[f[0], f[1], f[2], f[0], f[2], f[3]]); }
        let u = unwrap(&pos, &idx);
        assert_eq!(u.charts, 6);
        assert_eq!(u.uv.len() / 2, 24);
        assert!(u.uv.iter().all(|&v| (0.0..=1.0).contains(&v)));
        // every face has a positive area in UV (nothing turned over)
        for f in 0..idx.len() / 3 {
            let w: Vec<[f32; 2]> = (0..3).map(|e| { let k = u.corner[f * 3 + e] as usize; [u.uv[k * 2], u.uv[k * 2 + 1]] }).collect();
            let a = (w[1][0] - w[0][0]) * (w[2][1] - w[0][1]) - (w[2][0] - w[0][0]) * (w[1][1] - w[0][1]);
            assert!(a > 0.0, "face {} area {}", f, a);
        }
        let col = vec![1.0f32, 0.0, 0.0].repeat(8);
        let img = bake_color(&u.uv, &u.corner, &idx, &col, 64);
        let red = img.chunks_exact(4).filter(|p| p[0] == 255 && p[1] == 0 && p[3] == 255).count();
        assert!(red > 64 * 64 / 3, "{}", red);
    }
}
