//! Subdivision levels (the page's mrFrames, mrEncode, mrDecode and mrLower), bit for bit: every value is
//! kept as f32 where the page keeps it in a Float32Array and worked on as f64 where the page works on a
//! JavaScript number, and the sums go in the page's order.
//!
//! A level's detail is an offset per vertex in the local frame of the subdivided surface: the area-
//! weighted normal and a tangent toward the lowest-numbered neighbour. The lower level is the higher
//! one, smoothed a little (Taubin: no shrinking), at the vertices the two share.

use crate::brush::js_hypot;

/// Normal and tangent per vertex (3 values each).
pub fn frames(pos: &[f32], idx: &[u32], n: usize) -> (Vec<f32>, Vec<f32>) {
    let mut nn = vec![0f32; n * 3];
    let mut tt = vec![0f32; n * 3];
    let mut low = vec![-1i64; n];
    let p = |i: u32, k: usize| pos[i as usize * 3 + k] as f64;
    for f in idx.chunks_exact(3) {
        let (a, b, c) = (f[0], f[1], f[2]);
        let (ux, uy, uz) = (p(b, 0) - p(a, 0), p(b, 1) - p(a, 1), p(b, 2) - p(a, 2));
        let (vx, vy, vz) = (p(c, 0) - p(a, 0), p(c, 1) - p(a, 1), p(c, 2) - p(a, 2));
        let (nx, ny, nz) = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
        for (v, q, r) in [(a, b, c), (b, c, a), (c, a, b)] {
            let o = v as usize * 3;
            nn[o] = (nn[o] as f64 + nx) as f32;
            nn[o + 1] = (nn[o + 1] as f64 + ny) as f32;
            nn[o + 2] = (nn[o + 2] as f64 + nz) as f32;
            let m = q.min(r) as i64;
            let l = &mut low[v as usize];
            if *l < 0 || m < *l { *l = m; }
        }
    }
    for v in 0..n {
        let o = v * 3;
        let (mut nx, mut ny, mut nz) = (nn[o] as f64, nn[o + 1] as f64, nn[o + 2] as f64);
        let mut l = js_hypot(&[nx, ny, nz]);
        if l == 0.0 || l.is_nan() { l = 1.0; }
        nx /= l; ny /= l; nz /= l;
        nn[o] = nx as f32; nn[o + 1] = ny as f32; nn[o + 2] = nz as f32;
        let (mut tx, mut ty, mut tz) = (1.0f64, 0.0f64, 0.0f64);
        let u = low[v];
        if u >= 0 {
            let u = u as u32;
            tx = p(u, 0) - pos[o] as f64; ty = p(u, 1) - pos[o + 1] as f64; tz = p(u, 2) - pos[o + 2] as f64;
        }
        let mut d = tx * nx + ty * ny + tz * nz;
        tx -= nx * d; ty -= ny * d; tz -= nz * d;
        l = js_hypot(&[tx, ty, tz]);
        if l < 1e-12 {
            let oo = if nx.abs() < 0.9 { [1.0, 0.0, 0.0] } else { [0.0, 1.0, 0.0] };
            tx = oo[0]; ty = oo[1]; tz = oo[2];
            d = tx * nx + ty * ny + tz * nz;
            tx -= nx * d; ty -= ny * d; tz -= nz * d;
            l = js_hypot(&[tx, ty, tz]);
        }
        tt[o] = (tx / l) as f32; tt[o + 1] = (ty / l) as f32; tt[o + 2] = (tz / l) as f32;
    }
    (nn, tt)
}

/// The detail of `pos` over the subdivided surface `sub` (the same vertices), in sub's frames.
pub fn encode(pos: &[f32], sub: &[f32], idx: &[u32], n: usize, out: &mut [f32]) {
    let (nn, tt) = frames(sub, idx, n);
    for v in 0..n {
        let o = v * 3;
        let x = pos[o] as f64 - sub[o] as f64;
        let y = pos[o + 1] as f64 - sub[o + 1] as f64;
        let z = pos[o + 2] as f64 - sub[o + 2] as f64;
        let (nx, ny, nz) = (nn[o] as f64, nn[o + 1] as f64, nn[o + 2] as f64);
        let (tx, ty, tz) = (tt[o] as f64, tt[o + 1] as f64, tt[o + 2] as f64);
        let (bx, by, bz) = (ny * tz - nz * ty, nz * tx - nx * tz, nx * ty - ny * tx);
        out[o] = (x * tx + y * ty + z * tz) as f32;
        out[o + 1] = (x * bx + y * by + z * bz) as f32;
        out[o + 2] = (x * nx + y * ny + z * nz) as f32;
    }
}

/// The surface `sub` with the detail `d` put back.
pub fn decode(sub: &[f32], d: &[f32], idx: &[u32], n: usize, out: &mut [f32]) {
    let (nn, tt) = frames(sub, idx, n);
    for v in 0..n {
        let o = v * 3;
        let (nx, ny, nz) = (nn[o] as f64, nn[o + 1] as f64, nn[o + 2] as f64);
        let (tx, ty, tz) = (tt[o] as f64, tt[o + 1] as f64, tt[o + 2] as f64);
        let (bx, by, bz) = (ny * tz - nz * ty, nz * tx - nx * tz, nx * ty - ny * tx);
        let (d0, d1, d2) = (d[o] as f64, d[o + 1] as f64, d[o + 2] as f64);
        out[o] = (sub[o] as f64 + tx * d0 + bx * d1 + nx * d2) as f32;
        out[o + 1] = (sub[o + 1] as f64 + ty * d0 + by * d1 + ny * d2) as f32;
        out[o + 2] = (sub[o + 2] as f64 + tz * d0 + bz * d1 + nz * d2) as f32;
    }
}

