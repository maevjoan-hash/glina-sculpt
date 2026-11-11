//! Dynamic topology (Sculptris, Blender's Dyntopo) on the patch of mesh under one dab: edges longer than
//! L are split (longest first, the midpoint leaning toward both tangent planes so curved surfaces stay
//! round), edges shorter than 0.4·L collapsed (shortest first, only where the surface stays a manifold
//! and no face turns over). The same rules as the page's JavaScript, which stays as the fallback.
//!
//! The patch: every face around the vertices under the brush, and all their corners. A corner that also
//! has faces outside the patch is `locked`: it never collapses (its ring is not all here), and an edge
//! with a face outside (`frozen`) is never split. New vertices are added after the patch's own; a
//! collapsed vertex is marked removed; faces are kept in place and marked dead when they go.

pub struct Patch {
    pub pos: Vec<f32>,
    pub nrm: Vec<f32>,
    pub col: Vec<f32>,
    pub mask: Vec<f32>,
    pub grp: Vec<f32>,
    pub hid: Vec<f32>,
    pub faces: Vec<[u32; 3]>,
    pub alive: Vec<bool>,
    vf: Vec<Vec<u32>>,
    locked: Vec<bool>,
    extra: Vec<u32>,
    frozen: std::collections::HashSet<(u32, u32)>,
    pub removed: Vec<bool>,
    pub dirty: Vec<u32>,
    face_room: i64,
    pub hit_cap: bool,
    pub splits: usize,
    pub collapses: usize,
    live: i64,
}

pub struct Params {
    pub c: [f64; 3],
    pub r2: f64,
    pub max2: f64,
    pub min2: f64,
    pub split_budget: usize,
    pub collapse_budget: usize,
    pub do_split: bool,
    pub do_collapse: bool,
    pub all: bool,
    pub cur_group: f32,
    pub tick: usize,
}

#[inline]
fn d2(p: &[f32], a: usize, b: usize) -> f64 {
    let (dx, dy, dz) = (p[a * 3] as f64 - p[b * 3] as f64, p[a * 3 + 1] as f64 - p[b * 3 + 1] as f64, p[a * 3 + 2] as f64 - p[b * 3 + 2] as f64);
    dx * dx + dy * dy + dz * dz
}
fn ekey(a: u32, b: u32) -> (u32, u32) { (a.min(b), a.max(b)) }

