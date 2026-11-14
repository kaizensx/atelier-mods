// Format 2 shader packs: the restricted Metal the catalog accepts, the same rules as
// ShaderCode.swift in the Atelier app. The cases mirror Tests/DockCoreTests/ShaderCodeTests.swift.
// Run: node --test scripts/test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePack, validateShaderCode, SHADER_CODE } from "../packs.mjs";
import { walk, ALLOWED } from "../lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const example = join(here, "fixtures/tide-pool.ateliershader");
const signature = "float4 shade(float2 uv, constant Uniforms &u, texture2d<float> wallpaper)";
const shade = (body, helpers = "") => `${helpers}\n${signature} {\n${body}\n}\n`;
const passes = (source) => validateShaderCode(source) === null;
const refusal = (source) => (validateShaderCode(source) ?? []).map((p) => p.description).join(" | ");
const refuses = (source, text) => {
  const why = refusal(source);
  assert.ok(why, `should be refused: ${source}`);
  assert.ok(why.includes(text), `${why} should mention ${text}`);
};

// --- Accepted -------------------------------------------------------------------------------

test("plain shaders pass", () => {
  assert.ok(passes(shade("return float4(uv, 0.5, 1.0);")));
  assert.ok(passes(shade(`
    float t = u.time * 0.1;
    float3 a = u.palette[0].rgb, b = u.palette[3].rgb;
    float n = fbm(uv * 3.0 + t, 5);
    float3 c = mix(a, b, smoothstep(0.2, 0.8, n));
    c += 0.1 * sin(float3(1.0, 2.0, 3.0) * t + uv.x * M_PI_F);
    return float4(saturate(c), 1.0);`)));
  // Helpers, written before the functions that call them.
  assert.ok(passes(shade("return float4(ring(uv, 0.3) * float3(1.0), 1.0);",
    "float ring(float2 p, float r) { return smoothstep(0.02, 0.0, abs(length(p - 0.5) - r)); }")));
  assert.ok(passes(shade("return float4(twice(0.25), 0.0, 0.0, 1.0);",
    "float once(float x) { return x * 2.0; }\nfloat twice(const float x) { return once(once(x)); }")));
  // The wallpaper, through the helper only.
  assert.ok(passes(shade("float4 w = sampleWallpaper(wallpaper, uv + 0.01 * sin(u.time)); return float4(w.rgb * 0.8, 1.0);")));
  // Bounded loops, nested within the total.
  assert.ok(passes(shade(`
    float s = 0.0;
    for (int i = 0; i < 64; i++) { s += noise(uv * float(i)); }
    for (int j = 8; j > 0; j--) { for (int k = 0; k <= 15; k += 1) { s += 0.001; if (s > 4.0) { break; } } }
    return float4(s / 64.0, 0.0, 0.0, 1.0);`)));
  // Comments, hex and suffixed numbers, ternaries and swizzles.
  assert.ok(passes(shade(`
    // a line comment
    /* a block
       comment */
    uint mask = 0xFFu;
    half h = 0.5h;
    float x = uv.x > 0.5 ? 1.0f : 0.0f;
    float2 d = uv.yx - u.pointer;
    return float4(d.xyx, x * float(mask) / 255.0);`)));
});

test("the example pack passes", () => {
  const source = readFileSync(join(example, "shade.metal"), "utf8");
  assert.equal(validateShaderCode(source), null, refusal(source));
});

// --- Refused --------------------------------------------------------------------------------

test("the preprocessor and text are refused", () => {
  refuses("#include <metal_stdlib>\n" + shade("return float4(1.0);"), "#");
  refuses("#pragma clang diagnostic ignored \"-Wall\"\n" + shade("return float4(1.0);"), "#");
  refuses(shade("return float4(1.0); \\"), "\\");
  refuses(shade("const char x = 'a'; return float4(1.0);"), "strings");
  refuses(shade("float é = 1.0; return float4(é);"), "ASCII");
  refuses(shade("/* never closed return float4(1.0);"), "never closed");
  refuses(shade("return float4(1.0);@"), "not allowed");
  refuses("", "empty");
});

