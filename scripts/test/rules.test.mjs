// Rule packs (.atelierrules): the same rules as AutomationRulePack.swift and AutomationJSON in
// the Atelier app. The cases mirror Tests/DockCoreTests/AutomationRulesTests.swift.
// Run: node --test scripts/test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePack, PACKS, ruleMinutes } from "../packs.mjs";
import { KINDS, ALLOWED, walk } from "../lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const example = join(here, "fixtures/meeting-mode.atelierrules");

/** A rule pack folder with `body` merged into a valid header; returns its errors. */
function errors(body) {
  const dir = mkdtempSync(join(tmpdir(), "rules-"));
  try {
    writeFileSync(join(dir, "atelier-rules.json"), JSON.stringify({ format: 1, id: "com.example.quiet", name: "Quiet", version: "1.0.0", ...body }));
    return validatePack("rules", dir, walk(dir).files).errors;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const locked = { type: "screen", state: "locked" };
const pause = { type: "pauseLiveWallpaper" };
const rule = (r) => errors({ rules: [{ name: "x", when: [locked], do: [pause], ...r }] });
const has = (list, text) => list.some((e) => e.includes(text));

test("rules is a pack kind in the catalog", () => {
  assert.equal(PACKS.rules.ext, ".atelierrules");
  assert.equal(PACKS.rules.manifest, "atelier-rules.json");
  assert.equal(KINDS.rules.ext, ".atelierrules");
  assert.equal(KINDS.rules.maxZip, 256 * 1024);
  assert.ok(KINDS.rules.pack && KINDS.rules.folder === "mods");
  assert.deepEqual(ALLOWED.rules, [".json", ".md", ".txt"]);
});

test("the example pack and every trigger and action validate", () => {
  const { errors: problems, header } = validatePack("rules", example, walk(example).files);
  assert.deepEqual(problems, []);
  assert.equal(header.id, "com.example.meeting-mode");
  assert.deepEqual(errors({
    rules: [{
      name: "Work", match: "any", undo: false, "x-note": "ignored",
      when: [
        { type: "time", from: "09:00", to: "17:30", days: ["mon", "FRI"] },
        { type: "display", display: "LG", state: "connected" }, { type: "display", state: "disconnected" },
        { type: "wifi", ssid: "Office", state: "joined" }, { type: "lowPower", state: "on" },
        { type: "app", app: "us.zoom.xos", state: "front" }, { type: "power", state: "battery" },
        { type: "appearance", state: "dark" },
      ],
      do: [
        { type: "look", look: "net.dasantos.look.paper" }, { type: "eq", preset: "off" }, { type: "eq", preset: "bassBoost" },
        { type: "notify", title: "Hello" }, { type: "xdrBoost", state: "on" }, pause, { type: "typingSounds", state: "off" },
        { type: "dockProfile", profile: "Work" }, { type: "workspace", workspace: "Desk" }, { type: "liveWallpaper", shader: "starfield" },
        { type: "screenSaverScene", scene: "com.example.paper-lanterns" }, { type: "audioOutput", device: "AirPods" },
      ],
    }, { name: "Late", when: [{ type: "time", from: "22:00", to: "24:00" }], do: [{ type: "shortcut", name: "Wind down" }] }],
  }), []);
});

test("bad rules, triggers and actions are refused", () => {
  assert.ok(has(errors({ rules: [] }), "one or more rules"));
  assert.ok(has(errors({ rules: [], script: "x" }), "unknown key \"script\""));
  assert.ok(has(rule({ do: [{ type: "run", path: "/bin/sh" }] }), "is not an action"));
  assert.ok(has(rule({ id: "1" }), "set by Atelier"));
  assert.ok(has(rule({ enabled: true }), "set by Atelier"));
  assert.ok(has(rule({ pack: "com.x" }), "set by Atelier"));
  assert.ok(has(errors({ rules: Array(21).fill({ name: "x", when: [locked], do: [pause] }) }), "the limit is 20"));
  assert.ok(has(rule({ when: [{ type: "geofence" }] }), "is not a trigger"));
  assert.ok(has(rule({ do: [{ type: "shell", cmd: "rm" }] }), "is not an action"));
  assert.ok(has(rule({ when: [{ type: "focus" }] }), "Focus is not a trigger"));
  assert.ok(has(rule({ when: [{ type: "screen", state: "maybe" }] }), "must be one of"));
  assert.ok(has(rule({ when: [{ type: "app", app: "zoom", state: "front" }] }), "bundle identifier"));
  assert.ok(has(rule({ when: [{ type: "time", from: "9am", to: "25:00" }] }), "time like"));
  assert.ok(has(rule({ when: [{ ...locked, extra: 1 }] }), "unknown key"));
  assert.ok(has(rule({ when: [] }), "one or more triggers"));
  assert.ok(has(rule({ do: [] }), "one or more actions"));
  assert.ok(has(rule({ name: "" }), "needs a \"name\""));
  assert.ok(has(rule({ name: "n".repeat(61) }), "needs a \"name\""));
  assert.ok(has(rule({ do: [{ type: "eq", preset: "custom" }] }), "preset must be"));
  assert.ok(has(rule({ do: [{ type: "look", look: "../../etc" }] }), "identifier"));
  assert.ok(has(rule({ do: Array(13).fill(pause) }), "the limit is 12"));
  assert.ok(has(rule({ when: Array(9).fill(locked) }), "the limit is 8"));
  assert.ok(has(rule({ match: "some" }), "match must be"));
  assert.ok(has(rule({ undo: "yes" }), "undo must be true or false"));
  assert.ok(has(rule({ when: [{ type: "wifi", ssid: "x".repeat(33), state: "joined" }] }), "32 bytes"));
  assert.ok(has(rule({ when: [{ type: "wifi", ssid: "  ", state: "joined" }] }), "must not be empty"));
  assert.ok(has(rule({ when: [{ type: "time", from: "09:00", to: "10:00", days: ["someday"] }] }), "days must list"));
  assert.ok(has(rule({ when: [{ type: "time", from: "09:00", to: "10:00", days: "mon" }] }), "days must be a list"));
  assert.ok(has(rule({ do: [{ type: "notify", title: "t".repeat(201) }] }), "longer than 200"));
  assert.ok(has(rule({ do: [{ type: "notify", body: "b" }] }), "needs \"title\""));
  assert.ok(has(rule({ do: [{ type: "dockProfile", profile: 3 }] }), "must be text"));
  assert.ok(has(rule({ do: [pause, { type: "pauseLiveWallpaper", seconds: 3 }] }), "unknown key \"seconds\""));
  assert.ok(has(rule({ when: [{ state: "locked" }] }), "needs a \"type\""));
  assert.ok(has(errors({ rules: ["x"] }), "must be an object"));
  assert.ok(has(errors({ format: 2, rules: [{ name: "x", when: [locked], do: [pause] }] }), "needs \"format\": 1."));
});

test("times read as the app reads them", () => {
  assert.equal(ruleMinutes("09:00"), 540);
  assert.equal(ruleMinutes("9:30"), 570);
  assert.equal(ruleMinutes("24:00"), 1440);
  for (const bad of ["24:01", "25:00", "09:60", "9am", "09:0", "009:00", "09:00:00", ":00"]) assert.equal(ruleMinutes(bad), null, bad);
});