impl Patch {
    #[allow(clippy::too_many_arguments)]
    pub fn new(pos: &[f32], nrm: &[f32], col: &[f32], mask: &[f32], grp: &[f32], hid: &[f32], faces: &[u32], locked: &[u8], extra: &[u32], frozen: &[u32], face_room: i64) -> Patch {
        let n = pos.len() / 3;
        let faces: Vec<[u32; 3]> = faces.chunks(3).map(|c| [c[0], c[1], c[2]]).collect();
        let mut vf = vec![Vec::new(); n];
        for (t, f) in faces.iter().enumerate() { for &v in f { vf[v as usize].push(t as u32); } }
        let alive = vec![true; faces.len()];
        let live = faces.len() as i64;
        Patch {
            pos: pos.to_vec(), nrm: nrm.to_vec(), col: col.to_vec(), mask: mask.to_vec(), grp: grp.to_vec(), hid: hid.to_vec(),
            faces, alive, vf, locked: locked.iter().map(|&x| x != 0).collect(), extra: extra.to_vec(),
            frozen: frozen.chunks(2).map(|c| ekey(c[0], c[1])).collect(), removed: vec![false; n], dirty: Vec::new(), face_room, hit_cap: false, splits: 0, collapses: 0, live,
        }
    }
    fn nv(&self) -> usize { self.pos.len() / 3 }
    fn deg(&self, v: usize) -> usize { self.vf[v].len() + self.extra[v] as usize }
    fn third(&self, t: usize, a: u32, b: u32) -> i64 { for &v in &self.faces[t] { if v != a && v != b { return v as i64; } } -1 }
    fn shared(&self, a: usize, b: usize) -> Vec<u32> { self.vf[a].iter().copied().filter(|t| self.vf[b].contains(t)).collect() }
    fn ring(&self, v: usize) -> Vec<u32> {
        let mut out = Vec::new();
        for &t in &self.vf[v] { for &u in &self.faces[t as usize] { if u as usize != v && !out.contains(&u) { out.push(u); } } }
        out
    }
    fn is_boundary(&self, v: usize) -> bool {
        let l = &self.vf[v];
        if l.len() < 3 { return true; }
        let mut nx = Vec::with_capacity(l.len());
        let mut pv = Vec::with_capacity(l.len());
        for &t in l {
            let f = self.faces[t as usize];
            let k = if f[0] as usize == v { 0 } else if f[1] as usize == v { 1 } else { 2 };
            nx.push(f[(k + 1) % 3]); pv.push(f[(k + 2) % 3]);
        }
        nx.iter().any(|x| !pv.contains(x))
    }
    fn has_half_edge(&self, from: usize, to: u32) -> bool {
        self.vf[from].iter().any(|&t| { let f = self.faces[t as usize]; let k = if f[0] as usize == from { 0 } else if f[1] as usize == from { 1 } else { 2 }; f[(k + 1) % 3] == to })
    }
    fn new_vertex(&mut self) -> usize {
        let v = self.nv();
        self.pos.extend_from_slice(&[0.0; 3]); self.nrm.extend_from_slice(&[0.0; 3]); self.col.extend_from_slice(&[1.0; 3]);
        self.mask.push(0.0); self.grp.push(0.0); self.hid.push(0.0);
        self.vf.push(Vec::new()); self.locked.push(false); self.extra.push(0); self.removed.push(false);
        v
    }
    fn new_face(&mut self, f: [u32; 3]) -> u32 { self.faces.push(f); self.alive.push(true); self.live += 1; (self.faces.len() - 1) as u32 }
    fn face_count(&self) -> i64 { self.live }

    /// Split every face on edge a–b (non-manifold edges refine like the rest). The new vertex, or None.
    pub fn split_edge(&mut self, a: usize, b: usize) -> Option<usize> {
        if self.frozen.contains(&ekey(a as u32, b as u32)) { return None; }
        let faces = self.shared(a, b);
        if faces.is_empty() { return None; }
        let m = self.new_vertex();
        let (a3, b3, m3) = (a * 3, b * 3, m * 3);
        let p = |i: usize| self.pos[i] as f64;
        let nn = |i: usize| self.nrm[i] as f64;
        let (mut x, mut y, mut z) = ((p(a3) + p(b3)) * 0.5, (p(a3 + 1) + p(b3 + 1)) * 0.5, (p(a3 + 2) + p(b3 + 2)) * 0.5);
        if nn(a3) * nn(b3) + nn(a3 + 1) * nn(b3 + 1) + nn(a3 + 2) * nn(b3 + 2) > 0.3 {
            let da = (x - p(a3)) * nn(a3) + (y - p(a3 + 1)) * nn(a3 + 1) + (z - p(a3 + 2)) * nn(a3 + 2);
            let db = (x - p(b3)) * nn(b3) + (y - p(b3 + 1)) * nn(b3 + 1) + (z - p(b3 + 2)) * nn(b3 + 2);
            x -= 0.25 * (da * nn(a3) + db * nn(b3)); y -= 0.25 * (da * nn(a3 + 1) + db * nn(b3 + 1)); z -= 0.25 * (da * nn(a3 + 2) + db * nn(b3 + 2));
        }
        let (nx, ny, nz) = (nn(a3) + nn(b3), nn(a3 + 1) + nn(b3 + 1), nn(a3 + 2) + nn(b3 + 2));
        let nl = { let l = (nx * nx + ny * ny + nz * nz).sqrt(); if l > 0.0 { l } else { 1.0 } };
        let cols: Vec<f32> = (0..3).map(|k| ((self.col[a3 + k] as f64 + self.col[b3 + k] as f64) * 0.5) as f32).collect();
        self.pos[m3] = x as f32; self.pos[m3 + 1] = y as f32; self.pos[m3 + 2] = z as f32;
        self.nrm[m3] = (nx / nl) as f32; self.nrm[m3 + 1] = (ny / nl) as f32; self.nrm[m3 + 2] = (nz / nl) as f32;
        self.col[m3..m3 + 3].copy_from_slice(&cols);
        self.mask[m] = ((self.mask[a] as f64 + self.mask[b] as f64) * 0.5) as f32;
        self.grp[m] = self.grp[a];
        self.hid[m] = self.hid[a].max(self.hid[b]);
        self.dirty.push(m as u32);
        for t in faces {
            let t = t as usize;
            let f = self.faces[t];
            let mut k = 3;
            for kk in 0..3 { let (pp, qq) = (f[kk] as usize, f[(kk + 1) % 3] as usize); if (pp == a && qq == b) || (pp == b && qq == a) { k = kk; break; } }
            if k == 3 { continue; }
            let (pp, qq, rr) = (f[k], f[(k + 1) % 3], f[(k + 2) % 3]);
            self.faces[t][(k + 1) % 3] = m as u32;             // (p, q, r) -> (p, m, r) + (m, q, r), winding kept
            let tn = self.new_face([m as u32, qq, rr]);
            if let Some(i) = self.vf[qq as usize].iter().position(|&x| x == t as u32) { self.vf[qq as usize][i] = tn; }
            self.vf[m].push(t as u32); self.vf[m].push(tn);
            self.vf[rr as usize].push(tn);
            self.dirty.extend_from_slice(&[pp, qq, rr]);
        }
        Some(m)
    }