test("the signature is fixed", () => {
  refuses("float4 shade(float2 uv) { return float4(1.0); }", "declared exactly");
  refuses("float3 shade(float2 uv, constant Uniforms &u, texture2d<float> wallpaper) { return float3(1.0); }", "declared exactly");
  refuses("float4 shade(float2 uv, device Uniforms &u, texture2d<float> wallpaper) { return float4(1.0); }", "declared exactly");
  refuses("float x(float a) { return a; }", "needs float4 shade");
  // shade comes last, once.
  refuses(shade("return float4(1.0);") + "float after(float a) { return a; }", "last");
  refuses(shade("return float4(1.0);") + shade("return float4(0.0);"), "last");
});

test("entry points and attributes are refused", () => {
  refuses("fragment float4 f() { return float4(1.0); }\n" + shade("return float4(1.0);"), "entry point");
  refuses("kernel void k() { }\n" + shade("return float4(1.0);"), "entry point");
  refuses(shade("float4 c [[color(0)]] = float4(1.0); return c;"), "array");
  refuses("[[visible]] float f(float a) { return a; }\n" + shade("return float4(1.0);"), "expected a function");
});

test("memory is unreachable", () => {
  refuses(shade("float a = 1.0; float *p = &a; return float4(*p);"), "pointer");
  refuses(shade("float a = 1.0; return float4(*(&a));"), "pointers");
  refuses(shade("float a = 1.0; float b = a * &a; return float4(b);"), "&");
  refuses(shade("thread float &r = uv.x; return float4(r);"), "address spaces");
  refuses(shade("device float *d; return float4(1.0);"), "address spaces");
  refuses(shade("threadgroup float t; return float4(1.0);"), "address spaces");
  refuses(shade("constant float k = 1.0; return float4(k);"), "address spaces");
  refuses("float f(float &x) { return x; }\n" + shade("return float4(1.0);"), "no pointers or references");
  refuses("float f(device float *x) { return 1.0; }\n" + shade("return float4(1.0);"), "address spaces");
  refuses(shade("float a[4]; return float4(a[0]);"), "array");
  refuses(shade("float4 c = u.palette[4]; return c;"), "palette");
  refuses(shade("int i = 1; float4 c = u.palette[i]; return c;"), "palette");
  refuses(shade("float4 c = u.palette; return c;"), "palette");
  refuses(shade("return float4(u.secret);"), "no field");
  refuses(shade("return float4(uv[0]);"), "array");
  refuses(shade("return float4(u);"), "fields");
  refuses(shade("return wallpaper.sample(s, uv);"), "sampleWallpaper");
  refuses(shade("texture2d<float> other; return float4(1.0);"), "textures");
  refuses(shade("buffer b; return float4(1.0);"), "buffers");
  refuses(shade("sampler s; return float4(1.0);"), "samplers");
  refuses(shade("int b = 3 & 1; return float4(float(b));"), "&");
  refuses(shade("return float4(metal::sin(uv.x));"), "unknown name");
  refuses(shade("float2 p = uv; return float4(p.x::y);"), "::");
});

test("only bounded loops", () => {
  refuses(shade("float s = 0.0; while (s < 1.0) { s += 0.1; } return float4(s);"), "for loops");
  refuses(shade("float s = 0.0; do { s += 0.1; } while (s < 1.0); return float4(s);"), "for loops");
  refuses(shade("float s = 0.0; for (int i = 0; i < 65; i++) { s += 0.1; } return float4(s);"), "65");
  refuses(shade("float s = 0.0; for (int i = 0; i < 10; i += 0) { s += 0.1; } return float4(s);"), "step");
  refuses(shade("float s = 0.0; for (int i = 0; i < 10; i--) { s += 0.1; } return float4(s);"), "never end");
  refuses(shade("float s = 0.0; int n = 10; for (int i = 0; i < n; i++) { s += 0.1; } return float4(s);"), "end must be");
  refuses(shade("float s = 0.0; for (int i = 0; i < 10; i++) { i = 0; s += 0.1; } return float4(s);"), "counter i may not change");
  refuses(shade("float s = 0.0; for (int i = 0; i < 10; i++) { i--; } return float4(s);"), "counter i may not change");
  refuses(shade("float s = 0.0; for (int i = 0; i < 10; i++) s += 0.1; return float4(s);"), "braces");
  refuses(shade("float s = 0.0; for (;;) { s += 0.1; } return float4(s);"), "declare");
  refuses(shade(`
    float s = 0.0;
    for (int a = 0; a < 64; a++) { for (int b = 0; b < 64; b++) { for (int c = 0; c < 2; c++) { s += 0.1; } } }
    return float4(s);`), "4096");
  refuses(shade("float s = 0.0; for (int i = 0; i < 4; i++) { goto end; } return float4(s);"), "for loops");
  refuses(shade("switch (1) { default: break; } return float4(1.0);"), "for loops");
});

