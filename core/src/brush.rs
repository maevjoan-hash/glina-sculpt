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
            let d = r * 0.08 * s * sign;
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
                let w = fall[k] as f64 * (1.0 - mask[k] as f64);
                if w <= 0.0 { continue; }
                let o = k * 3;
                let d = (pos[o] as f64 - qx) * ax + (pos[o + 1] as f64 - qy) * ay + (pos[o + 2] as f64 - qz) * az;
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
                add(&mut pos[o], ax * step); add(&mut pos[o + 1], ay * step); add(&mut pos[o + 2], az * step);
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

pub const CLOTH_PINCH: u32 = 0;
pub const CLOTH_SLIDE: u32 = 1;
pub const CLOTH_INFLATE: u32 = 2;
pub const CLOTH_HOOK: u32 = 3;
pub const CLOTH_TWIST: u32 = 4;

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
        wv[k] = if kind == CLOTH_PINCH || kind == CLOTH_TWIST {
            let (ox, oy, oz) = (px - cx, py - cy, pz - cz);
            (6.0 * (ox * vx + oy * vy + oz * vz).atan2(ox * ux + oy * uy + oz * uz)).sin()
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
                let rest = js_hypot(&[orig[i * 3] as f64 - orig[j * 3] as f64, orig[i * 3 + 1] as f64 - orig[j * 3 + 1] as f64, orig[i * 3 + 2] as f64 - orig[j * 3 + 2] as f64]);
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
