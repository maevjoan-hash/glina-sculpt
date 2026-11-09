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