test("helpers count towards the work per pixel", () => {
  const one = "float h1(float x) { float s = 0.0; for (int i = 0; i < 64; i++) { s += sin(x + float(i)); } return s; }";
  const two = "float h2(float x) { float s = 0.0; for (int i = 0; i < 64; i++) { s += h1(x * float(i)); } return s; }";
  // 64 turns in h1, called 64 times in h2: 4160 in all, within the limit.
  assert.ok(passes(shade("return float4(h2(uv.x));", one + "\n" + two)));
  // Calling h2 eight times more is not: loops hidden in helpers still count.
  refuses(shade("float s = 0.0; for (int k = 0; k < 8; k++) { s += h2(uv.x); } return float4(s);", one + "\n" + two), "too much for one pixel");
  refuses(shade("float s = 0.0; for (int k = 0; k < 64; k++) { for (int j = 0; j < 4; j++) { s += h1(uv.y); } } return float4(s);", one), "too much for one pixel");
});

test("no recursion", () => {
  refuses("float f(float x) { return f(x - 1.0); }\n" + shade("return float4(f(1.0));"), "recursion");
  // A function may only call the ones before it, so two cannot call each other.
  refuses("float a(float x) { return b(x); }\nfloat b(float x) { return a(x); }\n" + shade("return float4(a(1.0));"), "unknown name \"b\"");
  refuses(shade("return shade(uv, u, wallpaper);"), "recursion");
});

test("only known names", () => {
  refuses(shade("return float4(fast::sin(uv.x));"), "unknown name");
  refuses(shade("return float4(simd_shuffle(uv.x, 1u));"), "unknown name");
  refuses(shade("threadgroup_barrier(mem_flags::mem_none); return float4(1.0);"), "not allowed");
  refuses(shade("discard_fragment(); return float4(1.0);"), "not allowed");
  refuses(shade("return as_type<float4>(uint4(1));"), "not allowed");
  refuses(shade("struct S { float a; }; return float4(1.0);"), "not allowed");
  refuses("using namespace metal;\n" + shade("return float4(1.0);"), "not allowed");
  refuses("static float f(float x) { return x; }\n" + shade("return float4(1.0);"), "not allowed");
  refuses(shade("float __x = 1.0; return float4(__x);"), "cannot be used as a name");
  refuses(shade("float sin = 1.0; return float4(sin);"), "cannot be used as a name");
  refuses(shade("float4 v = float4(1.0); return v.q;"), "swizzle");
  refuses(shade("float4 v = float4(1.0); return v.xr;"), "swizzle");
  refuses(shade("return float4(undefined);"), "unknown name");
  refuses("float noise(float2 p) { return 0.0; }\n" + shade("return float4(1.0);"), "cannot be used as a function name");
  refuses("float g(float x) { return x; }\nfloat g(float y) { return y; }\n" + shade("return float4(1.0);"), "cannot be used");
  refuses("float outer(float x) { float inner(float y) { return y; } return x; }\n" + shade("return float4(1.0);"), "inside other functions");
});

