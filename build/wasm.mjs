// Rebuilds the Rust core (../core) to WebAssembly and puts it next to this script as glina-core.wasm,
// which build.mjs embeds in every page. The built file is kept in git, so building the pages needs no
// Rust; run this after changing ../core:   node wasm.mjs
// Needs Rust (rustup) with the target:      rustup target add wasm32-unknown-unknown
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE = path.resolve(HERE, '..', 'core');
execFileSync('cargo', ['test', '--release'], { cwd: CORE, stdio: 'inherit' });
execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], { cwd: CORE, stdio: 'inherit' });
const out = path.join(CORE, 'target', 'wasm32-unknown-unknown', 'release', 'glina_core.wasm');
const bytes = fs.readFileSync(out);
const mod = new WebAssembly.Module(bytes);
if (WebAssembly.Module.imports(mod).length) throw new Error('the core must not import anything: ' + JSON.stringify(WebAssembly.Module.imports(mod)));
fs.copyFileSync(out, path.join(HERE, 'glina-core.wasm'));
console.log(`glina-core.wasm: ${(bytes.length / 1024).toFixed(1)} KB`);
