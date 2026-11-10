//! Elastic brushes from regularized Kelvinlets (de Goes & James 2017, 2019): twist, scale and pinch.
//!
//! Each is the response of an infinite elastic solid to a smoothed load at the brush centre: a twisting
//! couple, a swelling and a stretch-and-squeeze. Two of them at scales ε and 1.1ε are subtracted
//! (bi-scale), which fades as 1/r⁵ and so stays local; the result is normalised so that the clay right
//! at the centre turns, grows or stretches by exactly the amount asked. Twist turns by a true rotation
//! (not its linear part), so even a large angle keeps the volume.
//!
//! Every vertex starts from its position at the start of the stroke, so the result depends only on the
//! total drag. With symmetry the copies' displacements add up.

pub const TWIST: u32 = 0;
pub const SCALE: u32 = 1;
pub const PINCH: u32 = 2;

/// One copy of the brush: centre, normal, stroke tangent (3 each), ε, Poisson ratio, amount (an angle in
/// radians for twist, a relative growth for scale, a relative stretch for pinch), reach.
pub const PAR: usize = 13;

#[inline]
fn fade(d: f64, reach: f64) -> f64 {
    let a = reach * 0.72;
    if d <= a { return 1.0; }
    if d >= reach { return 0.0; }
    let t = (d - a) / (reach - a);
    1.0 - t * t * (3.0 - 2.0 * t)
}

