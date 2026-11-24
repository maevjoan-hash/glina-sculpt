//! The sculpting brushes' own work on the points under one dab, the same as the page's JavaScript
//! (which stays as the fallback), step for step, so a stroke gives the same surface either way.
//! The page gathers the points under the brush (with their falloff) and the brush plane; here every
//! point gets its new position (or mask, or colour), and `changed` says which ones moved, so the page
//! keeps them for undo.
//!
//! `par`: c (3) the dab's centre, a (3) the area normal, p (3) the area centre, v (3) across the
//! stroke, r, s (strength), sign, mod (Brush Mod), the planar plane (6: point, normal), the stroke's
//! direction (3), the paint colour (3).

pub const DRAW: u32 = 1;
pub const INFLATE: u32 = 2;
pub const CLAY: u32 = 3;
pub const STRIPS: u32 = 4;
pub const FLATTEN: u32 = 5;
pub const SCRAPE: u32 = 6;
pub const PLANAR: u32 = 7;
pub const LAYER: u32 = 8;
pub const PINCH: u32 = 9;
pub const CREASE: u32 = 10;
pub const MORPH: u32 = 11;
pub const GROOM: u32 = 12;
pub const MASK: u32 = 13;
pub const PAINT: u32 = 14;
/// (as Blender's Thumb / Nudge) along the surface with the pen: par 16..18 the step in the brush's plane,
/// 19 the strength for it
pub const NUDGE: u32 = 15;
/// (as Blender's Multiplane Scrape) par 16..18 across the stroke, 19 cos and 20 sin of half the angle, 21 the
/// strength for it
pub const MPSCRAPE: u32 = 16;
/// (as Blender's Clay Thumb) par 16..18 the leaning plane's normal, 19 the strength for it
pub const CLAYTHUMB: u32 = 17;

