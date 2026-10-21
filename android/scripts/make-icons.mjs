// Makes the Android launcher icons and the splash icon from ../../build/icons/icon-1024.png.
// Plain Node (zlib only), no extra packages: decodes the PNG, scales it with an exact area
// filter in linear light, and writes the PNGs into the native project:
//   mipmap-*/ic_launcher.png             legacy square icon (48 dp), all densities
//   mipmap-*/ic_launcher_round.png       legacy round icon (48 dp)
//   mipmap-*/ic_launcher_foreground.png  adaptive icon foreground (108 dp): the wax sphere
//   drawable/ic_launcher_background.xml  adaptive icon background: the icon's dark gradient
//   drawable-nodpi/splash_icon.png       icon shown on the launch screen
// Usage: node scripts/make-icons.mjs   (only needed when icon-1024.png changes)
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..', 'build', 'icons', 'icon-1024.png');
const RES = path.resolve(HERE, '..', 'android', 'app', 'src', 'main', 'res');

// Geometry of icon-1024.png (see build/make-icons.mjs), in fractions of the icon size:
// sphere centre (0.5, 0.52), radius 0.32; dark rounded square 0.04..0.96 with a vertical
// gradient #232932 -> #14171c running from the top (0) to the bottom (1) of the image.
const SPHERE_CY = 0.52;
const FG_SPAN = 1.5;       // icon widths that the 108 dp foreground layer covers: sphere = 46 dp of the 72 dp visible area
const FG_DISC = 0.42;      // the part of the icon kept in the foreground: sphere, groove and its shadow
const ROUND_R = 0.455;     // legacy round icon: circle inside the dark square
const GRADIENT = ['#232932', '#14171c'];

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

// ---------- PNG decode / encode ----------
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let o = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0; const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), name = buf.toString('latin1', o + 4, o + 8), data = buf.subarray(o + 8, o + 8 + len);
    if (name === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
    o += 12 + len;
  }
  if (depth !== 8 || (type !== 6 && type !== 2) || interlace) throw new Error(`unsupported PNG (depth ${depth}, colour type ${type}, interlace ${interlace})`);
  const bpp = type === 6 ? 4 : 3, stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(stride * h), out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[row + i - bpp] : 0, b = y ? px[row - stride + i] : 0, c = y && i >= bpp ? px[row - stride + i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + i] = v & 255;
    }
  }
  for (let i = 0, j = 0; i < w * h; i++, j += bpp) { out[i * 4] = px[j]; out[i * 4 + 1] = px[j + 1]; out[i * 4 + 2] = px[j + 2]; out[i * 4 + 3] = bpp === 4 ? px[j + 3] : 255; }
  return { w, h, data: out };
}
function encodePNG(w, h, rgba) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {   // filter 4 (Paeth) on every row: good enough and simple
    raw[y * (stride + 1)] = 4;
    for (let i = 0; i < stride; i++) {
      const o = y * stride + i, a = i >= 4 ? rgba[o - 4] : 0, b = y ? rgba[o - stride] : 0, c = y && i >= 4 ? rgba[o - stride - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      raw[y * (stride + 1) + 1 + i] = (rgba[o] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
  }
  const chunk = (name, data) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(name, 4, 'latin1');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- colour: sRGB <-> linear, premultiplied float image ----------
const toLin = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
const toSRGB = (l) => { const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(c * 255))); };
function toFloat({ w, h, data }) {
  const f = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3] / 255;
    f[i * 4] = toLin[data[i * 4]] * a; f[i * 4 + 1] = toLin[data[i * 4 + 1]] * a; f[i * 4 + 2] = toLin[data[i * 4 + 2]] * a; f[i * 4 + 3] = a;
  }
  return { w, h, f };
}
function toBytes(img) {
  const out = new Uint8Array(img.w * img.h * 4);
  for (let i = 0; i < img.w * img.h; i++) {
    const a = img.f[i * 4 + 3];
    if (a <= 1e-6) continue;
    out[i * 4] = toSRGB(img.f[i * 4] / a); out[i * 4 + 1] = toSRGB(img.f[i * 4 + 1] / a); out[i * 4 + 2] = toSRGB(img.f[i * 4 + 2] / a);
    out[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
  }
  return out;
}

// ---------- exact box (area) resampling of a source rectangle; outside the image is transparent ----------
function weights(srcLen, from, span, n) {
  // for each of n output samples: list of [source index, weight] covering [from + k*span/n, from + (k+1)*span/n)
  const res = [], step = span / n;
  for (let k = 0; k < n; k++) {
    const a = from + k * step, b = a + step, list = [];
    for (let s = Math.floor(a); s < Math.ceil(b); s++) {
      if (s < 0 || s >= srcLen) continue;
      const cover = Math.min(b, s + 1) - Math.max(a, s);
      if (cover > 0) list.push([s, cover / step]);
    }
    res.push(list);
  }
  return res;
}
function resample(src, x0, y0, sw, sh, W, H) {
  const wx = weights(src.w, x0, sw, W), wy = weights(src.h, y0, sh, H);
  const tmp = new Float32Array(W * src.h * 4);
  for (let y = 0; y < src.h; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (const [s, k] of wx[x]) { const o = (y * src.w + s) * 4; r += src.f[o] * k; g += src.f[o + 1] * k; b += src.f[o + 2] * k; a += src.f[o + 3] * k; }
    const o = (y * W + x) * 4; tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b; tmp[o + 3] = a;
  }
  const f = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (const [s, k] of wy[y]) { const o = (s * W + x) * 4; r += tmp[o] * k; g += tmp[o + 1] * k; b += tmp[o + 2] * k; a += tmp[o + 3] * k; }
    const o = (y * W + x) * 4; f[o] = r; f[o + 1] = g; f[o + 2] = b; f[o + 3] = a;
  }
  return { w: W, h: H, f };
}
// multiply by an anti-aliased disc (centre and radius in output pixels, soft edge `soft` px wide)
function disc(img, cx, cy, r, soft = 1) {
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy), m = Math.max(0, Math.min(1, (r - d) / soft + 0.5));
    const o = (y * img.w + x) * 4; for (let k = 0; k < 4; k++) img.f[o + k] *= m;
  }
  return img;
}