test("size and count limits", () => {
  refuses(shade("return float4(1.0);") + "//" + "x".repeat(SHADER_CODE.maxBytes), "KB");
  const helpers = Array.from({ length: 16 }, (_, i) => `float h${i}(float x) { return x; }`).join("\n");
  refuses(shade("return float4(1.0);", helpers), "at most 16 functions");
  const deep = "(".repeat(40) + "1.0" + ")".repeat(40);
  refuses(shade(`return float4(${deep});`), "nested");
  refuses(shade("return float4(1.0.5);"), "not a number");
  refuses(shade("return float4(1e);"), "exponent");
});

test("problems name their line, at most ten", () => {
  const [first] = validateShaderCode(shade("return float4(1.0);\nwhile (true) { }"));
  assert.equal(first.line, 4);
  assert.match(first.description, /^line 4: "while"/);
  assert.equal(validateShaderCode("").at(0).description, "the file is empty: write a shade function");
});

// --- Packs ----------------------------------------------------------------------------------

/** A shader pack folder with this manifest and, when given, shade.metal; returns its errors. */
function pack(manifest, metal, name = "shade.metal") {
  const dir = mkdtempSync(join(tmpdir(), "shader-"));
  try {
    writeFileSync(join(dir, "atelier-shader.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
    if (metal !== undefined) { mkdirSync(dirname(join(dir, name)), { recursive: true }); writeFileSync(join(dir, name), metal); }
    return validatePack("shader", dir, walk(dir).files).errors;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const header = { id: "com.example.code", name: "Code", version: "1.0.0", base: "nebula" };
const has = (errors, text) => errors.some((e) => e.includes(text));

test("format 2 packs carry checked code", () => {
  const good = shade("return float4(uv, 0.5, 1.0);");
  assert.deepEqual(pack({ format: 2, ...header, fragment: "shade.metal" }, good), []);
  const bad = pack({ format: 2, ...header, fragment: "shade.metal" }, shade("while (true) { } return float4(1.0);"));
  assert.ok(bad.some((e) => e.includes("shade.metal line") && e.includes("for loops")), bad.join("\n"));
  assert.ok(has(pack({ format: 2, ...header, fragment: "shade.metal" }), "not in the pack"));
  assert.ok(has(pack({ format: 2, ...header }), "needs \"fragment\""));
  assert.ok(has(pack({ format: 1, ...header, fragment: "shade.metal" }, good), "needs \"format\": 2"));
  assert.ok(has(pack({ format: 2, ...header, fragment: "../x.metal" }, good), "inside the pack"));
  assert.ok(has(pack({ format: 2, ...header, fragment: "shade.js" }, good, "shade.js"), "must be a .metal file"));
  assert.ok(has(pack({ format: 2, ...header, fragment: 7 }, good), "must be the path of a .metal file"));
  assert.ok(has(pack({ format: 3, ...header }), "\"format\": 1 or 2"));
  assert.ok(has(pack({ format: 2, ...header, fragment: "shade.metal" }, Buffer.from([0x66, 0xff, 0xfe])), "is not text"));
  assert.ok(has(pack({ format: 2, ...header, fragment: "shade.metal" }, good + "//" + "x".repeat(SHADER_CODE.maxBytes)), "larger than 32 KB"));
  // A byte order mark is not ASCII, as in the app.
  assert.ok(has(pack({ format: 2, ...header, fragment: "shade.metal" }, "﻿" + good), "ASCII"));
  // Format 1 packs are as they were: numbers only.
  assert.deepEqual(pack({ format: 1, id: "com.example.num", name: "N", version: "1.0.0", base: "nebula" }), []);
  // In a subfolder too.
  assert.deepEqual(pack({ format: 2, ...header, fragment: "code/shade.metal" }, good, "code/shade.metal"), []);
});

test("the example pack validates, and .metal files are allowed in shader packs and Looks", () => {
  const { errors, header: h } = validatePack("shader", example, walk(example).files);
  assert.deepEqual(errors, []);
  assert.equal(h.id, "com.example.tide-pool");
  assert.ok(ALLOWED.shader.includes(".metal") && ALLOWED.look.includes(".metal"));
});