/// `pos` (3 per point) in and out; `aux`: layer heights (1), morph targets (3), fibre `along` (1),
/// colours (3, in and out) or the mask (1, in and out), by kind. Returns how many points changed.
#[allow(clippy::too_many_arguments)]
pub fn dab(kind: u32, pos: &mut [f32], nrm: &[f32], mask: &[f32], fall: &[f32], par: &[f64], aux: &mut [f32], changed: &mut [u8]) -> usize {
    let n = fall.len();
    let g = |k: usize| par[k];
    let (cx, cy, cz) = (g(0), g(1), g(2));
    let (ax, ay, az) = (g(3), g(4), g(5));
    let (px, py, pz) = (g(6), g(7), g(8));
    let (vx, vy, vz) = (g(9), g(10), g(11));
    let (r, s, sign, md) = (g(12), g(13), g(14), g(15));
    let mut count = 0;
    // (each step rounds to f32 as the page's Float32Array does)
    let add = |p: &mut f32, d: f64| { *p = (*p as f64 + d) as f32; };
    for c in changed.iter_mut() { *c = 0; }
    match kind {
        DRAW => {
            let d = r * 0.12 * s * sign;
            let kp = if md > 0.0 { md * 0.3 * s } else { 0.0 };
            let ki = if md < 0.0 { -md * r * 0.06 * s * sign } else { 0.0 };
            for k in 0..n {
                let w = fall[k] as f64 * (1.0 - mask[k] as f64);
                if w == 0.0 { continue; }
                changed[k] = 1; count += 1;
                let o = k * 3;
                add(&mut pos[o], ax * d * w); add(&mut pos[o + 1], ay * d * w); add(&mut pos[o + 2], az * d * w);
                if kp != 0.0 {
                    let (ox, oy, oz) = (cx - pos[o] as f64, cy - pos[o + 1] as f64, cz - pos[o + 2] as f64);
                    let across = ox * vx + oy * vy + oz * vz;
                    let ww = w.abs();
                    add(&mut pos[o], vx * across * kp * ww); add(&mut pos[o + 1], vy * across * kp * ww); add(&mut pos[o + 2], vz * across * kp * ww);
                }
                if ki != 0.0 {
                    add(&mut pos[o], nrm[o] as f64 * ki * w); add(&mut pos[o + 1], nrm[o + 1] as f64 * ki * w); add(&mut pos[o + 2], nrm[o + 2] as f64 * ki * w);
                }
            }
        }
        INFLATE => {
            // (inward half as strong as outward, as in Blender)
            let d = r * 0.08 * s * (if sign < 0.0 { 0.5 * sign } else { sign });
            for k in 0..n {
                let w = fall[k] as f64 * (1.0 - mask[k] as f64);
                if w == 0.0 { continue; }
                changed[k] = 1; count += 1;
                let o = k * 3;
                for q in 0..3 { add(&mut pos[o + q], nrm[o + q] as f64 * d * w); }
            }
        }
        CLAY | STRIPS | FLATTEN | SCRAPE => {
            let fill = kind == CLAY || kind == STRIPS;
            let off = if fill { r * (if kind == STRIPS { 0.12 } else { 0.18 }) * sign } else { 0.0 };
            let (qx, qy, qz) = (px + ax * off, py + ay * off, pz + az * off);
            let k0 = if fill { s * 0.5 } else if kind == SCRAPE { s * 0.6 } else { s * 0.35 };
            let flip = if kind == FLATTEN && sign < 0.0 { -1.0 } else { 1.0 };
            for k in 0..n {
                let mut w = fall[k] as f64 * (1.0 - mask[k] as f64);
                if w <= 0.0 { continue; }
                let o = k * 3;
                // clay is laid on (or cut from) what faces the brush, not on walls upright to it
                if fill {
                    let f = nrm[o] as f64 * ax + nrm[o + 1] as f64 * ay + nrm[o + 2] as f64 * az;
                    if f <= 0.15 { continue; }
                    if f < 0.5 { let q = (f - 0.15) / 0.35; w *= q * q * (3.0 - 2.0 * q); }
                }
                let d = (pos[o] as f64 - qx) * ax + (pos[o + 1] as f64 - qy) * ay + (pos[o + 2] as f64 - qz) * az;
                if kind == STRIPS {
                    // (as Blender's Clay Strips) pushed the same way along the plane's normal, most half a
                    // radius under the plane, nothing at it or a radius under it
                    let z = -d * sign / r;
                    if z <= 0.0 || z >= 1.0 { continue; }
                    changed[k] = 1; count += 1;
                    let t = sign * r * s * 0.6 * z * (1.0 - z) * w;
                    add(&mut pos[o], ax * t); add(&mut pos[o + 1], ay * t); add(&mut pos[o + 2], az * t);
                    continue;
                }
                if fill && d * sign > 0.0 { continue; }
                if kind == SCRAPE && d * sign < 0.0 { continue; }
                changed[k] = 1; count += 1;
                let t = d * w * k0 * flip;
                add(&mut pos[o], -ax * t); add(&mut pos[o + 1], -ay * t); add(&mut pos[o + 2], -az * t);
            }
        }
        PLANAR => {
            let (q0, q1, q2, n0, n1, n2) = (g(16), g(17), g(18), g(19), g(20), g(21));
            let k0 = s * 0.5;
            for k in 0..n {
                let w = fall[k] as f64 * (1.0 - mask[k] as f64);
                if w <= 0.0 { continue; }
                let o = k * 3;
                let d = (pos[o] as f64 - q0) * n0 + (pos[o + 1] as f64 - q1) * n1 + (pos[o + 2] as f64 - q2) * n2;
                if d.abs() < 1e-9 { continue; }
                changed[k] = 1; count += 1;
                let t = d * w * k0;
                add(&mut pos[o], -n0 * t); add(&mut pos[o + 1], -n1 * t); add(&mut pos[o + 2], -n2 * t);
            }
        }
        LAYER => {
            let h = r * 0.3 * s * sign;
            for k in 0..n {
                let w = fall[k] as f64 * (1.0 - mask[k] as f64);
                if w <= 0.0 { continue; }
                let want = h * w;
                let lh = aux[k] as f64;
                let step = if sign > 0.0 { (want - lh).max(0.0) } else { (want - lh).min(0.0) };
                if step == 0.0 { continue; }
                changed[k] = 1; count += 1;
                aux[k] = (lh + step) as f32;
                let o = k * 3;
                // (along each point's own normal from when the stroke first moved it: the page passes those)
                add(&mut pos[o], nrm[o] as f64 * step); add(&mut pos[o + 1], nrm[o + 1] as f64 * step); add(&mut pos[o + 2], nrm[o + 2] as f64 * step);
            }
        }
        PINCH | CREASE => {
            let kp = (if kind == PINCH { 0.18 } else { 0.14 }) * s * sign;
            let dd = if kind == CREASE { -r * 0.07 * s * sign } else { 0.0 };
            for k in 0..n {
                let w = fall[k] as f64 * (1.0 - mask[k] as f64);
                if w <= 0.0 { continue; }
                changed[k] = 1; count += 1;
                let o = k * 3;
                let (mut wx, mut wy, mut wz) = (cx - pos[o] as f64, cy - pos[o + 1] as f64, cz - pos[o + 2] as f64);
                let along = wx * ax + wy * ay + wz * az;
                wx -= ax * along; wy -= ay * along; wz -= az * along;
                if kind == PINCH && g(16) != 0.0 {
                    // (toward the stroke's line: only the part across the stroke)
                    let across = wx * vx + wy * vy + wz * vz;
                    wx = vx * across; wy = vy * across; wz = vz * across;
                }
                let wc = w * w;
                add(&mut pos[o], wx * kp * w + ax * dd * wc); add(&mut pos[o + 1], wy * kp * w + ay * dd * wc); add(&mut pos[o + 2], wz * kp * w + az * dd * wc);
            }
        }
        MORPH => {
            let k0 = (s * 0.5).min(1.0) * sign;
            for k in 0..n {
                let w = fall[k] as f64 * (1.0 - mask[k] as f64);
                if w <= 0.0 { continue; }
                changed[k] = 1; count += 1;
                let o = k * 3;
                for q in 0..3 { let p = pos[o + q] as f64; add(&mut pos[o + q], (aux[o + q] as f64 - p) * w * k0); }
            }
        }
        GROOM => {
            let k0 = r * 0.18 * s;
            let (dx, dy, dz) = (g(22), g(23), g(24));
            for k in 0..n {
                let t = aux[k] as f64;
                let w = fall[k] as f64 * (1.0 - mask[k] as f64) * t * t.sqrt();
                if w <= 0.0 { continue; }
                changed[k] = 1; count += 1;
                let o = k * 3;
                add(&mut pos[o], dx * k0 * w); add(&mut pos[o + 1], dy * k0 * w); add(&mut pos[o + 2], dz * k0 * w);
            }
        }
        MASK => {
            let d = s * 0.6 * sign;
            for k in 0..n {
                if fall[k] <= 0.0 { continue; }
                changed[k] = 1; count += 1;
                aux[k] = (aux[k] as f64 + d * fall[k] as f64).clamp(0.0, 1.0) as f32;
            }
        }
        PAINT => {
            let (cr, cg, cb) = if sign < 0.0 { (1.0, 1.0, 1.0) } else { (g(25), g(26), g(27)) };
            for k in 0..n {
                let w = (fall[k] as f64 * s * 0.6).min(1.0) * (1.0 - mask[k] as f64);
                if w <= 0.0 { continue; }
                changed[k] = 1; count += 1;
                let o = k * 3;
                for (q, c) in [cr, cg, cb].into_iter().enumerate() { let a = aux[o + q] as f64; aux[o + q] = (a + (c - a) * w) as f32; }
            }
        }
        NUDGE => {
            let (tx, ty, tz, k0) = (g(16), g(17), g(18), g(19));
            for k in 0..n {
                let w = fall[k] as f64 * (1.0 - mask[k] as f64) * k0;
                if w <= 0.0 { continue; }
                changed[k] = 1; count += 1;
                let o = k * 3;
                add(&mut pos[o], tx * w); add(&mut pos[o + 1], ty * w); add(&mut pos[o + 2], tz * w);
            }
        }
        CLAYTHUMB => {
            let (nx, ny, nz, k0) = (g(16), g(17), g(18), g(19));
            for k in 0..n {
                let w = fall[k] as f64 * (1.0 - mask[k] as f64);
                if w <= 0.0 { continue; }
                let o = k * 3;
                let d = (pos[o] as f64 - cx) * nx + (pos[o + 1] as f64 - cy) * ny + (pos[o + 2] as f64 - cz) * nz;
                if d.abs() < 1e-9 { continue; }
                changed[k] = 1; count += 1;
                let t = d * w * k0;
                add(&mut pos[o], -nx * t); add(&mut pos[o + 1], -ny * t); add(&mut pos[o + 2], -nz * t);
            }
        }
        MPSCRAPE => {
            let (xx, xy, xz, ch, sh, k0) = (g(16), g(17), g(18), g(19), g(20), g(21));
            // the planes meet on the ridge already there: the highest point near the stroke's line
            let (mut ox, mut oh, mut best) = (0.0f64, 0.0f64, f64::NEG_INFINITY);
            if sign > 0.0 {
                for k in 0..n {
                    let o = k * 3;
                    let (dx, dy, dz) = (pos[o] as f64 - cx, pos[o + 1] as f64 - cy, pos[o + 2] as f64 - cz);
                    let lx = dx * xx + dy * xy + dz * xz;
                    if lx.abs() > r * 0.2 { continue; }
                    let hh = dx * ax + dy * ay + dz * az;
                    let sc = hh - lx.abs() * 1e-3;
                    if sc > best { best = sc; ox = lx; oh = hh; }
                }
            }
            let (qx, qy, qz) = (cx + xx * ox + ax * oh, cy + xy * ox + ay * oh, cz + xz * ox + az * oh);
            for k in 0..n {
                let w = fall[k] as f64 * (1.0 - mask[k] as f64);
                if w <= 0.0 { continue; }
                let o = k * 3;
                let (dx, dy, dz) = (pos[o] as f64 - qx, pos[o + 1] as f64 - qy, pos[o + 2] as f64 - qz);
                let sd = if dx * xx + dy * xy + dz * xz > 0.0 { sh } else { -sh };
                let (nx, ny, nz) = (ax * ch + xx * sd, ay * ch + xy * sd, az * ch + xz * sd);
                let above = dx * nx + dy * ny + dz * nz;
                if above <= 0.0 { continue; }
                changed[k] = 1; count += 1;
                let t = above * w * k0;
                add(&mut pos[o], -nx * t); add(&mut pos[o + 1], -ny * t); add(&mut pos[o + 2], -nz * t);
            }
        }
        _ => {}
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;
    fn par(r: f64, s: f64, sign: f64) -> Vec<f64> {
        let mut p = vec![0.0f64; 28];
        p[5] = 1.0; // area normal +z
        p[10] = 1.0; // across: +y
        p[12] = r; p[13] = s; p[14] = sign;
        p
    }
    #[test]
    fn draw_lifts_along_the_area_normal_and_mask_holds() {
        let mut pos = vec![0.0f32; 6];
        let nrm = [0.0, 0.0, 1.0, 0.0, 0.0, 1.0];
        let mut ch = [0u8; 2];
        let n = dab(DRAW, &mut pos, &nrm, &[0.0, 1.0], &[1.0, 1.0], &par(1.0, 0.5, 1.0), &mut [], &mut ch);
        assert_eq!(n, 1);
        assert!((pos[2] - 0.06).abs() < 1e-6 && pos[5] == 0.0);
        assert_eq!(ch, [1, 0]);
    }
    #[test]
    fn layer_rises_no_higher_than_once() {
        let mut pos = vec![0.0f32; 3];
        let mut lh = [0.0f32];
        let mut ch = [0u8];
        for _ in 0..5 { dab(LAYER, &mut pos, &[0.0, 0.0, 1.0], &[0.0], &[1.0], &par(1.0, 1.0, 1.0), &mut lh, &mut ch); }
        assert!((pos[2] - 0.3).abs() < 1e-6, "{}", pos[2]);
    }
    #[test]
    fn clay_fills_only_below_its_plane() {
        // area centre at the origin, plane 0.18 r above: a point above it stays, one below rises
        let mut pos = vec![0.0f32, 0.0, 0.5, 0.0, 0.0, 0.0];
        let mut ch = [0u8; 2];
        dab(CLAY, &mut pos, &[0.0, 0.0, 1.0, 0.0, 0.0, 1.0], &[0.0, 0.0], &[1.0, 1.0], &par(1.0, 1.0, 1.0), &mut [], &mut ch);
        assert_eq!(ch, [0, 1]);
        assert!(pos[5] > 0.0 && pos[2] == 0.5);
    }
}

/// `Math.hypot` as V8 computes it (scaled, Kahan-summed squares), so the cloth gives the same numbers
/// as the page's JavaScript.
pub fn js_hypot(v: &[f64]) -> f64 {
    let mut max = 0.0f64;
    for &x in v { let a = x.abs(); if a.is_infinite() { return f64::INFINITY; } if a.is_nan() { return f64::NAN; } if a > max { max = a; } }
    if max == 0.0 { return 0.0; }
    let (mut sum, mut comp) = (0.0f64, 0.0f64);
    for &x in v {
        let n = x.abs() / max;
        let summand = n * n - comp;
        let pre = sum + summand;
        comp = (pre - sum) - summand;
        sum = pre;
    }
    sum.sqrt() * max
}

/// Smooth (and Shift): every point under the brush toward the average of its neighbours, by its
/// falloff. The points come as a patch: the `count` under the brush first, then their neighbours;
/// `nb_off` / `nb` list each brushed point's neighbours (patch indices, in the page's order, repeats
/// kept); `edge` marks the points on an open edge, which stay. New positions go to `out`.
#[allow(clippy::too_many_arguments)]
pub fn smooth(count: usize, pos: &[f32], nb_off: &[u32], nb: &[u32], edge: &[u8], mask: &[f32], fall: &[f32], s: f64, out: &mut [f32], changed: &mut [u8]) -> usize {
    // the averages first, rounded as the page's Float32Array keeps them
    let mut t = vec![0f32; count * 3];
    for k in 0..count {
        let (a, b) = (nb_off[k] as usize, nb_off[k + 1] as usize);
        if edge[k] != 0 || a == b { t[k * 3..k * 3 + 3].copy_from_slice(&pos[k * 3..k * 3 + 3]); continue; }
        let (mut x, mut y, mut z) = (0f64, 0f64, 0f64);
        for &u in &nb[a..b] { let u = u as usize * 3; x += pos[u] as f64; y += pos[u + 1] as f64; z += pos[u + 2] as f64; }
        let inv = 1.0 / (b - a) as f64;
        t[k * 3] = (x * inv) as f32; t[k * 3 + 1] = (y * inv) as f32; t[k * 3 + 2] = (z * inv) as f32;
    }
    let mut n = 0;
    for k in 0..count {
        changed[k] = 0;
        let w = fall[k] as f64 * s * (1.0 - mask[k] as f64);
        let o = k * 3;
        out[o..o + 3].copy_from_slice(&pos[o..o + 3]);
        if w <= 0.0 { continue; }
        changed[k] = 1; n += 1;
        for q in 0..3 { out[o + q] = (pos[o + q] as f64 + (t[o + q] as f64 - pos[o + q] as f64) * w) as f32; }
    }
    n
}

/// The ring of a brushed point: its neighbours in the page's order, each once (the page's list may
/// repeat them).
fn ring_of(k: usize, nb_off: &[u32], nb: &[u32], out: &mut Vec<usize>) {
    out.clear();
    for &u in &nb[nb_off[k] as usize..nb_off[k + 1] as usize] { let u = u as usize; if !out.contains(&u) { out.push(u); } }
}

/// Relax and Slide (as Blender's Relax and Topology Slide), as the page's relaxVerts. The patch: the
/// `count` brushed points first, then their neighbours; `pos` (ext·3) in and out. `nrm` (count·3) the
/// brushed points' normals; `rim` 1 for a point on an open edge; `pair` (count·2) its two neighbours along
/// the edge (patch indices, −1: none). `par`: c (3), s, sign, mode (0 relax, 1 along the stroke, 2 toward
/// the brush), the stroke's direction (3), whether there is one.
#[allow(clippy::too_many_arguments)]
pub fn relax(count: usize, pos: &mut [f32], nrm: &[f32], nb_off: &[u32], nb: &[u32], rim: &[u8], pair: &[i32], mask: &[f32], fall: &[f32], par: &[f64], changed: &mut [u8]) -> usize {
    let (cx, cy, cz, s, sign, mode) = (par[0], par[1], par[2], par[3], par[4], par[5] as u32);
    let (dirx, diry, dirz, has_dir) = (par[6], par[7], par[8], par[9] != 0.0);
    for c in changed.iter_mut() { *c = 0; }
    if mode == 1 && !has_dir { return 0; }
    let mut t = vec![0f32; count * 3];
    let mut ring = Vec::new();
    let p = |pos: &[f32], i: usize, q: usize| pos[i * 3 + q] as f64;
    let mut n = 0;
    for _ in 0..(if mode == 0 { 2 } else { 1 }) {
        for k in 0..count {
            let o = k * 3;
            t[o] = 0.0; t[o + 1] = 0.0; t[o + 2] = 0.0;
            if fall[k] as f64 * (1.0 - mask[k] as f64) <= 0.0 { continue; }
            ring_of(k, nb_off, nb, &mut ring);
            if ring.len() <= 2 { continue; }
            let (px, py, pz) = (p(pos, k, 0), p(pos, k, 1), p(pos, k, 2));
            let is_rim = rim[k] != 0;
            let (mut nx, mut ny, mut nz) = (nrm[o] as f64, nrm[o + 1] as f64, nrm[o + 2] as f64);
            if mode == 0 {
                let (mut ax, mut ay, mut az) = (0.0, 0.0, 0.0);
                if is_rim {
                    if pair[k * 2] < 0 || pair[k * 2 + 1] < 0 { continue; }
                    let (u, w) = (pair[k * 2] as usize, pair[k * 2 + 1] as usize);
                    ax = (p(pos, u, 0) + p(pos, w, 0)) * 0.5; ay = (p(pos, u, 1) + p(pos, w, 1)) * 0.5; az = (p(pos, u, 2) + p(pos, w, 2)) * 0.5;
                    let (e1x, e1y, e1z) = (p(pos, u, 0) - px, p(pos, u, 1) - py, p(pos, u, 2) - pz);
                    let l1 = { let h = js_hypot(&[e1x, e1y, e1z]); if h == 0.0 || h.is_nan() { 1.0 } else { h } };
                    let (e2x, e2y, e2z) = (p(pos, w, 0) - px, p(pos, w, 1) - py, p(pos, w, 2) - pz);
                    let l2 = { let h = js_hypot(&[e2x, e2y, e2z]); if h == 0.0 || h.is_nan() { 1.0 } else { h } };
                    nx = e1x / l1 + e2x / l2; ny = e1y / l1 + e2y / l2; nz = e1z / l1 + e2z / l2;
                } else {
                    for &u in &ring { ax += p(pos, u, 0); ay += p(pos, u, 1); az += p(pos, u, 2); }
                    let l = ring.len() as f64;
                    ax /= l; ay /= l; az /= l;
                }
                let nl = js_hypot(&[nx, ny, nz]);
                let (mut dx, mut dy, mut dz) = (ax - px, ay - py, az - pz);
                if nl > 1e-12 {
                    nx /= nl; ny /= nl; nz /= nl;
                    let d = dx * nx + dy * ny + dz * nz;
                    dx -= nx * d; dy -= ny * d; dz -= nz * d;
                } else if is_rim { dx = ax - px; dy = ay - py; dz = az - pz; }
                else { continue; }
                t[o] = dx as f32; t[o + 1] = dy as f32; t[o + 2] = dz as f32;
            } else {
                if is_rim { continue; }
                let (mut dx, mut dy, mut dz) = if mode == 1 { (dirx * sign, diry * sign, dirz * sign) } else { ((cx - px) * sign, (cy - py) * sign, (cz - pz) * sign) };
                let nl = js_hypot(&[nx, ny, nz]);
                if nl > 1e-12 {
                    nx /= nl; ny /= nl; nz /= nl;
                    let d = dx * nx + dy * ny + dz * nz;
                    dx -= nx * d; dy -= ny * d; dz -= nz * d;
                }
                let dl = js_hypot(&[dx, dy, dz]);
                if dl < 1e-12 { continue; }
                dx /= dl; dy /= dl; dz /= dl;
                let (mut tx, mut ty, mut tz) = (0.0, 0.0, 0.0);
                for &u in &ring {
                    let (ex, ey, ez) = (p(pos, u, 0) - px, p(pos, u, 1) - py, p(pos, u, 2) - pz);
                    let el = js_hypot(&[ex, ey, ez]);
                    if el < 1e-12 { continue; }
                    let along = ex * dx + ey * dy + ez * dz;
                    if along <= 0.0 { continue; }
                    tx += ex / el * along; ty += ey / el * along; tz += ez / el * along;
                }
                t[o] = tx as f32; t[o + 1] = ty as f32; t[o + 2] = tz as f32;
            }
        }
        let k0 = if mode == 0 { (s * 1.5).min(1.0) } else { s.min(1.0) * 0.5 };
        for k in 0..count {
            let o = k * 3;
            let w = (fall[k] as f64 * k0).min(1.0) * (1.0 - mask[k] as f64);
            let truthy = |v: f32| v != 0.0 && !v.is_nan();
            if w <= 0.0 || !(truthy(t[o]) || truthy(t[o + 1]) || truthy(t[o + 2])) { continue; }
            if changed[k] == 0 { changed[k] = 1; n += 1; }
            for q in 0..3 { pos[o + q] = (pos[o + q] as f64 + t[o + q] as f64 * w) as f32; }
        }
    }
    n
}

/// Enhance Details (as Blender's), as the page does it: each brushed point that has no direction yet gets
/// one, away from the middle of its neighbours as they were when the stroke began (`p0`, ext·3; points on an
/// open edge get none); then it goes that way by its falloff, at most `cap` in the whole stroke.
/// `pos` (count·3), `has` (count), `dirs` (count·3) and `used` (count) in and out.
#[allow(clippy::too_many_arguments)]
pub fn enhance(count: usize, pos: &mut [f32], p0: &[f32], nb_off: &[u32], nb: &[u32], rim: &[u8], has: &mut [u8], dirs: &mut [f32], used: &mut [f32], mask: &[f32], fall: &[f32], s: f64, changed: &mut [u8]) -> usize {
    for k in 0..count {
        if has[k] != 0 { continue; }
        has[k] = 1;
        if rim[k] != 0 { continue; }
        let (a, b) = (nb_off[k] as usize, nb_off[k + 1] as usize);
        if a == b { continue; }
        let (mut x, mut y, mut z) = (0.0f64, 0.0f64, 0.0f64);
        for &u in &nb[a..b] { let u = u as usize * 3; x += p0[u] as f64; y += p0[u + 1] as f64; z += p0[u + 2] as f64; }
        let c = (b - a) as f64;
        dirs[k * 3] = (p0[k * 3] as f64 - x / c) as f32; dirs[k * 3 + 1] = (p0[k * 3 + 1] as f64 - y / c) as f32; dirs[k * 3 + 2] = (p0[k * 3 + 2] as f64 - z / c) as f32;
    }
    let (cap, k0) = ((s * 2.0).min(1.0), s.min(1.0) * 0.5);
    let mut n = 0;
    for k in 0..count {
        changed[k] = 0;
        let mut w = fall[k] as f64 * (1.0 - mask[k] as f64) * k0;
        if w <= 0.0 { continue; }
        w = w.min(cap - used[k] as f64);
        if w <= 0.0 { continue; }
        used[k] = (used[k] as f64 + w) as f32;
        changed[k] = 1; n += 1;
        for q in 0..3 { pos[k * 3 + q] = (pos[k * 3 + q] as f64 + dirs[k * 3 + q] as f64 * w) as f32; }
    }
    n
}

/// Smear (as Blender's), as the page does it: each brushed point takes on the colour of its neighbours
/// behind it along the stroke (`par`: that direction in the brush's plane (3), the strength), as the colours
/// were before this dab (`col`, ext·3). New colours of the brushed points go to `out` (count·3).
#[allow(clippy::too_many_arguments)]
pub fn smear(count: usize, pos: &[f32], col: &[f32], nb_off: &[u32], nb: &[u32], mask: &[f32], fall: &[f32], par: &[f64], out: &mut [f32], changed: &mut [u8]) -> usize {
    let (tx, ty, tz, k0) = (par[0], par[1], par[2], par[3]);
    let mut n = 0;
    for k in 0..count {
        changed[k] = 0;
        let o = k * 3;
        out[o..o + 3].copy_from_slice(&col[o..o + 3]);
        let w = fall[k] as f64 * (1.0 - mask[k] as f64) * k0;
        if w <= 0.0 { continue; }
        let (mut r0, mut g0, mut b0, mut ws) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
        for &u in &nb[nb_off[k] as usize..nb_off[k + 1] as usize] {
            let u = u as usize;
            let (ex, ey, ez) = (pos[u * 3] as f64 - pos[o] as f64, pos[u * 3 + 1] as f64 - pos[o + 1] as f64, pos[u * 3 + 2] as f64 - pos[o + 2] as f64);
            let el = js_hypot(&[ex, ey, ez]);
            if el < 1e-12 { continue; }
            let back = -(ex * tx + ey * ty + ez * tz) / el;
            if back <= 0.0 { continue; }
            r0 += col[u * 3] as f64 * back; g0 += col[u * 3 + 1] as f64 * back; b0 += col[u * 3 + 2] as f64 * back; ws += back;
        }
        if ws <= 0.0 { continue; }
        changed[k] = 1; n += 1;
        for (q, v) in [r0, g0, b0].into_iter().enumerate() { let c = col[o + q] as f64; out[o + q] = (c + (v / ws - c) * w) as f32; }
    }
    n
}

pub const CLOTH_PINCH: u32 = 0;
pub const CLOTH_SLIDE: u32 = 1;
pub const CLOTH_INFLATE: u32 = 2;
pub const CLOTH_HOOK: u32 = 3;
pub const CLOTH_TWIST: u32 = 4;
/// (as Blender's Pinch Perpendicular) toward the stroke's line, the folds along it
pub const CLOTH_PERP: u32 = 5;
/// (as Blender's Expand) the cloth grows: its edges want to be longer, so it buckles into folds
pub const CLOTH_EXPAND: u32 = 6;

/// Across the stroke on the surface: the stroke's direction × the normal, of unit length (0 if they meet).
fn across(dx: f64, dy: f64, dz: f64, ax: f64, ay: f64, az: f64) -> (f64, f64, f64) {
    let (x, y, z) = (dy * az - dz * ay, dz * ax - dx * az, dx * ay - dy * ax);
    let l = js_hypot(&[x, y, z]);
    if l < 1e-12 { (0.0, 0.0, 0.0) } else { (x / l, y / l, z / l) }
}

/// The cloth brushes (ZBrush: ClothPinch, ClothSlide, ClothHook, ClothTwister, ClothInflate): the push,
/// then the edges get back their length from the start of the stroke (a squeezed edge folds along the
/// normals), then a light relax. The patch: `count` brushed points first, then their neighbours; `ids`
/// the mesh's own numbers (for the order of edges), `w` the weight of each brushed point (0: it does
/// not move), `orig` where every patch point was when the stroke began.
/// `par`: c (3), r, s, sign, the stroke's direction (3) and whether there is one, its start (3),
/// the hook's move since the last dab (3) and whether there is one.
#[allow(clippy::too_many_arguments)]
pub fn cloth(kind: u32, count: usize, ids: &[u32], pos: &mut [f32], nrm: &[f32], orig: &[f32], w: &[f64], nb_off: &[u32], nb: &[u32], par: &[f64]) {
    let local: Vec<usize> = (0..count).filter(|&k| w[k] > 0.0).collect();
    if local.is_empty() { return; }
    let (cx, cy, cz, r, s, sign) = (par[0], par[1], par[2], par[3], par[4], par[5]);
    let has_dir = par[9] != 0.0;
    let (dx, dy, dz) = (par[6], par[7], par[8]);
    let (sx, sy, sz) = (par[10], par[11], par[12]);
    let has_hook = par[16] != 0.0;
    let (hx, hy, hz) = (par[13], par[14], par[15]);
    let p = |pos: &[f32], k: usize, q: usize| pos[k * 3 + q] as f64;
    let set = |pos: &mut [f32], k: usize, q: usize, v: f64| { pos[k * 3 + q] = v as f32; };
    // 1. the push
    let (mut ax, mut ay, mut az) = (0.0, 0.0, 0.0);
    for &k in &local { ax += nrm[k * 3] as f64; ay += nrm[k * 3 + 1] as f64; az += nrm[k * 3 + 2] as f64; }
    let al = { let h = js_hypot(&[ax, ay, az]); if h == 0.0 || h.is_nan() { 1.0 } else { h } };
    ax /= al; ay /= al; az /= al;
    let (mut ux, mut uy, mut uz);
    {
        let t = if ax.abs() < 0.9 { [1.0, 0.0, 0.0] } else { [0.0, 1.0, 0.0] };
        let d = t[0] * ax + t[1] * ay + t[2] * az;
        ux = t[0] - ax * d; uy = t[1] - ay * d; uz = t[2] - az * d;
        let l = js_hypot(&[ux, uy, uz]); ux /= l; uy /= l; uz /= l;
    }
    let (vx, vy, vz) = (ay * uz - az * uy, az * ux - ax * uz, ax * uy - ay * ux);
    let lam = r * 0.42;
    let mut wv = vec![0.0f64; pos.len() / 3];
    let mut has_wv = vec![false; pos.len() / 3];
    for &k in &local {
        let (px, py, pz) = (p(pos, k, 0), p(pos, k, 1), p(pos, k, 2));
        wv[k] = if kind == CLOTH_PINCH || kind == CLOTH_TWIST || kind == CLOTH_EXPAND {
            let (ox, oy, oz) = (px - cx, py - cy, pz - cz);
            (6.0 * (ox * vx + oy * vy + oz * vz).atan2(ox * ux + oy * uy + oz * uz)).sin()
        } else if kind == CLOTH_PERP && has_dir {
            let (ex, ey, ez) = across(dx, dy, dz, ax, ay, az);
            ((2.0 * std::f64::consts::PI * ((px - cx) * ex + (py - cy) * ey + (pz - cz) * ez)) / lam).sin()
        } else if (kind == CLOTH_SLIDE || kind == CLOTH_HOOK) && has_dir {
            ((2.0 * std::f64::consts::PI * ((px - sx) * dx + (py - sy) * dy + (pz - sz) * dz)) / lam).sin()
        } else { 1.0 };
        has_wv[k] = true;
    }
    for &k in &local {
        let wk = w[k];
        let o = k * 3;
        match kind {
            CLOTH_PINCH => {
                let (mut qx, mut qy, mut qz) = (cx - p(pos, k, 0), cy - p(pos, k, 1), cz - p(pos, k, 2));
                let along = qx * ax + qy * ay + qz * az; qx -= ax * along; qy -= ay * along; qz -= az * along;
                let kk = 0.22 * s * wk; let h = r * 0.025 * s * wk * wv[k];
                for (q, qv) in [qx, qy, qz].into_iter().enumerate() { let v = p(pos, k, q) + (qv * kk + nrm[o + q] as f64 * h); set(pos, k, q, v); }
            }
            CLOTH_SLIDE => {
                if !has_dir { continue; }
                let kk = r * 0.08 * s * wk; let h = r * 0.025 * s * wk * wv[k];
                for (q, dv) in [dx, dy, dz].into_iter().enumerate() { let v = p(pos, k, q) + (dv * kk + nrm[o + q] as f64 * h); set(pos, k, q, v); }
            }
            CLOTH_PERP => {
                if !has_dir { continue; }
                let (ex, ey, ez) = across(dx, dy, dz, ax, ay, az);
                let t = (cx - p(pos, k, 0)) * ex + (cy - p(pos, k, 1)) * ey + (cz - p(pos, k, 2)) * ez;
                let kk = 0.22 * s * wk * t; let h = r * 0.025 * s * wk * wv[k];
                for (q, ev) in [ex, ey, ez].into_iter().enumerate() { let v = p(pos, k, q) + (ev * kk + nrm[o + q] as f64 * h); set(pos, k, q, v); }
            }
            CLOTH_EXPAND => {}
            CLOTH_HOOK => {
                if !has_hook { continue; }
                let kk = (s * 1.5).min(1.0) * wk;
                for (q, dv) in [hx, hy, hz].into_iter().enumerate() { let v = p(pos, k, q) + dv * kk; set(pos, k, q, v); }
            }
            CLOTH_TWIST => {
                let (ox, oy, oz) = (p(pos, k, 0) - cx, p(pos, k, 1) - cy, p(pos, k, 2) - cz);
                let ang = 0.12 * s * sign * wk;
                let (lu, lv) = (ox * ux + oy * uy + oz * uz, ox * vx + oy * vy + oz * vz);
                let (cs, sn) = (ang.cos() - 1.0, ang.sin());
                let (du, dv) = (lu * cs - lv * sn, lu * sn + lv * cs);
                for (q, (uq, vq)) in [(ux, vx), (uy, vy), (uz, vz)].into_iter().enumerate() { let v = p(pos, k, q) + (uq * du + vq * dv); set(pos, k, q, v); }
            }
            _ => {
                let kk = r * 0.06 * s * sign * wk;
                for q in 0..3 { let v = p(pos, k, q) + nrm[o + q] as f64 * kk; set(pos, k, q, v); }
            }
        }
    }
    // 2. the cloth: lengths from the start of the stroke; a squeezed edge lifts its ends along the normals
    let lift = 0.45;
    for _ in 0..6 {
        for &i in &local {
            let wi = w[i];
            let (a, b) = (nb_off[i] as usize, nb_off[i + 1] as usize);
            for &j in &nb[a..b] {
                let j = j as usize;
                let wj = if j < count { w[j] } else { 0.0 };
                if ids[j] < ids[i] && wj > 0.0 { continue; }
                let mut rest = js_hypot(&[orig[i * 3] as f64 - orig[j * 3] as f64, orig[i * 3 + 1] as f64 - orig[j * 3 + 1] as f64, orig[i * 3 + 2] as f64 - orig[j * 3 + 2] as f64]);
                if kind == CLOTH_EXPAND { rest *= 1.0 + 0.35 * s * (wi + wj) * 0.5; }
                let (ex, ey, ez) = (p(pos, j, 0) - p(pos, i, 0), p(pos, j, 1) - p(pos, i, 1), p(pos, j, 2) - p(pos, i, 2));
                let len = js_hypot(&[ex, ey, ez]);
                if len < 1e-12 { continue; }
                let ws = wi + wj;
                if ws <= 0.0 { continue; }
                let kk = (len - rest) / len / ws * 0.5;
                for (q, e) in [ex, ey, ez].into_iter().enumerate() {
                    let v = p(pos, i, q) + e * kk * wi; set(pos, i, q, v);
                    let v = p(pos, j, q) - e * kk * wj; set(pos, j, q, v);
                }
                if len < rest {
                    let u = (rest - len) * lift * sign;
                    let si = wv[i];
                    let sj = if has_wv[j] { wv[j] } else { si };
                    for q in 0..3 { let v = p(pos, i, q) + nrm[i * 3 + q] as f64 * u * wi * si; set(pos, i, q, v); }
                    if wj != 0.0 { for q in 0..3 { let v = p(pos, j, q) + nrm[j * 3 + q] as f64 * u * wj * sj; set(pos, j, q, v); } }
                }
            }
        }
    }
    // 3. a light relax against the spikes a hard push leaves
    let mut t: Vec<(usize, [f64; 4])> = Vec::with_capacity(local.len());
    for &i in &local {
        let (a, b) = (nb_off[i] as usize, nb_off[i + 1] as usize);
        if a == b { continue; }
        let (mut x, mut y, mut z) = (0.0, 0.0, 0.0);
        for &j in &nb[a..b] { let j = j as usize; x += p(pos, j, 0); y += p(pos, j, 1); z += p(pos, j, 2); }
        let k = (b - a) as f64;
        t.push((i, [x / k, y / k, z / k, w[i] * 0.2]));
    }
    for (i, [x, y, z, ww]) in t {
        for (q, c) in [x, y, z].into_iter().enumerate() { let v = p(pos, i, q) + (c - p(pos, i, q)) * ww; set(pos, i, q, v); }
    }
}
