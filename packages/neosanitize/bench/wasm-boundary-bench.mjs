// Micro-benchmark: the irreducible JS<->WASM string boundary cost.
// Simulates the CHEAPEST possible WASM design: string in (TextEncoder UTF-8
// encode into a preallocated buffer), string out (TextDecoder decode from a
// byte buffer). No parsing at all — this is pure marshaling overhead that a
// string-in/string-out WASM sanitizer MUST pay on top of its compute.
// Also measures per-call overhead of a trivial WASM export on this machine.

const enc = new TextEncoder();
const dec = new TextDecoder();

function mkHtml(bytes) {
  const unit = '<div class="post row"><a href="https://example.com/x?y=1">link &amp; text</a><p>Hello <b>world</b> — plain filler text goes here.</p></div>';
  let s = '';
  while (s.length < bytes) s += unit;
  return s.slice(0, bytes);
}

function bench(label, fn, minMs = 400) {
  // warm
  for (let i = 0; i < 50; i++) fn();
  let n = 0;
  const t0 = performance.now();
  let dt = 0;
  while ((dt = performance.now() - t0) < minMs) { fn(); n++; }
  return { label, usPerOp: (dt * 1000) / n, n };
}

console.log(`node ${process.version}`);
const sizes = [1024, 8 * 1024, 64 * 1024, 512 * 1024, 4 * 1024 * 1024];
const buf = new Uint8Array(16 * 1024 * 1024);

console.log('\n-- string round-trip (encodeInto + decode), the floor for string-in/string-out WASM --');
for (const size of sizes) {
  const html = mkHtml(size);
  let sink = 0;
  const r = bench(`${size}`, () => {
    const { written } = enc.encodeInto(html, buf);
    const out = dec.decode(buf.subarray(0, written));
    sink += out.length;
  });
  const mbps = (size * 2) / (r.usPerOp / 1e6) / 1024 / 1024; // 2x: in + out
  console.log(`  ${String(size / 1024).padStart(6)} KB  ${r.usPerOp.toFixed(1).padStart(10)} us/op   ${(mbps).toFixed(0).padStart(7)} MB/s round-trip  (${(size / 1024 / 1024 / (r.usPerOp / 1e6)).toFixed(0)} MB/s each way)`);
}

console.log('\n-- encode only / decode only at 64KB --');
{
  const html = mkHtml(64 * 1024);
  const { written } = enc.encodeInto(html, buf);
  const view = buf.subarray(0, written);
  let sink = 0;
  const e = bench('enc', () => { sink += enc.encodeInto(html, buf).written; });
  const d = bench('dec', () => { sink += dec.decode(view).length; });
  console.log(`  encodeInto: ${e.usPerOp.toFixed(1)} us/op  (${(64 / 1024 / (e.usPerOp / 1e6)).toFixed(0)} MB/s)`);
  console.log(`  decode:     ${d.usPerOp.toFixed(1)} us/op  (${(64 / 1024 / (d.usPerOp / 1e6)).toFixed(0)} MB/s)`);
}

// per-call overhead: trivial wasm export (add) called in a loop
const wasmBytes = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic+version
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f, // type: (i32,i32)->i32
  0x03, 0x02, 0x01, 0x00, // func section
  0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, // export "add"
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b, // body: local.get 0, local.get 1, i32.add
]);
const t0 = performance.now();
const { instance } = await WebAssembly.instantiate(wasmBytes);
const instMs = performance.now() - t0;
const add = instance.exports.add;
{
  let acc = 0;
  // warm
  for (let i = 0; i < 1e6; i++) acc = add(acc, 1);
  const N = 5e7;
  const t1 = performance.now();
  for (let i = 0; i < N; i++) acc = add(acc, 1);
  const dt = performance.now() - t1;
  console.log(`\n-- JS->WASM call overhead (trivial i32 add export) --`);
  console.log(`  ${((dt * 1e6) / N).toFixed(1)} ns/call   (tiny-module instantiate: ${instMs.toFixed(2)} ms)`);
  // JS baseline
  const jsAdd = (a, b) => (a + b) | 0;
  let acc2 = 0;
  for (let i = 0; i < 1e6; i++) acc2 = jsAdd(acc2, 1);
  const t2 = performance.now();
  for (let i = 0; i < N; i++) acc2 = jsAdd(acc2, 1);
  const dt2 = performance.now() - t2;
  console.log(`  JS->JS same loop: ${((dt2 * 1e6) / N).toFixed(1)} ns/call (inlined baseline)`);
  if (acc + acc2 === -1) console.log('x');
}