/// Neighbours of every vertex in the order the page finds them (faces by number, corners in order),
/// and whether the vertex is on an open border (a neighbour shared by one face only).
fn neighbours(idx: &[u32], n: usize) -> (Vec<u32>, Vec<u32>, Vec<bool>) {
    let f = idx.len() / 3;
    let mut vf_off = vec![0u32; n + 1];
    for &v in idx { vf_off[v as usize + 1] += 1; }
    for i in 0..n { vf_off[i + 1] += vf_off[i]; }
    let mut vf = vec![0u32; idx.len()];
    let mut fill: Vec<u32> = vf_off[..n].to_vec();
    for t in 0..f { for k in 0..3 { let v = idx[t * 3 + k] as usize; vf[fill[v] as usize] = t as u32; fill[v] += 1; } }
    // (every index was checked against n by the caller, so the lookups below cannot miss)
    let mut stamp = vec![u32::MAX; n];
    let mut cnt = vec![0u8; n];
    let mut vv_off = vec![0u32; n + 1];
    let mut vv: Vec<u32> = Vec::with_capacity(idx.len());
    let mut boundary = vec![false; n];
    for v in 0..n {
        let start = vv.len();
        for j in vf_off[v] as usize..vf_off[v + 1] as usize {
            let t = vf[j] as usize * 3;
            for k in 0..3 {
                let u = idx[t + k];
                if u as usize == v { continue; }
                // SAFETY: u < n (checked by the caller)
                unsafe {
                    let su = stamp.get_unchecked_mut(u as usize);
                    let cu = cnt.get_unchecked_mut(u as usize);
                    if *su != v as u32 { *su = v as u32; *cu = 0; vv.push(u); }
                    *cu = cu.saturating_add(1);
                }
            }
        }
        for &u in &vv[start..] { if cnt[u as usize] == 1 { boundary[v] = true; break; } }
        vv_off[v + 1] = vv.len() as u32;
    }
    (vv_off, vv, boundary)
}

/// The lower level's positions (its first `n_low` vertices) from the higher level.
pub fn lower(high: &[f32], idx: &[u32], n_high: usize, n_low: usize, out: &mut [f32]) {
    let (off, vv, boundary) = neighbours(idx, n_high);
    let mut p: Vec<f32> = high[..n_high * 3].to_vec();
    let mut q = vec![0f32; n_high * 3];
    for it in 0..4 {
        let k = if it % 2 == 1 { -0.53 } else { 0.5 };
        for v in 0..n_high {
            let (a, b, o) = (off[v] as usize, off[v + 1] as usize, v * 3);
            if b == a || boundary[v] { q[o] = p[o]; q[o + 1] = p[o + 1]; q[o + 2] = p[o + 2]; continue; }
            let (mut x, mut y, mut z) = (0f64, 0f64, 0f64);
            for &u in &vv[a..b] {
                let u = u as usize * 3;
                // SAFETY: every neighbour is a vertex below n_high, and p holds n_high × 3 values
                unsafe { x += *p.get_unchecked(u) as f64; y += *p.get_unchecked(u + 1) as f64; z += *p.get_unchecked(u + 2) as f64; }
            }
            let inv = 1.0 / (b - a) as f64;
            q[o] = (p[o] as f64 + (x * inv - p[o] as f64) * k) as f32;
            q[o + 1] = (p[o + 1] as f64 + (y * inv - p[o + 1] as f64) * k) as f32;
            q[o + 2] = (p[o + 2] as f64 + (z * inv - p[o + 2] as f64) * k) as f32;
        }
        std::mem::swap(&mut p, &mut q);
    }
    out[..n_low * 3].copy_from_slice(&p[..n_low * 3]);
}

#[cfg(test)]
mod tests {
    use super::*;
    fn octa() -> (Vec<f32>, Vec<u32>) {
        let pos = vec![1.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, -1.0];
        let idx = vec![0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5];
        (pos, idx)
    }
    #[test]
    fn frames_are_unit_and_square() {
        let (pos, idx) = octa();
        let (n, t) = frames(&pos, &idx, 6);
        for v in 0..6 {
            let a = &n[v * 3..v * 3 + 3]; let b = &t[v * 3..v * 3 + 3];
            let ln = (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt();
            let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
            assert!((ln - 1.0).abs() < 1e-5 && dot.abs() < 1e-5);
            // the normal points outward
            assert!(a[0] * pos[v * 3] + a[1] * pos[v * 3 + 1] + a[2] * pos[v * 3 + 2] > 0.9);
        }
    }
    #[test]
    fn decode_undoes_encode() {
        let (sub, idx) = octa();
        let pos: Vec<f32> = sub.iter().enumerate().map(|(i, &x)| x * 1.1 + (i as f32 * 0.37).sin() * 0.05).collect();
        let mut d = vec![0f32; 18]; encode(&pos, &sub, &idx, 6, &mut d);
        let mut back = vec![0f32; 18]; decode(&sub, &d, &idx, 6, &mut back);
        for k in 0..18 { assert!((back[k] - pos[k]).abs() < 1e-5); }
    }
    #[test]
    fn lower_keeps_size_and_smooths() {
        let (pos, idx) = octa();
        let mut out = vec![0f32; 18]; lower(&pos, &idx, 6, 6, &mut out);
        // on so coarse a shape Taubin moves every vertex by the same amount, and not far
        let r: Vec<f32> = (0..6).map(|v| (out[v * 3].powi(2) + out[v * 3 + 1].powi(2) + out[v * 3 + 2].powi(2)).sqrt()).collect();
        assert!(r.iter().all(|&x| (x - r[0]).abs() < 1e-5 && x > 0.5 && x < 1.5), "{r:?}");
    }
}