/// `orig`: 3 per vertex, where each was when the stroke began; `free`: 1 − mask; `out`: 3 per vertex,
/// the new positions. `copies` holds PAR values for the brush and for each symmetric copy of it.
pub fn apply(kind: u32, orig: &[f32], free: &[f32], copies: &[f64], out: &mut [f32]) {
    let n = free.len();
    let mut acc = vec![0f64; n * 3];
    for p in copies.chunks_exact(PAR) {
        let (c, nrm, t) = ([p[0], p[1], p[2]], [p[3], p[4], p[5]], [p[6], p[7], p[8]]);
        let (e1, nu, amount, reach) = (p[9].max(1e-9), p[10].clamp(0.0, 0.49), p[11], p[12]);
        let e2 = e1 * 1.1;
        let (e1s, e2s) = (e1 * e1, e2 * e2);
        // the radial profile shared by twist and scale: 1/rε³ + 3ε²/(2 rε⁵)
        let prof = |r2: f64, es: f64| { let q = (r2 + es).sqrt(); let q3 = q * q * q; 1.0 / q3 + 1.5 * es / (q3 * q * q) };
        let prof0 = prof(0.0, e1s) - prof(0.0, e2s);
        // pinch: u = c1·H r + c2·(rᵀH r)·r with c1 = (2b − a)/rε³ − 3aε²/(2 rε⁵), c2 = 3b/rε⁵
        let a = 1.0 / (4.0 * std::f64::consts::PI);
        let b = a / (4.0 * (1.0 - nu));
        let c1 = |r2: f64, es: f64| { let q = (r2 + es).sqrt(); let q3 = q * q * q; (2.0 * b - a) / q3 - 1.5 * a * es / (q3 * q * q) };
        let c2 = |r2: f64, es: f64| { let q = (r2 + es).sqrt(); 3.0 * b / (q * q * q * q * q) };
        let c10 = c1(0.0, e1s) - c1(0.0, e2s);
        // the direction squeezed: across the stroke, in the surface
        let m = [nrm[1] * t[2] - nrm[2] * t[1], nrm[2] * t[0] - nrm[0] * t[2], nrm[0] * t[1] - nrm[1] * t[0]];
        for v in 0..n {
            let fr = free[v] as f64;
            if fr <= 0.0 { continue; }
            let o = v * 3;
            let r = [orig[o] as f64 - c[0], orig[o + 1] as f64 - c[1], orig[o + 2] as f64 - c[2]];
            let r2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
            let d = r2.sqrt();
            if d >= reach { continue; }
            let w = fade(d, reach) * fr;
            let u = match kind {
                TWIST => {
                    // a true rotation about the normal through the centre, by an angle that falls with distance
                    let ang = amount * w * (prof(r2, e1s) - prof(r2, e2s)) / prof0;
                    let (s, co) = ang.sin_cos();
                    let dot = nrm[0] * r[0] + nrm[1] * r[1] + nrm[2] * r[2];
                    let cr = [nrm[1] * r[2] - nrm[2] * r[1], nrm[2] * r[0] - nrm[0] * r[2], nrm[0] * r[1] - nrm[1] * r[0]];
                    [
                        r[0] * co + cr[0] * s + nrm[0] * dot * (1.0 - co) - r[0],
                        r[1] * co + cr[1] * s + nrm[1] * dot * (1.0 - co) - r[1],
                        r[2] * co + cr[2] * s + nrm[2] * dot * (1.0 - co) - r[2],
                    ]
                }
                SCALE => {
                    // (one scale, not two: a swelling is meant to be broad)
                    let k = ((amount * w * prof(r2, e1s) / prof(0.0, e1s)).exp() - 1.0).max(-0.95);
                    [r[0] * k, r[1] * k, r[2] * k]
                }
                _ => {
                    let g = amount * w / c10;
                    let (rt, rm) = (r[0] * t[0] + r[1] * t[1] + r[2] * t[2], r[0] * m[0] + r[1] * m[1] + r[2] * m[2]);
                    let hr = [t[0] * rt - m[0] * rm, t[1] * rt - m[1] * rm, t[2] * rt - m[2] * rm];
                    let rhr = rt * rt - rm * rm;
                    let (k1, k2) = (g * (c1(r2, e1s) - c1(r2, e2s)), g * (c2(r2, e1s) - c2(r2, e2s)) * rhr);
                    [hr[0] * k1 + r[0] * k2, hr[1] * k1 + r[1] * k2, hr[2] * k1 + r[2] * k2]
                }
            };
            acc[o] += u[0]; acc[o + 1] += u[1]; acc[o + 2] += u[2];
        }
    }
    for k in 0..n * 3 { out[k] = (orig[k] as f64 + acc[k]) as f32; }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn cloud() -> Vec<f32> {
        let mut p = Vec::new();
        for i in -6..=6 { for j in -6..=6 { for k in -2..=2 { p.extend_from_slice(&[i as f32 * 0.05, j as f32 * 0.05, k as f32 * 0.05]); } } }
        p
    }
    fn par(amount: f64) -> [f64; PAR] { [0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.1, 0.4, amount, 0.35] }
    #[test]
    fn twist_turns_the_middle_and_keeps_distances_from_the_axis() {
        let o = cloud(); let free = vec![1f32; o.len() / 3]; let mut out = vec![0f32; o.len()];
        apply(TWIST, &o, &free, &par(0.5), &mut out);
        for v in 0..free.len() {
            let (x0, y0, x1, y1) = (o[v * 3] as f64, o[v * 3 + 1] as f64, out[v * 3] as f64, out[v * 3 + 1] as f64);
            // a rotation about z: the distance from the axis and the height stay
            assert!(((x0 * x0 + y0 * y0).sqrt() - (x1 * x1 + y1 * y1).sqrt()).abs() < 1e-5);
            assert!((o[v * 3 + 2] - out[v * 3 + 2]).abs() < 1e-6);
        }
        // a point close to the centre turns by nearly the whole angle, a far one not at all
        let near = (0..free.len()).find(|&v| o[v * 3] == 0.05 && o[v * 3 + 1] == 0.0 && o[v * 3 + 2] == 0.0).unwrap();
        let ang = (out[near * 3 + 1] as f64).atan2(out[near * 3] as f64);
        assert!(ang > 0.2 && ang <= 0.5, "{ang}");
        let far = (0..free.len()).find(|&v| o[v * 3] >= 0.3).unwrap();
        // outside the reach nothing moves at all
        assert!((0..free.len()).filter(|&v| { let (x, y, z) = (o[v * 3] as f64, o[v * 3 + 1] as f64, o[v * 3 + 2] as f64); (x * x + y * y + z * z).sqrt() >= 0.35 }).all(|v| out[v * 3] == o[v * 3] && out[v * 3 + 1] == o[v * 3 + 1]));
        let _ = far;
    }
    #[test]
    fn scale_grows_outward_and_mask_holds() {
        let o = cloud(); let mut free = vec![1f32; o.len() / 3]; free[0] = 0.0;
        let mut out = vec![0f32; o.len()];
        apply(SCALE, &o, &free, &par(0.4), &mut out);
        assert!(out[0] == o[0] && out[1] == o[1]);
        for v in 0..free.len() {
            let d0 = (0..3).map(|k| (o[v * 3 + k] as f64).powi(2)).sum::<f64>().sqrt();
            let d1 = (0..3).map(|k| (out[v * 3 + k] as f64).powi(2)).sum::<f64>().sqrt();
            assert!(d1 >= d0 - 1e-7);
        }
    }
    #[test]
    fn pinch_stretches_along_and_squeezes_across() {
        let o = cloud(); let free = vec![1f32; o.len() / 3]; let mut out = vec![0f32; o.len()];
        apply(PINCH, &o, &free, &par(0.3), &mut out);
        let at = |x: f32, y: f32| (0..free.len()).find(|&v| o[v * 3] == x && o[v * 3 + 1] == y && o[v * 3 + 2] == 0.0).unwrap();
        let (a, b) = (at(0.05, 0.0), at(0.0, 0.05));
        assert!(out[a * 3] > o[a * 3], "along the stroke it stretches");
        assert!(out[b * 3 + 1].abs() < o[b * 3 + 1].abs(), "across it squeezes");
    }
}