    fn keeps_orientation(&self, t: usize, a: u32, b: u32, px: f64, py: f64, pz: f64) -> bool {
        let f = self.faces[t];
        let mut n0 = [0.0f64; 3];
        for pass in 0..2 {
            let mut q = [[0.0f64; 3]; 3];
            for k in 0..3 {
                let v = f[k];
                if pass == 1 && (v == a || v == b) { q[k] = [px, py, pz]; } else { let o = v as usize * 3; q[k] = [self.pos[o] as f64, self.pos[o + 1] as f64, self.pos[o + 2] as f64]; }
            }
            let e1 = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]];
            let e2 = [q[2][0] - q[0][0], q[2][1] - q[0][1], q[2][2] - q[0][2]];
            let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
            if pass == 0 { n0 = n; continue; }
            let l0 = (n0[0] * n0[0] + n0[1] * n0[1] + n0[2] * n0[2]).sqrt();
            let l1 = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
            if l0 < 1e-20 { return true; }
            if l1 < 1e-20 { return false; }
            return n0[0] * n[0] + n0[1] * n[1] + n0[2] * n[2] > 0.2 * l0 * l1;
        }
        true
    }

    /// Collapse edge a–b into its midpoint, keeping a. False when it would break the surface.
    pub fn collapse_edge(&mut self, a: usize, b: usize, max2: f64) -> bool {
        if self.locked[a] || self.locked[b] { return false; }
        let sf = self.shared(a, b);
        if sf.len() != 2 { return false; }
        let (t1, t2) = (sf[0] as usize, sf[1] as usize);
        let c = self.third(t1, a as u32, b as u32);
        let d = self.third(t2, a as u32, b as u32);
        if c < 0 || d < 0 || c == d || self.deg(c as usize) <= 3 || self.deg(d as usize) <= 3 { return false; }
        if self.vf[a].len() + self.vf[b].len() < 7 { return false; }
        if self.is_boundary(a) || self.is_boundary(b) { return false; }
        let ra = self.ring(a);
        let rb = self.ring(b);
        let mut common = 0;
        for &x in &ra { if rb.contains(&x) { if x as i64 != c && x as i64 != d { return false; } common += 1; } }
        if common != 2 { return false; }
        let (a3, b3) = (a * 3, b * 3);
        let px = (self.pos[a3] as f64 + self.pos[b3] as f64) * 0.5;
        let py = (self.pos[a3 + 1] as f64 + self.pos[b3 + 1] as f64) * 0.5;
        let pz = (self.pos[a3 + 2] as f64 + self.pos[b3 + 2] as f64) * 0.5;
        let far = |s: &Patch, x: u32| { let o = x as usize * 3; let (dx, dy, dz) = (s.pos[o] as f64 - px, s.pos[o + 1] as f64 - py, s.pos[o + 2] as f64 - pz); dx * dx + dy * dy + dz * dz > max2 };
        for &x in &ra { if x as usize != b && far(self, x) { return false; } }
        for &x in &rb { if x as usize != a && far(self, x) { return false; } }
        for &v in &[a, b] { for &t in &self.vf[v] { let t = t as usize; if t != t1 && t != t2 && !self.keeps_orientation(t, a as u32, b as u32, px, py, pz) { return false; } } }
        self.pos[a3] = px as f32; self.pos[a3 + 1] = py as f32; self.pos[a3 + 2] = pz as f32;
        for k in 0..3 { self.col[a3 + k] = ((self.col[a3 + k] as f64 + self.col[b3 + k] as f64) * 0.5) as f32; }
        self.mask[a] = self.mask[a].max(self.mask[b]);
        for t in [t1, t2] {
            if self.alive[t] { self.alive[t] = false; self.live -= 1; }
            for &v in &self.faces[t].clone() { let l = &mut self.vf[v as usize]; if let Some(i) = l.iter().position(|&x| x == t as u32) { l.swap_remove(i); } }
        }
        let rest = std::mem::take(&mut self.vf[b]);
        for &t in &rest {
            for k in 0..3 { if self.faces[t as usize][k] as usize == b { self.faces[t as usize][k] = a as u32; } }
            self.vf[a].push(t);
        }
        self.removed[b] = true;
        self.mask[b] = 0.0;
        self.dirty.extend_from_slice(&[a as u32, c as u32, d as u32]);
        self.dirty.extend_from_slice(&ra);
        self.dirty.extend_from_slice(&rb);
        true
    }

    // every edge touching `cands` once (as the page's collectEdges), with its squared length
    fn collect(&self, cands: &[u32], p: &Params, split: bool, lim2: f64) -> Vec<(u32, u32, f64)> {
        let mut inset = vec![false; self.nv()];
        let mut s: Vec<u32> = Vec::new();
        for &v in cands { let v = v as usize; if v < self.nv() && !self.vf[v].is_empty() && !inset[v] { inset[v] = true; s.push(v as u32); } }
        let mut out = Vec::new();
        let mut push = |v: u32, w: u32| {
            let l2 = d2(&self.pos, v as usize, w as usize);
            if if split { l2 <= lim2 } else { l2 >= lim2 } { return; }
            if p.r2.is_finite() {
                let (v3, w3) = (v as usize * 3, w as usize * 3);
                let a = [self.pos[v3] as f64, self.pos[v3 + 1] as f64, self.pos[v3 + 2] as f64];
                let b = [self.pos[w3] as f64, self.pos[w3 + 1] as f64, self.pos[w3 + 2] as f64];
                // a long edge is split when any part of it is under the brush (its middle may be outside:
                // a big triangle reaching in with one corner would be dragged out into a shard); a short
                // one is merged when its middle is
                let t = if split && l2 > 0.0 {
                    (((p.c[0] - a[0]) * (b[0] - a[0]) + (p.c[1] - a[1]) * (b[1] - a[1]) + (p.c[2] - a[2]) * (b[2] - a[2])) / l2).clamp(0.0, 1.0)
                } else { 0.5 };
                let (mx, my, mz) = (a[0] + (b[0] - a[0]) * t - p.c[0], a[1] + (b[1] - a[1]) * t - p.c[1], a[2] + (b[2] - a[2]) * t - p.c[2]);
                if mx * mx + my * my + mz * mz > p.r2 { return; }
            }
            out.push((v, w, l2));
        };
        for &v in &s {
            let vi = v as usize;
            for &t in &self.vf[vi] {
                let f = self.faces[t as usize];
                let k = if f[0] == v { 0 } else if f[1] == v { 1 } else { 2 };
                let w = f[(k + 1) % 3];
                if !(inset[w as usize] && w < v && self.has_half_edge(w as usize, v)) { push(v, w); }
                let u = f[(k + 2) % 3];
                if !inset[u as usize] && !self.has_half_edge(vi, u) { push(v, u); }
            }
        }
        out
    }
    fn sample(list: &[u32], want: usize, tick: usize) -> Vec<u32> {
        if list.len() <= want { return list.to_vec(); }
        let step = list.len().div_ceil(want.max(1));
        let off = tick % step;
        list.iter().skip(off).step_by(step).copied().collect()
    }

    /// One dab's refinement; true when the patch changed.
    pub fn remesh(&mut self, verts: &[u32], p: &Params) -> bool {
        let mut verts: Vec<u32> = verts.to_vec();
        let mut changed = false;
        let (mut splits, mut collapses) = (0usize, 0usize);
        let mut tick = p.tick;
        let start = self.face_count();
        let collapse_passes = |s: &mut Patch, passes: usize, verts: &[u32], collapses: &mut usize, changed: &mut bool, tick: &mut usize| {
            for _ in 0..passes {
                if *collapses >= p.collapse_budget { return; }
                let left = p.collapse_budget - *collapses;
                let cand = if p.all { verts.to_vec() } else { *tick += 1; Patch::sample(verts, left.saturating_mul(6), *tick) };
                let mut e = s.collect(&cand, p, false, p.min2);
                if e.is_empty() { return; }
                e.sort_by(|x, y| x.2.partial_cmp(&y.2).unwrap_or(std::cmp::Ordering::Equal));
                e.truncate((left.saturating_mul(5) / 4).saturating_add(16));
                let mut did = 0;
                for (a, b, _) in e {
                    if *collapses >= p.collapse_budget { break; }
                    let (a, b) = (a as usize, b as usize);
                    if s.vf[a].is_empty() || s.vf[b].is_empty() { continue; }
                    if s.mask[a] > 0.5 || s.mask[b] > 0.5 { continue; }
                    if s.grp[a] != s.grp[b] || (p.cur_group >= 0.0 && s.grp[a] != p.cur_group) { continue; }
                    if d2(&s.pos, a, b) >= p.min2 { continue; }
                    if s.collapse_edge(a, b, p.max2) { did += 1; *collapses += 1; }
                }
                if did == 0 { return; }
                *changed = true;
            }
        };
        if p.all && p.do_collapse { collapse_passes(self, 8, &verts, &mut collapses, &mut changed, &mut tick); }
        let mut scan = if p.all { verts.clone() } else { tick += 1; Patch::sample(&verts, p.split_budget.saturating_mul(6), tick) };
        if p.do_split {
            for _ in 0..(if p.all { 16 } else { 4 }) {
                let mut e = self.collect(&scan, p, true, p.max2);
                if e.is_empty() { break; }
                e.sort_by(|x, y| y.2.partial_cmp(&x.2).unwrap_or(std::cmp::Ordering::Equal));   // longest first
                let left = p.split_budget.saturating_sub(splits);
                e.truncate((left.saturating_mul(5) / 4).saturating_add(16));
                let mut created = Vec::new();
                for (a, b, _) in e {
                    if splits >= p.split_budget { break; }
                    if self.face_count() - start + 8 > self.face_room { self.hit_cap = true; break; }
                    let (a, b) = (a as usize, b as usize);
                    if self.mask[a] > 0.5 && self.mask[b] > 0.5 { continue; }
                    if p.cur_group >= 0.0 && (self.grp[a] != p.cur_group || self.grp[b] != p.cur_group) { continue; }
                    if d2(&self.pos, a, b) <= p.max2 { continue; }
                    if let Some(v) = self.split_edge(a, b) { created.push(v as u32); splits += 1; }
                }
                if created.is_empty() { break; }
                verts.extend_from_slice(&created);
                scan = created;
                changed = true;
            }
        }
        if p.do_collapse { collapse_passes(self, if p.all { 8 } else { 1 }, &verts, &mut collapses, &mut changed, &mut tick); }
        self.splits = splits; self.collapses = collapses;
        changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // an n×n grid of the unit square (z = 0)
    fn grid(n: usize) -> (Vec<f32>, Vec<u32>) {
        let mut p = Vec::new();
        for j in 0..=n { for i in 0..=n { p.extend_from_slice(&[i as f32 / n as f32, j as f32 / n as f32, 0.0]); } }
        let mut f = Vec::new();
        let at = |i: usize, j: usize| (j * (n + 1) + i) as u32;
        for j in 0..n { for i in 0..n { f.extend_from_slice(&[at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1)]); } }
        (p, f)
    }
    fn patch(pos: &[f32], idx: &[u32]) -> Patch {
        let n = pos.len() / 3;
        let nrm: Vec<f32> = (0..n).flat_map(|_| [0.0, 0.0, 1.0]).collect();
        Patch::new(pos, &nrm, &vec![1.0; n * 3], &vec![0.0; n], &vec![0.0; n], &vec![0.0; n], idx, &vec![0; n], &vec![0; n], &[], 1 << 40)
    }
    fn params(l: f64, split: usize, collapse: usize) -> Params {
        Params { c: [0.5, 0.5, 0.0], r2: f64::INFINITY, max2: l * l, min2: l * l * 0.16, split_budget: split, collapse_budget: collapse, do_split: true, do_collapse: true, all: true, cur_group: -1.0, tick: 0 }
    }
    #[test]
    fn splits_until_short_and_stays_a_surface() {
        let (pos, idx) = grid(4);
        let mut p = patch(&pos, &idx);
        let all: Vec<u32> = (0..(pos.len() / 3) as u32).collect();
        assert!(p.remesh(&all, &params(0.1, usize::MAX, usize::MAX)));
        // every edge now at most L (the open border is split too) and each inner edge in two faces
        let mut cnt = std::collections::HashMap::new();
        for (t, f) in p.faces.iter().enumerate() {
            if !p.alive[t] { continue; }
            for k in 0..3 { let (a, b) = (f[k], f[(k + 1) % 3]); *cnt.entry(ekey(a, b)).or_insert(0) += 1; assert!(d2(&p.pos, a as usize, b as usize) <= 0.1 * 0.1 + 1e-9); }
        }
        assert!(cnt.values().all(|&c| c == 1 || c == 2));
        assert!(p.face_count() > 32 * 10);
    }
    #[test]
    fn collapses_a_dense_grid_but_not_its_edge() {
        let (pos, idx) = grid(20);
        let mut p = patch(&pos, &idx);
        let all: Vec<u32> = (0..(pos.len() / 3) as u32).collect();
        let before = p.face_count();
        p.remesh(&all, &params(0.5, 0, usize::MAX));
        assert!(p.face_count() < before / 2, "{} -> {}", before, p.face_count());
        // the corners are still there
        for &(i, j) in &[(0usize, 0usize), (20, 0), (0, 20), (20, 20)] { assert!(!p.removed[j * 21 + i]); }
    }
    #[test]
    fn locked_and_frozen_hold() {
        let (pos, idx) = grid(2);
        let n = pos.len() / 3;
        let nrm: Vec<f32> = (0..n).flat_map(|_| [0.0, 0.0, 1.0]).collect();
        // the whole outer ring locked, its edges frozen: only the inner edges may split
        let locked: Vec<u8> = (0..n).map(|v| if v == 4 { 0 } else { 1 }).collect();
        let frozen = [0u32, 1, 1, 2, 2, 5, 5, 8, 8, 7, 7, 6, 6, 3, 3, 0];
        let mut p = Patch::new(&pos, &nrm, &vec![1.0; n * 3], &vec![0.0; n], &vec![0.0; n], &vec![0.0; n], &idx, &locked, &vec![1; n], &frozen, 1 << 40);
        let all: Vec<u32> = (0..n as u32).collect();
        p.remesh(&all, &params(0.2, usize::MAX, usize::MAX));
        // every frozen rim edge is still an edge of some face
        for c in frozen.chunks(2) {
            let e = ekey(c[0], c[1]);
            assert!(p.faces.iter().enumerate().any(|(t, f)| p.alive[t] && (0..3).any(|k| ekey(f[k], f[(k + 1) % 3]) == e)), "{e:?}");
        }
        assert!(!p.removed.iter().take(n).any(|&r| r));
    }
}
