// The plugin permissions of Atelier 1.2 and their rules (PluginManifest.swift, PluginWindows.swift
// and PluginShortcutPolicy in the app): shortcuts, window events and titles, moving windows, the
// HUD, sound events and app volume. Each case runs validate.mjs on a scratch catalog.
// Run: node --test scripts/test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PERMISSIONS, scanPermissions } from "../lib.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const modSchema = JSON.parse(readFileSync(join(repoRoot, "schema/mod.schema.json"), "utf8"));

/** Validates a copy of the Pomodoro plugin that asks for `permissions` and runs `script` too. */
function validate(permissions, script = "", manifestExtra = {}) {
  const root = mkdtempSync(join(tmpdir(), "atelier-permissions-"));
  try {
    mkdirSync(join(root, "mods"));
    const dir = join(root, "mods", "com.example.pomodoro");
    cpSync(join(repoRoot, "mods", "com.example.pomodoro"), dir, { recursive: true });
    const pkg = join(dir, "pomodoro.atelierplugin");
    const manifest = JSON.parse(readFileSync(join(pkg, "manifest.json"), "utf8"));
    writeFileSync(join(pkg, "manifest.json"), JSON.stringify({ ...manifest, ...manifestExtra, permissions: ["notifications", ...permissions] }));
    const mod = JSON.parse(readFileSync(join(dir, "mod.json"), "utf8"));
    writeFileSync(join(dir, "mod.json"), JSON.stringify({ ...mod, permissions: ["notifications", ...permissions] }));
    writeFileSync(join(pkg, "main.js"), readFileSync(join(pkg, "main.js"), "utf8") + "\n" + script + "\n");
    const r = spawnSync(process.execPath, [join(repoRoot, "scripts/validate.mjs"), "--root", root], { encoding: "utf8" });
    return { ok: r.status === 0, out: r.stdout + r.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the 1.2 permissions are known to the rules and the schema", () => {
  for (const p of ["shortcuts", "windows", "windowTitles", "windowControl", "hud", "audio", "audioControl"]) {
    assert.ok(PERMISSIONS.includes(p), p);
    assert.ok(modSchema.properties.permissions.items.enum.includes(p), p);
  }
  assert.equal(modSchema.properties.permissions.maxItems, 16);
});

test("the scan sees the new calls and events", () => {
  const used = (src) => [...scanPermissions(src).used].sort();
  assert.deepEqual(used('atelier.windows.tile("left"); atelier.workspaces.run("Desk");'), ["windowControl"]);
  assert.deepEqual(used('atelier.hud.show({ text: "Hi" });'), ["hud"]);
  assert.deepEqual(used('await atelier.audio.setAppVolume("com.apple.Music", 0.3);'), ["audioControl"]);
  assert.deepEqual(used('atelier.on("windowFocused", (e) => {});'), ["windows"]);
  assert.deepEqual(used("atelier.on('appQuit', f); atelier.on(`volumeChanged`, g);"), ["audio", "windows"]);
  // Other events need nothing, and a comment is not a call.
  assert.deepEqual(used('atelier.on("timer", f); // atelier.hud.show()'), []);
});

test("asking for a new permission passes when the script uses it", () => {
  for (const [permissions, script] of [
    [["windowControl"], 'atelier.command({ id: "tile", title: "Tile", run: () => atelier.windows.tile("left") });'],
    [["hud"], 'atelier.hud.show({ text: "Focus" });'],
    [["audioControl"], 'atelier.audio.setAppVolume("com.apple.Music", 0.3);'],
    [["windows"], 'atelier.on("windowMoved", () => {});'],
    [["windows", "windowTitles"], 'atelier.on("windowFocused", ({ title }) => {});'],
    [["audio"], 'atelier.on("outputChanged", () => {});'],
    [["shortcuts"], 'atelier.command({ id: "go", title: "Go", shortcut: "ctrl+opt+g", run: () => {} });'],
  ]) {
    const r = validate(permissions, script);
    assert.ok(r.ok, `${permissions}: ${r.out}`);
  }
});

test("using without asking, and asking without using, fail", () => {
  assert.match(validate([], 'atelier.hud.show({ text: "x" });').out, /calls atelier\.hud but does not ask for "hud"/);
  assert.match(validate([], 'atelier.on("appLaunched", f);').out, /does not ask for "windows"/);
  assert.match(validate([], 'atelier.audio.setAppVolume("a.b", 1);').out, /does not ask for "audioControl"/);
  assert.match(validate(["hud"]).out, /asks for "hud" but the script never uses it/);
  assert.match(validate(["audio"]).out, /asks for "audio" but the script never uses it/);
  // Titles come with window events only.
  const titles = validate(["windowTitles"]);
  assert.ok(!titles.ok);
  assert.match(titles.out, /windowTitles adds titles to window events: ask for windows too/);
});

test("activation events need their permission, and count as using it", () => {
  assert.match(validate([], "", { activation: ["onEvent:windowFocused"] }).out, /activation onEvent:windowFocused needs the windows permission/);
  assert.match(validate([], "", { activation: ["onEvent:volumeChanged"] }).out, /needs the audio permission/);
  const ok = validate(["windows"], "", { activation: ["onEvent:windowFocused"] });
  assert.ok(ok.ok, ok.out);
});

test("shortcuts: in the manifest or in code, at most eight, a warning without the permission", () => {
  const command = (i) => ({ id: `c${i}`, title: `C${i}`, shortcut: `ctrl+opt+${i}` });
  const listed = validate(["shortcuts"], "", { contributes: { commands: [command(1)] } });
  assert.ok(listed.ok, listed.out);
  const nine = validate(["shortcuts"], "", { contributes: { commands: Array.from({ length: 9 }, (_, i) => command(i)) } });
  assert.ok(!nine.ok);
  assert.match(nine.out, /at most 8 commands may have a shortcut/);
  const unasked = validate([], "", { contributes: { commands: [command(1)] } });
  assert.ok(unasked.ok, unasked.out);
  assert.match(unasked.out, /WARNING.*shortcuts are shown in Command only/);
  // The Pomodoro script gives its toggle command a shortcut in code; that counts as using it.
  const inCode = validate(["shortcuts"]);
  assert.ok(inCode.ok, inCode.out);
  assert.doesNotMatch(inCode.out, /shortcuts/);
});
