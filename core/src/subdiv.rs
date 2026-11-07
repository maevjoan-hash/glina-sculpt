//! Loop subdivision, the same numbering as the page's own (JavaScript) version, so the two can be
//! mixed between the levels of one model: the old vertices first, then one new vertex per edge, the
//! edges numbered by their lower end and, inside it, by the other end in index order.
//!
//! `crease` (with groups): an edge where the surface bends by more than ~25° and whose four corners
//! are not all of one group stays sharp (Loop's boundary rule); a vertex on three or more of them stays.

pub struct Sub {
    pub pos: Vec<f32>,
    pub idx: Vec<u32>,
    pub col: Vec<f32>,
    pub mask: Vec<f32>,
    pub grp: Vec<f32>,
}

#[allow(clippy::too_many_arguments)]
pub fn subdivide(pos: &[f32], idx: &[u32], col: Option<&[f32]>, mask: Option<&[f32]>, grp: Option<&[f32]>, smooth: bool, crease: bool) -> Sub {
    let n = pos.len() / 3;
    let f = idx.len() / 3;
    // neighbours of every vertex, sorted and each once; faces per vertex for the boundary test
    let mut deg = vec![0u32; n + 1];
    let mut fcount = vec![0u32; n];
    for t in 0..f {
        for k in 0..3 {
            let a = idx[t * 3 + k] as usize;
            fcount[a] += 1;
            deg[a + 1] += 2;
        }
    }
    for i in 0..n { deg[i + 1] += deg[i]; }
    let mut raw = vec![0u32; deg[n] as usize];
    let mut fill: Vec<u32> = deg[..n].to_vec();
    for t in 0..f {
        for k in 0..3 {
            let a = idx[t * 3 + k] as usize;
            let b = idx[t * 3 + (k + 1) % 3];
            let c = idx[t * 3 + (k + 2) % 3];
            raw[fill[a] as usize] = b; fill[a] += 1;
            raw[fill[a] as usize] = c; fill[a] += 1;
        }
    }
    let mut vv_off = vec![0u32; n + 1];
    let mut vv: Vec<u32> = Vec::with_capacity(raw.len() / 2 + 8);
    for a in 0..n {
        let s = &mut raw[deg[a] as usize..deg[a + 1] as usize];
        s.sort_unstable();
        let mut last = u32::MAX;
        for &u in s.iter() { if u != last && u as usize != a { vv.push(u); last = u; } }
        vv_off[a + 1] = vv.len() as u32;
    }
    let boundary: Vec<bool> = (0..n).map(|v| { let nf = fcount[v]; let nv = vv_off[v + 1] - vv_off[v]; nf == 0 || nv != nf }).collect();
    // edge numbers: for a < b in a's list
    let mut edge_id = vec![u32::MAX; vv.len()];
    let mut ne = 0u32;
    for a in 0..n {
        for j in vv_off[a] as usize..vv_off[a + 1] as usize { if vv[j] as usize > a { edge_id[j] = ne; ne += 1; } }
    }
    let ne = ne as usize;
    let find_edge = |a: u32, b: u32| -> usize {
        let (a, b) = if a > b { (b, a) } else { (a, b) };
        let s = &vv[vv_off[a as usize] as usize..vv_off[a as usize + 1] as usize];
        match s.binary_search(&b) { Ok(j) => edge_id[vv_off[a as usize] as usize + j] as usize, Err(_) => usize::MAX }
    };
    let nn = n + ne;
    let mut p = vec![0f32; nn * 3];
    let mut c = vec![0f32; nn * 3];
    let mut m = vec![0f32; nn];
    let mut g = vec![0f32; nn];
    let one = |i: usize, k: usize| col.map_or(1.0, |cc| cc[i * 3 + k]);
    let mk = |i: usize| mask.map_or(0.0, |mm| mm[i]);
    let mut opp = vec![0f64; ne * 3];
    let mut opp_n = vec![0u8; ne];
    let mut opp_v = vec![0u32; ne * 2];
    let mut ea = vec![0u32; ne];
    let mut eb = vec![0u32; ne];
    let want = crease && smooth && grp.is_some();
    let mut en = if want { vec![0f64; ne * 6] } else { Vec::new() };
    let mut fe = vec![0u32; f * 3];
    let at = |i: u32, k: usize| pos[i as usize * 3 + k] as f64;
    for t in 0..f {
        let (mut nx, mut ny, mut nz) = (0.0, 0.0, 0.0);
        if want {
            let (a, b, cc) = (idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
            let (ux, uy, uz) = (at(b, 0) - at(a, 0), at(b, 1) - at(a, 1), at(b, 2) - at(a, 2));
            let (vx, vy, vz) = (at(cc, 0) - at(a, 0), at(cc, 1) - at(a, 1), at(cc, 2) - at(a, 2));
            nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
            let l = (nx * nx + ny * ny + nz * nz).sqrt();
            let l = if l > 0.0 { l } else { 1.0 };
            nx /= l; ny /= l; nz /= l;
        }
        for k in 0..3 {
            let a = idx[t * 3 + k];
            let b = idx[t * 3 + (k + 1) % 3];
            let cc = idx[t * 3 + (k + 2) % 3];
            let e = find_edge(a, b);
            fe[t * 3 + k] = e as u32;
            ea[e] = a; eb[e] = b;
            for q in 0..3 { opp[e * 3 + q] += at(cc, q); }
            if opp_n[e] < 2 {
                opp_v[e * 2 + opp_n[e] as usize] = cc;
                if want { let o = e * 6 + opp_n[e] as usize * 3; en[o] = nx; en[o + 1] = ny; en[o + 2] = nz; }
            }
            opp_n[e] = opp_n[e].saturating_add(1);
        }
    }
    let mut sharp = vec![false; if want { ne } else { 0 }];
    let mut cc_n = vec![0u8; if want { n } else { 0 }];
    let mut cs = vec![0f64; if want { n * 3 } else { 0 }];
    if let (true, Some(gr)) = (want, grp) {
        for e in 0..ne {
            let (a, b, x, y) = (ea[e] as usize, eb[e] as usize, opp_v[e * 2] as usize, opp_v[e * 2 + 1] as usize);
            let o = e * 6;
            if opp_n[e] != 2 || en[o] * en[o + 3] + en[o + 1] * en[o + 4] + en[o + 2] * en[o + 5] > 0.906 { continue; }
            if gr[a] == gr[b] && gr[a] == gr[x] && gr[a] == gr[y] { continue; }
            sharp[e] = true;
            for (v, u) in [(a, b), (b, a)] {
                cc_n[v] = cc_n[v].saturating_add(1);
                for q in 0..3 { cs[v * 3 + q] += pos[u * 3 + q] as f64; }
            }
        }
    }
    for e in 0..ne {
        let (a, b) = (ea[e] as usize, eb[e] as usize);
        let o = (n + e) * 3;
        let sh = want && sharp[e];
        for k in 0..3 {
            let mid = (pos[a * 3 + k] as f64 + pos[b * 3 + k] as f64) * 0.5;
            p[o + k] = if smooth && opp_n[e] == 2 && !sh { (0.75 * mid + 0.125 * opp[e * 3 + k]) as f32 } else { mid as f32 };
            c[o + k] = ((one(a, k) as f64 + one(b, k) as f64) * 0.5) as f32;
        }
        m[n + e] = ((mk(a) as f64 + mk(b) as f64) * 0.5) as f32;
        if let Some(gr) = grp { g[n + e] = if gr[a] == gr[b] { gr[a] } else { gr[a].min(gr[b]) }; }
    }
    for v in 0..n {
        let val = (vv_off[v + 1] - vv_off[v]) as usize;
        let corner = want && cc_n[v] > 2;
        if !smooth || boundary[v] || val < 3 || corner {
            for k in 0..3 { p[v * 3 + k] = pos[v * 3 + k]; }
        } else if want && cc_n[v] == 2 {
            for k in 0..3 { p[v * 3 + k] = (0.75 * pos[v * 3 + k] as f64 + 0.125 * cs[v * 3 + k]) as f32; }
        } else {
            let beta = if val == 3 { 3.0 / 16.0 } else { 3.0 / (8.0 * val as f64) };
            let (mut x, mut y, mut z) = (0f64, 0f64, 0f64);
            for &u in &vv[vv_off[v] as usize..vv_off[v + 1] as usize] { x += pos[u as usize * 3] as f64; y += pos[u as usize * 3 + 1] as f64; z += pos[u as usize * 3 + 2] as f64; }
            let w = 1.0 - val as f64 * beta;
            p[v * 3] = (w * pos[v * 3] as f64 + beta * x) as f32;
            p[v * 3 + 1] = (w * pos[v * 3 + 1] as f64 + beta * y) as f32;
            p[v * 3 + 2] = (w * pos[v * 3 + 2] as f64 + beta * z) as f32;
        }
        for k in 0..3 { c[v * 3 + k] = one(v, k); }
        m[v] = mk(v);
        if let Some(gr) = grp { g[v] = gr[v]; }
    }
    let mut out = Vec::with_capacity(f * 12);
    for t in 0..f {
        let (a, b, cc) = (idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
        let ab = n as u32 + fe[t * 3];
        let bc = n as u32 + fe[t * 3 + 1];
        let ca = n as u32 + fe[t * 3 + 2];
        out.extend_from_slice(&[a, ab, ca, ab, b, bc, ca, bc, cc, ab, bc, ca]);
    }
    Sub { pos: p, idx: out, col: c, mask: m, grp: g }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tetra_four_times_and_closed() {
        let pos = [1.0f32, 1.0, 1.0, -1.0, -1.0, 1.0, -1.0, 1.0, -1.0, 1.0, -1.0, -1.0];
        let idx = [0u32, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2];
        let s = subdivide(&pos, &idx, None, None, None, true, false);
        assert_eq!(s.idx.len(), idx.len() * 4);
        assert_eq!(s.pos.len() / 3, 4 + 6);
        // every edge of the result in exactly two triangles
        let mut cnt = std::collections::HashMap::new();
        for t in s.idx.chunks(3) { for k in 0..3 { let (a, b) = (t[k], t[(k + 1) % 3]); *cnt.entry((a.min(b), a.max(b))).or_insert(0) += 1; } }
        assert!(cnt.values().all(|&c| c == 2));
        // smoothing pulls the corners in
        assert!(s.pos[0] < 1.0);
    }
}