// ---------- write everything ----------
const icon = toFloat(decodePNG(fs.readFileSync(SRC)));
const S = icon.w;
const save = (rel, img) => { const p = path.join(RES, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, encodePNG(img.w, img.h, toBytes(img))); return p; };
const written = [];

for (const [name, d] of Object.entries(DENSITIES)) {
  const n = Math.round(48 * d), fg = Math.round(108 * d);
  written.push(save(`mipmap-${name}/ic_launcher.png`, resample(icon, 0, 0, S, S, n, n)));
  written.push(save(`mipmap-${name}/ic_launcher_round.png`, disc(resample(icon, 0, 0, S, S, n, n), n / 2, n / 2, ROUND_R * n)));
  // foreground: a window FG_SPAN icons wide centred on the sphere, keeping only the disc around it;
  // the dark pixels inside the disc match the background layer below, so the seam is invisible
  const span = FG_SPAN * S, x0 = S / 2 - span / 2, y0 = SPHERE_CY * S - span / 2;
  written.push(save(`mipmap-${name}/ic_launcher_foreground.png`,
    disc(resample(icon, x0, y0, span, span, fg, fg), fg / 2, fg / 2, (FG_DISC / FG_SPAN) * fg, Math.max(1, fg * 0.01))));
}
written.push(save('drawable-nodpi/splash_icon.png', resample(icon, 0, 0, S, S, 512, 512)));

// background layer: the same gradient as the icon, placed where the icon's top (t=0) and bottom (t=1) land in the 108 dp layer
const yAt = (t) => (54 + ((t - SPHERE_CY) / FG_SPAN) * 108).toFixed(2);
const bgXml = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/make-icons.mjs: the dark gradient of build/icons/icon-1024.png -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:pathData="M0,0h108v108h-108z">
        <aapt:attr name="android:fillColor">
            <gradient
                android:type="linear"
                android:startX="54"
                android:startY="${yAt(0)}"
                android:endX="54"
                android:endY="${yAt(1)}"
                android:startColor="${GRADIENT[0]}"
                android:endColor="${GRADIENT[1]}"
                android:tileMode="clamp" />
        </aapt:attr>
    </path>
</vector>
`;
fs.mkdirSync(path.join(RES, 'drawable'), { recursive: true });
fs.writeFileSync(path.join(RES, 'drawable', 'ic_launcher_background.xml'), bgXml);
written.push(path.join(RES, 'drawable', 'ic_launcher_background.xml'));
console.log(written.map((p) => path.relative(path.resolve(HERE, '..'), p)).join('\n'));
