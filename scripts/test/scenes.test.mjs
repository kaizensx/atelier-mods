// Screen saver scenes: the catalog applies the same rules as ScreenSaverScene.swift in the app.
// Run: node --test scripts/test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePack, PACKS } from "../packs.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../..");
const picture = join(repo, "mods/com.example.paper-lanterns/paper-lanterns.atelierscene/lanterns.jpg");

/** Writes a scene folder with `body` merged into a valid header, plus extra files, and checks it. */
function check(body, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "scene-"));
  try {
    const manifest = { format: 1, id: "com.example.scene", name: "Scene", version: "1.0.0", ...body };
    writeFileSync(join(dir, "atelier-scene.json"), JSON.stringify(manifest));
    for (const [path, source] of Object.entries(extra)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      if (source === "picture") copyFileSync(picture, join(dir, path));
      else writeFileSync(join(dir, path), source);
    }
    const files = [];
    const walk = (d) => {
      for (const name of ["atelier-scene.json", ...Object.keys(extra)]) {
        const full = join(d, name);
        files.push({ path: relative(d, full), full, size: statSync(full).size });
      }
    };
    walk(dir);
    return validatePack("scene", dir, files).errors;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const color = { background: { kind: "color", colors: ["#101418"] } };
const has = (errors, text) => errors.some((e) => e.includes(text));

test("scene is a pack kind", () => {
  assert.equal(PACKS.scene.ext, ".atelierscene");
  assert.equal(PACKS.scene.manifest, "atelier-scene.json");
});

test("valid scenes pass", () => {
  assert.deepEqual(check({
    background: { kind: "shader", shader: "nebula", palette: ["#000", "#111111", "#22222280", "#333"], speed: 0.6 },
    layers: [
      { kind: "clock", style: "flip", position: "center", size: 0.3, seconds: true, date: false, font: "mono" },
      { kind: "weather", units: "imperial" }, { kind: "nowPlaying" }, { kind: "calendar", count: 5 },
      { kind: "widgets", ids: ["calendar"] }, { kind: "quote", source: "bundled" }, { kind: "text", text: "Hi" }, { kind: "vitals" },
    ],
    accent: "#E08BB5", dim: 0.8, burnInShift: false, fadeIn: 2,
  }), []);
  assert.deepEqual(check({ background: { kind: "image", file: "bg.jpg" } }, { "bg.jpg": "picture" }), []);
  assert.deepEqual(check({ background: { kind: "photos", source: "bundled" } }, { "photos/a.jpg": "picture" }), []);
  assert.deepEqual(check({ background: { kind: "photos", source: "pictures" } }), []);
  assert.deepEqual(check(color, { "README.md": "notes" }), []);
});

test("limits", () => {
  assert.ok(has(check({ ...color, layers: Array(13).fill({ kind: "vitals" }) }), "13 layers"));
  assert.ok(has(check({ ...color, dim: 0.9 }), "dim must be between"));
  assert.ok(has(check({ ...color, fadeIn: 11 }), "fadeIn must be between"));
  assert.ok(has(check({ ...color, layers: [{ kind: "clock", size: 0 }] }), "size must be between"));
  assert.ok(has(check({ ...color, layers: [{ kind: "calendar", count: 9 }] }), "count must be a whole number"));
  assert.ok(has(check({ ...color, layers: [{ kind: "text", text: "a".repeat(281) }] }), "1 to 280 characters"));
  assert.ok(has(check({ ...color, layers: [{ kind: "widgets", ids: Array.from({ length: 9 }, (_, i) => `w${i}`) }] }), "at most 8"));
  assert.ok(has(check({ background: { kind: "color", colors: Array(7).fill("#fff") } }), "1 to 6 colours"));
});

test("bad colours, unknown kinds and keys", () => {
  assert.ok(has(check({ background: { kind: "color", colors: ["red"] } }), "colors[0] must be a colour"));
  assert.ok(has(check({ ...color, accent: "orange" }), "\"accent\" must be a colour"));
  assert.ok(has(check({ background: { kind: "shader", shader: "nebula", palette: ["#000", "#111", "#222"] } }), "four colours"));
  assert.ok(has(check({ ...color, layers: [{ kind: "browser" }] }), "kind must be one of"));
  assert.ok(has(check({ ...color, layers: [{ kind: "clock", script: "x" }] }), "unknown key \"script\""));
  assert.ok(has(check({ background: { kind: "video" } }), "background.kind must be"));
  assert.ok(has(check({ ...color, script: "run.js" }), "unknown key \"script\""));
  assert.ok(has(check({ background: { kind: "shader", shader: "wallpaperRain" } }), "draws over your own wallpaper"));
  assert.ok(has(check({ ...color, layers: [{ kind: "quote", source: "https://example.com" }] }), "source must be bundled"));
});

test("paths stay inside the scene", () => {
  for (const file of ["../bg.jpg", "/etc/bg.jpg", "~/bg.jpg", ".hidden.jpg"]) {
    assert.ok(has(check({ background: { kind: "image", file } }, { "bg.jpg": "picture" }), "is not a path inside the pack"), file);
  }
  for (const folder of ["/Users/x/Pictures", "~/Pictures"]) {
    assert.ok(has(check({ background: { kind: "photos", source: "folder", folder } }), "outside the scene"), folder);
  }
  assert.ok(has(check({ background: { kind: "photos", source: "bundled", folder: "../photos" } }), "not a folder inside the scene"));
  assert.ok(has(check({ ...color, layers: [{ kind: "widgets", ids: ["../../x"] }] }), "must be a widget id"));
  assert.ok(has(check({ background: { kind: "image", file: "bg.jpg" } }, { "bg.jpg": "#!/bin/sh\n" }), "not really a .jpg"));
  assert.ok(has(check(color, { "run.sh": "#!/bin/sh\n" }), "run.sh is not a PNG"));
  assert.ok(has(check(color, {}).concat(check({ ...color, id: "net.dasantos.atelier.scene.x" })), "Atelier's own scenes"));
});
