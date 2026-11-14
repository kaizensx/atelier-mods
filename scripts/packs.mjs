// Data-only packs: icon packs, sound packs, shader packs, layout packs, effect packs, Looks,
// screen saver scenes and rule packs. The same rules as Sources/DockCore/ModPacks.swift,
// ScreenSaverScene.swift, ShaderCode.swift and AutomationRules.swift in the Atelier app
// (docs/PACKS.md, docs/SCREENSAVER.md there). Change both together. Nothing in a pack runs in the
// catalog; every file is checked by its own bytes, and a shader pack's Metal code by the same
// whitelist Atelier applies before Metal sees it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkSchema } from "./lib.mjs";

export const PACKS = {
  icons: { ext: ".ateliericons", manifest: "atelier-icons.json", maxZip: 60 * 1024 * 1024 },
  sounds: { ext: ".ateliersounds", manifest: "atelier-sounds.json", maxZip: 20 * 1024 * 1024 },
  shader: { ext: ".ateliershader", manifest: "atelier-shader.json", maxZip: 1024 * 1024 },
  layouts: { ext: ".atelierlayouts", manifest: "atelier-layouts.json", maxZip: 256 * 1024 },
  effects: { ext: ".ateliereffects", manifest: "atelier-effects.json", maxZip: 256 * 1024 },
  look: { ext: ".atelierlook", manifest: "atelier-look.json", maxZip: 80 * 1024 * 1024 },
  scene: { ext: ".atelierscene", manifest: "atelier-scene.json", maxZip: 40 * 1024 * 1024 },
  rules: { ext: ".atelierrules", manifest: "atelier-rules.json", maxZip: 256 * 1024 },
};

// The largest folder on disk, whatever its zip was: ModPackKind.maxBundleBytes in the app.
const MB = 1024 * 1024;
export const BUNDLE_BYTES = { icons: 150 * MB, sounds: 40 * MB, shader: MB, layouts: MB, effects: MB, look: 200 * MB, scene: 60 * MB, rules: MB };
// The manifest formats each kind reads. Format 2 shader packs may carry a fragment shader.
export const PACK_FORMATS = { shader: [1, 2] };

export const PACK_LIMITS = {
  manifest: 256 * 1024, icons: 600, iconBytes: 1024 * 1024, iconPixels: 256, soundBytes: 1024 * 1024,
  uiSeconds: 2, typingSeconds: 1, typingVariants: 8, layouts: 24, zones: 12, zoneSide: 0.05,
  effects: 12, keyframes: 16, wallpaperBytes: 20 * 1024 * 1024, wallpaperPixels: 512,
};

// Screen saver scenes: the same limits as ScreenSaverSceneLimits in the app.
export const SCENE_LIMITS = {
  layers: 12, fileBytes: 20 * 1024 * 1024, bundleBytes: 60 * 1024 * 1024, text: 280, colors: 6, widgets: 8,
  calendar: [1, 8], photos: 60, dim: [0, 0.8], fadeIn: [0, 10], size: [0.05, 1], interval: [4, 600], speed: [0.2, 2.5], imagePixels: 512,
  // A shader background's live wallpaper options.
  intensity: [0, 1], grain: [0, 1], scale: [0.6, 1.8], shaderDim: [0, 0.7], timelapse: [1, 1440], every: [20, 3600], tour: 40,
};
export const SCENE_POSITIONS = ["center", "top", "bottom", "leading", "trailing", "topLeading", "topTrailing", "bottomLeading", "bottomTrailing"];
export const SCENE_LAYERS = {
  clock: ["style", "seconds", "date", "font", "color"], weather: ["units"], nowPlaying: [], calendar: ["count"],
  widgets: ["ids"], quote: ["source"], text: ["text"], vitals: [], plugin: ["plugin", "view"],
};
export const CLOCK_STYLES = ["digital", "flip", "analog", "word", "minimal"];
export const SCENE_FONTS = ["system", "rounded", "serif", "mono"];
const BUILT_IN_SCENE = "net.dasantos.atelier.scene.";
// Shaders that draw over the owner's own wallpaper: the owner's own scenes only, never a pack.
const WALLPAPER_SHADERS = ["wallpaperRain", "wallpaperRipple", "wallpaperDepth"];
// "desktop" plays what Live Wallpaper shows; "weather" follows the weather in live.json.
const SCENE_SHADERS = ["desktop", "weather"];
const CYCLES = ["clock", "day", "dusk", "night"];

export const SHADER_BASES = ["liquidLight", "nebula", "auroraSilk", "topography", "glassRain", "silkWaves", "gradientMesh",
  "starfield", "retroHorizon", "oceanCaustics", "northernLights", "lavaLamp", "inkInWater", "fireflies", "liquidChrome"];
export const SOUND_SLOTS = ["dock.launch", "dock.drop", "dock.trash", "dock.minimize", "timer.done", "theme.apply"];
export const TYPING_SLOTS = ["key", "space", "return", "backspace", "modifier"];
export const EFFECT_BASES = ["genie", "scale", "suck", "lamp", "fold", "dissolve", "portal", "shatter", "liquid"];
export const CURVES = ["linear", "easeIn", "easeOut", "easeInOut", "spring"];
const SPECIAL_ICONS = ["folder", "downloads", "trash", "trash.full"];

// --- Reading files by their bytes ---------------------------------------------------------

const ascii = (buf, a, b) => (buf.length >= b ? buf.subarray(a, b).toString("latin1") : "");

/** The real format of a file, from its first bytes. */
export function sniff(buf) {
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0x89504e47) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (ascii(buf, 0, 4) === "icns") return "icns";
  if (ascii(buf, 0, 4) === "caff") return "caf";
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WAVE") return "wav";
  if (ascii(buf, 4, 8) === "ftyp") {
    const brand = ascii(buf, 8, 12);
    if (["heic", "heix", "mif1", "msf1", "heim", "heis", "hevc", "hevx"].includes(brand)) return "heic";
    if (["M4A ", "M4B ", "mp42", "isom", "mp41"].includes(brand)) return "m4a";
  }
  const first = [...buf.subarray(0, 64)].find((b) => ![0x20, 0x09, 0x0a, 0x0d, 0xef, 0xbb, 0xbf].includes(b));
  if (first === 0x7b) return "json";
  return "other";
}

const EXTENSIONS = { png: [".png"], heic: [".heic", ".heif"], icns: [".icns"], jpeg: [".jpg", ".jpeg"], wav: [".wav"], caf: [".caf"], m4a: [".m4a"], json: [".json"] };

/** The shorter side of the largest picture in a PNG, JPEG, ICNS or HEIC. */
export function pixels(buf, format) {
  if (format === "png") return Math.min(buf.readUInt32BE(16), buf.readUInt32BE(20));
  if (format === "jpeg") {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return Math.min(buf.readUInt16BE(i + 5), buf.readUInt16BE(i + 7));
      i += 2 + len;
    }
    return null;
  }
  if (format === "icns") {
    // Each element: a 4-byte type and a 4-byte length. Sizes by type; PNG elements are read.
    const sizes = { ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512, it32: 128, ih32: 48, il32: 32, is32: 16 };
    let best = 0, i = 8;
    while (i + 8 <= buf.length) {
      const type = ascii(buf, i, i + 4), len = buf.readUInt32BE(i + 4);
      if (len < 8) break;
      const body = buf.subarray(i + 8, i + len);
      const inner = body.length > 24 && body.readUInt32BE(0) === 0x89504e47 ? Math.min(body.readUInt32BE(16), body.readUInt32BE(20)) : sizes[type] ?? 0;
      best = Math.max(best, inner);
      i += len;
    }
    return best || null;
  }
  if (format === "heic") {
    // The largest 'ispe' (image spatial extents) property: version/flags, width, height.
    let best = 0, i = buf.indexOf("ispe", 0, "latin1");
    while (i >= 0 && i + 16 <= buf.length) {
      best = Math.max(best, Math.min(buf.readUInt32BE(i + 8), buf.readUInt32BE(i + 12)));
      i = buf.indexOf("ispe", i + 4, "latin1");
    }
    return best || null;
  }
  return null;
}

/** A sound's length in seconds, from its headers: WAV, CAF or M4A. */
export function seconds(buf, format) {
  if (format === "wav") {
    let i = 12, byteRate = 0;
    while (i + 8 <= buf.length) {
      const id = ascii(buf, i, i + 4), len = buf.readUInt32LE(i + 4);
      if (id === "fmt ") byteRate = buf.readUInt32LE(i + 16);
      if (id === "data") return byteRate ? len / byteRate : null;
      i += 8 + len + (len % 2);
    }
    return null;
  }
  if (format === "caf") {
    let i = 8, rate = 0, bytesPerPacket = 0, framesPerPacket = 0, frames = null;
    while (i + 12 <= buf.length) {
      const id = ascii(buf, i, i + 4), len = Number(buf.readBigInt64BE(i + 4));
      const body = i + 12;
      if (id === "desc") { rate = buf.readDoubleBE(body); bytesPerPacket = buf.readUInt32BE(body + 16); framesPerPacket = buf.readUInt32BE(body + 20); }
      if (id === "pakt") frames = Number(buf.readBigInt64BE(body + 8));
      if (id === "data") {
        const size = len === -1 ? buf.length - body - 4 : len - 4;
        if (frames === null && bytesPerPacket && framesPerPacket) frames = (size / bytesPerPacket) * framesPerPacket;
        break;
      }
      if (len < 0) break;
      i = body + len;
    }
    return rate && frames !== null ? frames / rate : null;
  }
  if (format === "m4a") {
    const i = buf.indexOf("mvhd", 0, "latin1");
    if (i < 0) return null;
    const version = buf[i + 4];
    if (version === 1) return Number(buf.readBigUInt64BE(i + 4 + 4 + 16 + 4)) / buf.readUInt32BE(i + 4 + 4 + 16);
    const timescale = buf.readUInt32BE(i + 4 + 4 + 8), duration = buf.readUInt32BE(i + 4 + 4 + 12);
    return timescale ? duration / timescale : null;
  }
  return null;
}

// --- The rules ----------------------------------------------------------------------------

const isReverseDNS = (id) => typeof id === "string" && id.length >= 3 && id.length <= 120 &&
  id.split(".").length >= 2 && id.split(".").every((p) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(p) && !p.endsWith("-"));
const isBundleID = (id) => typeof id === "string" && id.length >= 3 && id.length <= 155 &&
  id.split(".").length >= 2 && id.split(".").every((p) => /^[A-Za-z0-9_-]+$/.test(p));
const isSafePath = (p) => typeof p === "string" && p.length > 0 && p.length <= 200 && !p.startsWith("/") && !p.startsWith("~") &&
  !p.includes("\\") && !p.includes("\0") && p.split("/").every((x) => x && x !== "." && x !== ".." && !x.startsWith("."));
const num = (v) => typeof v === "number" && Number.isFinite(v);
// ThemeColor(hex:) in the app: #RGB, #RRGGBB or #RRGGBBAA, spaces around it ignored.
const COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const isColor = (c) => typeof c === "string" && COLOR.test(c.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, ""));
const HEADER = ["format", "id", "name", "version", "author", "description"];

/**
 * Checks one pack folder. `files` are its regular files ({ path, full, size }) relative to it.
 * Returns { errors, header } where header is { id, name, version } when it could be read.
 */
export function validatePack(kind, dir, files, themeSchema) {
  const errors = [];
  const facts = new Map();
  for (const f of files) {
    const buf = readFileSync(f.full);
    const format = sniff(buf);
    const fact = { size: f.size, format };
    if (["png", "jpeg", "icns", "heic"].includes(format)) fact.pixels = pixels(buf, format);
    if (["wav", "caf", "m4a"].includes(format)) fact.seconds = seconds(buf, format);
    facts.set(f.path, fact);
  }
  const header = check(kind, "", facts, (p) => readFileSync(join(dir, p)), errors, themeSchema);
  return { errors, header };
}

function check(kind, prefix, facts, read, errors, themeSchema) {
  const spec = PACKS[kind];
  const at = (p) => (prefix ? `${prefix}/${p}` : p);
  const err = (m) => errors.push(prefix ? `${prefix}: ${m}` : m);
  const fact = facts.get(at(spec.manifest));
  if (!fact) { err(`${spec.manifest} is missing.`); return null; }
  if (fact.size > PACK_LIMITS.manifest) { err(`${spec.manifest} is larger than 256 KB.`); return null; }
  let root;
  try { root = JSON.parse(read(at(spec.manifest)).toString("utf8")); } catch (e) { err(`${spec.manifest} is not valid JSON: ${e.message}`); return null; }
  if (!root || typeof root !== "object" || Array.isArray(root)) { err(`${spec.manifest} is not a JSON object.`); return null; }

  const allowed = { icons: ["icons"], sounds: ["sounds", "typing"],
    shader: ["base", "palette", "speed", "intensity", "grain", "scale", "dim", "cycle", "pointer", "fragment"],
    layouts: ["layouts"], effects: ["effects"], look: ["theme", "wallpaper", "dock", "iconPack", "soundPack"],
    scene: ["background", "layers", "accent", "dim", "burnInShift", "fadeIn"], rules: ["rules"] }[kind];
  for (const key of Object.keys(root)) if (!HEADER.includes(key) && !allowed.includes(key) && !key.startsWith("x-")) err(`${spec.manifest}: unknown key "${key}".`);
  const formats = PACK_FORMATS[kind] ?? [1];
  if (!formats.includes(root.format)) err(`${spec.manifest} needs "format": ${formats.join(" or ")}.`);
  if (!isReverseDNS(root.id)) err(`${spec.manifest} needs a reverse-DNS "id".`);
  if (typeof root.version !== "string" || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(root.version)) err(`${spec.manifest} needs a "version" like 1.0.0.`);
  if (typeof root.name !== "string" || !root.name.trim() || root.name.length > 60) err(`${spec.manifest} needs a "name" of 1 to 60 characters.`);
  if (root.description !== undefined && (typeof root.description !== "string" || root.description.length > 400)) err("description must be text of at most 400 characters.");
  if (typeof root.author === "string" && [...root.author].length > 80) err(`${spec.manifest}: the author is longer than 80 characters.`);
  if (!prefix && kind !== "scene") {
    const total = [...facts.values()].reduce((sum, f) => sum + f.size, 0);
    if (total > BUNDLE_BYTES[kind]) err(`The pack is ${Math.floor(total / MB)} MB; the limit is ${BUNDLE_BYTES[kind] / MB} MB.`);
  }

  const file = (path, label, formats) => {
    if (!isSafePath(path)) { err(`${label}: "${path}" is not a path inside the pack.`); return null; }
    const f = facts.get(at(path));
    if (!f) { err(`${label}: ${path} is not in the pack.`); return null; }
    const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
    if (!(EXTENSIONS[f.format] ?? []).includes(ext)) { err(`${label}: ${path} is not really a ${ext} file.`); return null; }
    if (formats && !formats.includes(f.format)) { err(`${label}: ${path} must be ${formats.join(", ").toUpperCase()}.`); return null; }
    return f;
  };
  const range = (v, lo, hi, label) => {
    if (v === undefined) return;
    if (!num(v)) err(`${label} must be a number.`);
    else if (v < lo || v > hi) err(`${label} must be between ${lo} and ${hi}.`);
  };
  // A format 2 shader pack's code: a .metal file inside the pack, checked as ShaderCode.validate does.
  const fragment = (path) => {
    if (!isSafePath(path) || !path.toLowerCase().endsWith(".metal")) return err(`fragment: "${path}" must be a .metal file inside the pack.`);
    const f = facts.get(at(path));
    if (!f) return err(`fragment: ${path} is not in the pack.`);
    if (f.size > SHADER_CODE.maxBytes) return err(`fragment: ${path} is larger than ${SHADER_CODE.maxBytes / 1024} KB.`);
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(read(at(path))); } catch { return err(`fragment: ${path} is not text.`); }
    for (const problem of validateShaderCode(text) ?? []) err(`${path} ${problem.description}.`);
  };
  const sound = (path, label, limit) => {
    const f = file(path, label, ["wav", "caf", "m4a"]);
    if (!f) return;
    if (f.size > PACK_LIMITS.soundBytes) err(`${label}: ${path} is larger than 1 MB.`);
    else if (!(f.seconds > 0)) err(`${label}: ${path} could not be read as a sound.`);
    else if (f.seconds > limit + 0.01) err(`${label}: ${path} is ${f.seconds.toFixed(2)} s; the limit is ${limit} s.`);
  };

  if (kind === "icons") {
    const icons = root.icons;
    if (!icons || typeof icons !== "object" || Array.isArray(icons) || !Object.keys(icons).length) err("\"icons\" must map bundle identifiers to pictures.");
    else {
      if (Object.keys(icons).length > PACK_LIMITS.icons) err(`The pack has ${Object.keys(icons).length} icons; the limit is 600.`);
      for (const [key, path] of Object.entries(icons)) {
        if (!SPECIAL_ICONS.includes(key) && !isBundleID(key)) { err(`icons: "${key}" is not a bundle identifier or one of ${SPECIAL_ICONS.join(", ")}.`); continue; }
        const f = file(path, `icons.${key}`, ["png", "heic", "icns"]);
        if (!f) continue;
        if (f.size > PACK_LIMITS.iconBytes) err(`icons.${key}: ${path} is larger than 1 MB.`);
        if (!f.pixels) err(`icons.${key}: ${path} could not be read as a picture.`);
        else if (f.pixels < PACK_LIMITS.iconPixels) err(`icons.${key}: ${path} is ${f.pixels} px; icons need at least 256 px.`);
      }
    }
  }
  if (kind === "sounds") {
    let any = false;
    if (root.sounds !== undefined) {
      if (!root.sounds || typeof root.sounds !== "object" || Array.isArray(root.sounds)) err("\"sounds\" must be an object.");
      else for (const [slot, path] of Object.entries(root.sounds)) {
        any = true;
        if (!SOUND_SLOTS.includes(slot)) err(`sounds: "${slot}" is not a sound Atelier plays. Use ${SOUND_SLOTS.join(", ")}.`);
        else sound(path, `sounds.${slot}`, PACK_LIMITS.uiSeconds);
      }
    }
    if (root.typing !== undefined) {
      if (!root.typing || typeof root.typing !== "object" || Array.isArray(root.typing)) err("\"typing\" must be an object.");
      else {
        for (const [slot, list] of Object.entries(root.typing)) {
          any = true;
          if (!TYPING_SLOTS.includes(slot)) { err(`typing: "${slot}" is not a key class. Use ${TYPING_SLOTS.join(", ")}.`); continue; }
          if (!Array.isArray(list) || list.length < 1 || list.length > PACK_LIMITS.typingVariants) { err(`typing.${slot} must list 1 to 8 sounds.`); continue; }
          list.forEach((path, i) => sound(path, `typing.${slot}[${i}]`, PACK_LIMITS.typingSeconds));
        }
        if (!("key" in root.typing)) err("typing needs at least \"key\"; the other classes fall back to it.");
      }
    }
    if (!any) err("The pack has no sounds.");
  }
  if (kind === "shader") {
    if (!SHADER_BASES.includes(root.base)) err(`"base" must be one of ${SHADER_BASES.join(", ")}.`);
    if (root.palette !== undefined && !(Array.isArray(root.palette) && root.palette.length === 4 && root.palette.every(isColor))) {
      err("\"palette\" must be four colours like \"#1B2A55\", darkest first.");
    }
    range(root.speed, 0.2, 2.5, "speed"); range(root.intensity, 0, 1, "intensity"); range(root.grain, 0, 1, "grain");
    range(root.scale, 0.6, 1.8, "scale"); range(root.dim, 0, 0.7, "dim");
    if (root.cycle !== undefined && !["clock", "day", "dusk", "night"].includes(root.cycle)) err("\"cycle\" must be one of clock, day, dusk, night.");
    if (root.pointer !== undefined && typeof root.pointer !== "boolean") err("\"pointer\" must be true or false.");
    if (root.fragment !== undefined) {
      if (root.format !== 2) err("\"fragment\" needs \"format\": 2.");
      else if (typeof root.fragment !== "string") err("\"fragment\" must be the path of a .metal file in the pack.");
      else fragment(root.fragment);
    } else if (root.format === 2) err("A format 2 shader pack needs \"fragment\": the path of its .metal file.");
  }
  if (kind === "layouts") {
    const list = root.layouts;
    if (!Array.isArray(list) || !list.length) err("\"layouts\" must list at least one layout.");
    else {
      if (list.length > PACK_LIMITS.layouts) err(`The pack has ${list.length} layouts; the limit is 24.`);
      list.slice(0, PACK_LIMITS.layouts).forEach((l, i) => {
        if (!l || typeof l !== "object") return err(`layouts[${i}] must be an object.`);
        for (const key of Object.keys(l)) if (!["name", "zones"].includes(key)) err(`layouts[${i}]: unknown key "${key}".`);
        if (typeof l.name !== "string" || !l.name.trim() || l.name.length > 40) err(`layouts[${i}] needs a name of 1 to 40 characters.`);
        if (!Array.isArray(l.zones) || l.zones.length < 1 || l.zones.length > PACK_LIMITS.zones) return err(`layouts[${i}] needs 1 to 12 zones.`);
        const seen = new Set();
        l.zones.forEach((z, j) => {
          const label = `layouts[${i}].zones[${j}]`;
          if (!z || Object.keys(z).sort().join() !== "height,width,x,y" || ![z.x, z.y, z.width, z.height].every(num)) return err(`${label} must be {"x", "y", "width", "height"}.`);
          if (z.x < 0 || z.y < 0 || z.x > 1 || z.y > 1) return err(`${label} starts outside 0…1.`);
          if (z.width < PACK_LIMITS.zoneSide || z.height < PACK_LIMITS.zoneSide) return err(`${label} is narrower or shorter than 0.05.`);
          if (z.x + z.width > 1.0001 || z.y + z.height > 1.0001) return err(`${label} reaches past the edge of the screen.`);
          const key = `${z.x},${z.y},${z.width},${z.height}`;
          if (seen.has(key)) err(`${label} repeats another zone.`);
          seen.add(key);
        });
      });
    }
  }
  if (kind === "effects") {
    const list = root.effects;
    if (!Array.isArray(list) || !list.length) err("\"effects\" must list at least one effect.");
    else {
      if (list.length > PACK_LIMITS.effects) err(`The pack has ${list.length} effects; the limit is 12.`);
      const ids = new Set();
      list.slice(0, PACK_LIMITS.effects).forEach((e, i) => {
        const label = `effects[${i}]`;
        if (!e || typeof e !== "object") return err(`${label} must be an object.`);
        for (const key of Object.keys(e)) if (!["id", "name", "base", "duration", "curve", "opacity", "scale", "blur", "shade", "twist", "wave"].includes(key)) err(`${label}: unknown key "${key}".`);
        if (typeof e.id !== "string" || !/^[A-Za-z0-9-]{1,40}$/.test(e.id)) err(`${label} needs an "id" of letters, digits and hyphens.`);
        else if (ids.has(e.id)) err(`${label}: the id "${e.id}" is used twice.`);
        else ids.add(e.id);
        if (typeof e.name !== "string" || !e.name.trim() || e.name.length > 40) err(`${label} needs a name of 1 to 40 characters.`);
        if (!EFFECT_BASES.includes(e.base)) err(`${label}.base must be one of ${EFFECT_BASES.join(", ")}.`);
        if (e.duration === undefined) err(`${label}.duration is required, in seconds (0.15 to 1.2).`);
        else range(e.duration, 0.15, 1.2, `${label}.duration`);
        if (e.curve !== undefined && !CURVES.includes(e.curve)) err(`${label}.curve must be one of ${CURVES.join(", ")}.`);
        for (const [track, lo, hi, rest] of [["opacity", 0, 1, 1], ["scale", 0.05, 3, 1], ["blur", 0, 8, 0], ["shade", 0, 2, 1]]) {
          const frames = e[track];
          if (frames === undefined) continue;
          const t = `${label}.${track}`;
          if (!Array.isArray(frames) || frames.length < 2 || frames.length > PACK_LIMITS.keyframes) { err(`${t} must list 2 to 16 [t, value] pairs.`); continue; }
          let last = -1, bad = false;
          for (const [k, pair] of frames.entries()) {
            if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(num)) { err(`${t}[${k}] must be [t, value].`); bad = true; break; }
            if (pair[0] < 0 || pair[0] > 1) { err(`${t}[${k}]: t must be between 0 and 1.`); bad = true; break; }
            if (pair[1] < lo || pair[1] > hi) { err(`${t}[${k}]: the value must be between ${lo} and ${hi}.`); bad = true; break; }
            if (pair[0] <= last) { err(`${t}: t must increase from one point to the next.`); bad = true; break; }
            last = pair[0];
          }
          if (bad) continue;
          if (frames[0][0] !== 0 || frames.at(-1)[0] !== 1) err(`${t} must start at t 0 and end at t 1.`);
          else if (frames[0][1] !== rest) err(`${t} must start at ${rest}, so the first frame is the window itself.`);
        }
        range(e.twist, -720, 720, `${label}.twist`);
        if (e.wave !== undefined) {
          if (!e.wave || typeof e.wave !== "object" || Object.keys(e.wave).some((k) => !["amplitude", "frequency"].includes(k))) err(`${label}.wave must be {"amplitude", "frequency"}.`);
          else { range(e.wave.amplitude, 0, 0.2, `${label}.wave.amplitude`); range(e.wave.frequency, 0, 8, `${label}.wave.frequency`); }
        }
      });
    }
  }
  if (kind === "look") {
    const theme = root.theme;
    if (typeof theme !== "string" || !theme.toLowerCase().endsWith(".ateliertheme") || theme.includes("/") || !isSafePath(theme)) {
      err("\"theme\" must name the .ateliertheme folder at the top of the Look.");
    } else if (!facts.has(at(`${theme}/atelier-theme.json`))) {
      err(`${theme} has no atelier-theme.json.`);
    } else if (themeSchema) {
      try {
        for (const problem of checkSchema(themeSchema, JSON.parse(read(at(`${theme}/atelier-theme.json`)).toString("utf8")))) err(`${theme}/atelier-theme.json ${problem}`);
      } catch (e) { err(`${theme}/atelier-theme.json is not valid JSON: ${e.message}`); }
    }
    const ref = (value, sub, label) => {
      if (value === undefined) return;
      if (typeof value !== "string") return err(`${label} must be a pack id or a ${PACKS[sub].ext} folder in the Look.`);
      if (value.toLowerCase().endsWith(PACKS[sub].ext)) {
        if (value.includes("/") || !isSafePath(value)) return err(`${label}: "${value}" must sit at the top of the Look.`);
        if (![...facts.keys()].some((p) => p.startsWith(at(value) + "/"))) return err(`${label}: ${value} is not in the Look.`);
        check(sub, at(value), facts, read, errors, themeSchema);
      } else if (!isReverseDNS(value)) {
        err(`${label}: "${value}" is neither a pack id nor a ${PACKS[sub].ext} folder.`);
      }
    };
    if (root.wallpaper !== undefined) {
      const w = root.wallpaper, keys = w && typeof w === "object" ? Object.keys(w) : [];
      if (keys.length !== 1 || !["image", "shader"].includes(keys[0])) err("\"wallpaper\" must be {\"image\": path} or {\"shader\": pack}.");
      else if (keys[0] === "image") {
        const f = file(w.image, "wallpaper.image", ["png", "heic", "jpeg"]);
        if (f && f.size > PACK_LIMITS.wallpaperBytes) err("wallpaper.image is larger than 20 MB.");
        if (f && (f.pixels ?? 0) < PACK_LIMITS.wallpaperPixels) err("wallpaper.image is too small to fill a screen.");
      } else ref(w.shader, "shader", "wallpaper.shader");
    }
    if (root.dock !== undefined) {
      const d = root.dock;
      if (!d || typeof d !== "object" || Array.isArray(d)) err("\"dock\" must be an object.");
      else {
        for (const key of Object.keys(d)) if (!["edge", "tileSize", "magnifiedSize", "magnification", "autohide"].includes(key)) err(`dock: unknown key "${key}".`);
        if (d.edge !== undefined && !["bottom", "left", "right", "top"].includes(d.edge)) err("dock.edge must be bottom, left, right or top.");
        range(d.tileSize, 24, 128, "dock.tileSize"); range(d.magnifiedSize, 32, 256, "dock.magnifiedSize");
        for (const key of ["magnification", "autohide"]) if (d[key] !== undefined && typeof d[key] !== "boolean") err(`dock.${key} must be true or false.`);
        if (num(d.tileSize) && num(d.magnifiedSize) && d.magnifiedSize < d.tileSize) err("dock.magnifiedSize must not be smaller than dock.tileSize.");
      }
    }
    ref(root.iconPack, "icons", "iconPack");
    ref(root.soundPack, "sounds", "soundPack");
  }
  if (kind === "scene") checkScene(root, facts, at, err, file, range);
  if (kind === "rules") checkRules(root, err);
  return { id: root.id, name: root.name, version: root.version };
}

// --- Screen saver scenes -----------------------------------------------------------------

const isWidgetID = (id) => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id);

function checkScene(root, facts, at, err, file, range) {
  const L = SCENE_LIMITS;
  if (typeof root.id === "string" && root.id.startsWith(BUILT_IN_SCENE)) err(`Ids that start with ${BUILT_IN_SCENE} are Atelier's own scenes. Use your own reverse-DNS id.`);
  let total = 0;
  for (const [path, f] of facts) {
    total += f.size;
    if (f.size > L.fileBytes) err(`${path} is larger than 20 MB.`);
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase(), base = path.split("/").at(-1);
    if (!(f.format === "json" || ["png", "jpeg", "heic"].includes(f.format) || ["README", "LICENSE"].includes(base) || ["md", "txt"].includes(ext))) {
      err(`${path} is not a PNG, JPEG or HEIC picture. A scene holds pictures, JSON and text notes only.`);
    }
  }
  if (total > L.bundleBytes) err(`The scene is ${Math.floor(total / 1048576)} MB; the limit is 60 MB.`);
  const unknown = (obj, allowed, label) => { for (const key of Object.keys(obj)) if (!allowed.includes(key) && !key.startsWith("x-")) err(`${label}: unknown key "${key}".`); };
  const flag = (v, label) => { if (v !== undefined && typeof v !== "boolean") err(`${label} must be true or false.`); };
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  // The live wallpaper options of a shader background (ScreenSaverScenes.liveOptions).
  const liveOptions = (bg) => {
    range(bg.intensity, ...L.intensity, "background.intensity"); range(bg.grain, ...L.grain, "background.grain");
    range(bg.scale, ...L.scale, "background.scale"); range(bg.dim, ...L.shaderDim, "background.dim");
    if (bg.cycle !== undefined && !CYCLES.includes(bg.cycle)) err("background.cycle must be clock, day, dusk or night.");
    flag(bg.touch, "background.touch");
    if (bg.timelapse !== undefined) {
      if (!num(bg.timelapse)) err("background.timelapse must be a number.");
      else if (bg.timelapse < 0 || bg.timelapse > L.timelapse[1]) err(`background.timelapse must be between 0 and ${L.timelapse[1]}.`);
      else if (bg.timelapse !== 0 && bg.timelapse < L.timelapse[0]) err("background.timelapse is the minutes one day takes: 0, or 1 to 1440.");
    }
    if (bg.tour !== undefined) {
      if (!Array.isArray(bg.tour) || bg.tour.some((n) => typeof n !== "string")) err("background.tour must be a list of shader names.");
      else if (bg.tour.length > L.tour) err(`background.tour holds at most ${L.tour} shaders.`);
      else {
        for (const name of bg.tour) {
          if (WALLPAPER_SHADERS.includes(name)) { err(`background.tour: ${name} draws over your own wallpaper, so only scenes you make yourself may use it.`); break; }
          if (!SHADER_BASES.includes(name) && !SCENE_SHADERS.includes(name) && !isReverseDNS(name)) { err(`background.tour: ${name} is not a shader or a shader pack's id.`); break; }
        }
      }
    }
    range(bg.every, ...L.every, "background.every");
  };
  const photoFolder = (path) => {
    if (!isSafePath(path)) return err(`background.folder: "${path}" is not a folder inside the scene.`);
    const photos = [...facts].filter(([p, f]) => p.startsWith(at(path) + "/") && ["png", "jpeg", "heic"].includes(f.format));
    if (!photos.length) return err(`background.folder: ${path} holds no PNG, JPEG or HEIC photos.`);
    if (photos.length > L.photos) return err(`background.folder: ${path} holds ${photos.length} photos; the limit is 60.`);
    for (const [p, f] of photos) {
      const ext = p.slice(p.lastIndexOf(".")).toLowerCase();
      if (!(EXTENSIONS[f.format] ?? []).includes(ext)) return err(`${p} is not really a ${ext} file.`);
    }
  };

  const bg = root.background;
  if (bg === undefined) err("atelier-scene.json needs a \"background\".");
  else if (!isObj(bg)) err("\"background\" must be an object with a \"kind\".");
  else if (!["shader", "photos", "color", "image"].includes(bg.kind)) err("background.kind must be shader, photos, color or image.");
  else if (bg.kind === "shader") {
    unknown(bg, ["kind", "shader", "palette", "speed", "intensity", "grain", "scale", "dim", "cycle", "touch", "timelapse", "tour", "every"], "background");
    if (typeof bg.shader !== "string") err("background.shader must name a shader.");
    // desktop and weather take the live options only; their palette and speed are not read.
    else if (SCENE_SHADERS.includes(bg.shader)) liveOptions(bg);
    else if (WALLPAPER_SHADERS.includes(bg.shader)) err(`background.shader: ${bg.shader} draws over your own wallpaper, so only scenes you make yourself may use it.`);
    else if (!SHADER_BASES.includes(bg.shader) && !isReverseDNS(bg.shader)) err(`background.shader must be one of ${SHADER_BASES.join(", ")}, or a shader pack's id.`);
    else {
      if (bg.palette !== undefined) {
        if (!Array.isArray(bg.palette)) err("background.palette must be four colours, darkest first.");
        else {
          const bad = bg.palette.findIndex((c) => !isColor(c));
          if (bad >= 0) err(`background.palette[${bad}] must be a colour like "#1B2A55".`);
          else if (bg.palette.length !== 4) err("background.palette must be four colours, darkest first.");
        }
      }
      range(bg.speed, ...L.speed, "background.speed");
      liveOptions(bg);
    }
  } else if (bg.kind === "photos") {
    unknown(bg, ["kind", "source", "folder", "kenBurns", "interval"], "background");
    if (!["folder", "pictures", "bundled", "library"].includes(bg.source)) err("background.source must be folder, pictures, bundled or library.");
    else if (bg.folder !== undefined && typeof bg.folder !== "string") err("background.folder must be a path.");
    else if (bg.source === "pictures" || bg.source === "library") { if (bg.folder !== undefined) err("background.folder is only for the folder and bundled sources."); }
    else if (bg.source === "folder") {
      if (bg.folder === undefined) err("background.folder is needed for the folder source.");
      else if (bg.folder.startsWith("/") || bg.folder.startsWith("~")) err(`background.folder: "${bg.folder}" is outside the scene. Scenes from packs may only use photos inside their own folder.`);
      else photoFolder(bg.folder);
    } else photoFolder(bg.folder ?? "photos");
    flag(bg.kenBurns, "background.kenBurns");
    range(bg.interval, ...L.interval, "background.interval");
  } else if (bg.kind === "color") {
    unknown(bg, ["kind", "colors", "drift"], "background");
    if (!Array.isArray(bg.colors)) err("background.colors must list 1 to 6 colours.");
    else {
      const bad = bg.colors.findIndex((c) => !isColor(c));
      if (bad >= 0) err(`background.colors[${bad}] must be a colour like "#1B2A55".`);
      else if (bg.colors.length < 1 || bg.colors.length > L.colors) err("background.colors must list 1 to 6 colours.");
    }
    flag(bg.drift, "background.drift");
  } else {
    unknown(bg, ["kind", "file"], "background");
    if (typeof bg.file !== "string") err("background.file must name a picture in the scene.");
    else {
      const f = file(bg.file, "background.file", ["png", "jpeg", "heic"]);
      if (f && f.size > L.fileBytes) err("background.file is larger than 20 MB.");
      else if (f && f.pixels && f.pixels < L.imagePixels) err(`background.file is ${f.pixels} px; a screen needs at least 512 px.`);
    }
  }

  if (root.layers !== undefined) {
    if (!Array.isArray(root.layers)) err("\"layers\" must be a list.");
    else {
      if (root.layers.length > L.layers) err(`The scene has ${root.layers.length} layers; the limit is 12.`);
      root.layers.slice(0, L.layers).forEach((layer, i) => {
        const label = `layers[${i}]`;
        if (!isObj(layer)) return err(`${label} must be an object with a "kind".`);
        if (!Object.hasOwn(SCENE_LAYERS, layer.kind)) return err(`${label}.kind must be one of ${Object.keys(SCENE_LAYERS).join(", ")}.`);
        unknown(layer, ["kind", "position", "size", ...SCENE_LAYERS[layer.kind]], label);
        if (layer.position !== undefined && !SCENE_POSITIONS.includes(layer.position)) err(`${label}.position must be one of ${SCENE_POSITIONS.join(", ")}.`);
        range(layer.size, ...L.size, `${label}.size`);
        switch (layer.kind) {
          case "clock":
            if (layer.style !== undefined && !CLOCK_STYLES.includes(layer.style)) err(`${label}.style must be one of ${CLOCK_STYLES.join(", ")}.`);
            if (layer.font !== undefined && !SCENE_FONTS.includes(layer.font)) err(`${label}.font must be one of ${SCENE_FONTS.join(", ")}.`);
            flag(layer.seconds, `${label}.seconds`); flag(layer.date, `${label}.date`);
            if (layer.color !== undefined && !(layer.color === "accent" || layer.color === "white" || isColor(layer.color))) err(`${label}.color must be accent, white or #RRGGBB.`);
            break;
          case "weather":
            if (layer.units !== undefined && !["metric", "imperial"].includes(layer.units)) err(`${label}.units must be metric or imperial.`);
            break;
          case "calendar":
            if (layer.count !== undefined && !(Number.isInteger(layer.count) && layer.count >= L.calendar[0] && layer.count <= L.calendar[1])) err(`${label}.count must be a whole number from 1 to 8.`);
            break;
          case "widgets":
            if (layer.ids !== undefined) {
              if (!Array.isArray(layer.ids) || layer.ids.length > L.widgets) err(`${label}.ids must list at most 8 widget ids.`);
              else {
                const bad = layer.ids.findIndex((id) => !isWidgetID(id));
                if (bad >= 0) err(`${label}.ids[${bad}] must be a widget id: letters, digits, dots and hyphens.`);
                else {
                  const twice = layer.ids.find((id, k) => layer.ids.indexOf(id) !== k);
                  if (twice !== undefined) err(`${label}.ids: ${twice} is listed twice.`);
                }
              }
            }
            break;
          case "quote":
            if (layer.source !== undefined && layer.source !== "bundled") err(`${label}.source must be bundled.`);
            break;
          case "text":
            if (typeof layer.text !== "string") err(`${label}.text is needed for a text layer.`);
            else if (!layer.text.trim() || [...layer.text].length > L.text) err(`${label}.text must be 1 to 280 characters.`);
            break;
          case "plugin":
            // A plugin's widget, drawn by Atelier into a picture; the plugin's code never runs in the saver.
            if (!isReverseDNS(layer.plugin)) err(`${label}.plugin must be a plugin's reverse-DNS id.`);
            if (!isWidgetID(layer.view)) err(`${label}.view must be the id of one of the plugin's widgets: letters, digits, dots and hyphens.`);
            break;
        }
      });
    }
  }
  if (root.accent !== undefined && !isColor(root.accent)) err("\"accent\" must be a colour like \"#FF8A3D\".");
  range(root.dim, ...L.dim, "dim");
  range(root.fadeIn, ...L.fadeIn, "fadeIn");
  flag(root.burnInShift, "burnInShift");
}

// --- Rule packs ---------------------------------------------------------------------------
//
// Automations rules in the same JSON as Atelier's own list (AutomationRules.swift, AutomationJSON):
// closed lists of triggers and actions, every key known. A pack's rules arrive turned off.

export const RULE_LIMITS = { packRules: 20, triggers: 8, actions: 12, text: 200, name: 60, token: 155, ssidBytes: 32 };
export const RULE_TRIGGERS = ["app", "display", "power", "lowPower", "wifi", "time", "screen", "appearance"];
export const RULE_ACTIONS = ["look", "dockProfile", "workspace", "liveWallpaper", "pauseLiveWallpaper", "screenSaverScene",
  "audioOutput", "eq", "typingSounds", "xdrBoost", "shortcut", "notify"];
export const EQ_PRESETS = ["flat", "bassBoost", "bassCut", "trebleBoost", "vocal", "spokenWord", "loudness", "electronic", "acoustic",
  "classical", "rock", "lateNight"];
const RULE_KEYS = ["name", "when", "match", "do", "undo"];
const RULE_LOCAL_KEYS = ["id", "enabled", "pack"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const RULE_STATES = {
  app: ["front", "running", "notRunning"], display: ["connected", "disconnected"], power: ["battery", "adapter"],
  toggle: ["on", "off"], wifi: ["joined", "left"], screen: ["locked", "unlocked"], appearance: ["dark", "light"],
};
// Swift's whitespacesAndNewlines, and Int(text): digits with an optional sign.
const trimText = (t) => t.replace(/^[\s\u0085]+|[\s\u0085]+$/gu, "");
const integerText = (t) => (/^[+-]?\d+$/.test(t) ? Number(t) : null);
const isToken = (t) => t.length > 0 && t.length <= RULE_LIMITS.token && /^[A-Za-z0-9._-]+$/.test(t);

/** "09:00" as minutes; hours 0 to 24 ("24:00" ends the day). Null when it is not a time. */
export function ruleMinutes(text) {
  const parts = text.split(":");
  if (parts.length !== 2 || [...parts[0]].length > 2 || [...parts[1]].length !== 2) return null;
  const h = integerText(parts[0]), m = integerText(parts[1]);
  if (h === null || m === null || h < 0 || h > 24 || m < 0 || m >= 60 || h * 60 + m > 1440) return null;
  return h * 60 + m;
}

function checkRules(root, err) {
  const list = root.rules;
  if (!Array.isArray(list) || !list.length) return err("\"rules\" must be a list of one or more rules.");
  if (list.length > RULE_LIMITS.packRules) err(`The pack has ${list.length} rules; the limit is ${RULE_LIMITS.packRules}.`);
  list.slice(0, RULE_LIMITS.packRules).forEach((rule, i) => checkRule(rule, `rules[${i}]`, err));
}

/** One rule, as AutomationJSON.rule reads a pack's (never the keys Atelier keeps for its own list). */
export function checkRule(rule, label, err) {
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  if (!isObj(rule)) return err(`${label} must be an object.`);
  for (const key of Object.keys(rule).sort()) {
    if (RULE_KEYS.includes(key) || key.startsWith("x-")) continue;
    err(RULE_LOCAL_KEYS.includes(key) ? `${label}: "${key}" is set by Atelier, not by a pack.` : `${label}: unknown key "${key}".`);
  }
  const name = trimText(typeof rule.name === "string" ? rule.name : "");
  if (!name || [...name].length > RULE_LIMITS.name) err(`${label} needs a "name" of 1 to ${RULE_LIMITS.name} characters.`);
  if (rule.match !== undefined && !["all", "any"].includes(rule.match)) err(`${label}.match must be "all" or "any".`);
  if (rule.undo !== undefined && typeof rule.undo !== "boolean") err(`${label}.undo must be true or false.`);
  for (const [key, what, limit, each] of [["when", "triggers", RULE_LIMITS.triggers, ruleTrigger], ["do", "actions", RULE_LIMITS.actions, ruleAction]]) {
    const items = rule[key];
    if (!Array.isArray(items) || !items.length) { err(`${label} needs "${key}": a list of one or more ${what}.`); continue; }
    if (items.length > limit) err(`${label} has ${items.length} ${what}; the limit is ${limit}.`);
    items.forEach((item, j) => each(item, `${label}.${key}[${j}]`, err));
  }
}

function ruleFields(root, label, err) {
  const keys = (allowed) => {
    for (const key of Object.keys(root).sort()) if (key !== "type" && !allowed.includes(key) && !key.startsWith("x-")) err(`${label}: unknown key "${key}".`);
  };
  const text = (key, required = true) => {
    if (!Object.hasOwn(root, key)) { if (required) err(`${label} needs "${key}".`); return required ? null : ""; }
    if (typeof root[key] !== "string") { err(`${label}.${key} must be text.`); return null; }
    const trimmed = trimText(root[key]);
    if (required && !trimmed) { err(`${label}.${key} must not be empty.`); return null; }
    if ([...trimmed].length > RULE_LIMITS.text) { err(`${label}.${key} is longer than ${RULE_LIMITS.text} characters.`); return null; }
    return trimmed;
  };
  const choice = (key, options) => {
    if (!options.includes(root[key])) err(`${label}.${key} must be one of ${options.map((o) => `"${o}"`).join(", ")}.`);
  };
  return { keys, text, choice };
}

function ruleTrigger(value, label, err) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.type !== "string") {
    return err(`${label} needs a "type": one of ${RULE_TRIGGERS.join(", ")}.`);
  }
  const { keys, text, choice } = ruleFields(value, label, err);
  switch (value.type) {
    case "app": {
      keys(["app", "state"]);
      const id = text("app");
      if (id !== null && !isBundleID(id)) err(`${label}.app must be a bundle identifier, like us.zoom.xos.`);
      choice("state", RULE_STATES.app);
      break;
    }
    case "display": keys(["display", "state"]); text("display", false); choice("state", RULE_STATES.display); break;
    case "power": keys(["state"]); choice("state", RULE_STATES.power); break;
    case "lowPower": keys(["state"]); choice("state", RULE_STATES.toggle); break;
    case "wifi": {
      keys(["ssid", "state"]);
      const ssid = text("ssid");
      if (ssid !== null && Buffer.byteLength(ssid, "utf8") > RULE_LIMITS.ssidBytes) err(`${label}.ssid is longer than a Wi-Fi name can be (32 bytes).`);
      choice("state", RULE_STATES.wifi);
      break;
    }
    case "time": {
      keys(["from", "to", "days"]);
      if (!(typeof value.from === "string" && ruleMinutes(value.from) !== null)) err(`${label}.from must be a time like "09:00".`);
      if (!(typeof value.to === "string" && ruleMinutes(value.to) !== null)) err(`${label}.to must be a time like "17:30".`);
      if (value.days !== undefined) {
        if (!Array.isArray(value.days)) err(`${label}.days must be a list.`);
        else for (const day of value.days) {
          if (!(typeof day === "string" && WEEKDAYS.includes(day.toLowerCase()))) err(`${label}.days must list days as ${WEEKDAYS.join(", ")}.`);
        }
      }
      break;
    }
    case "screen": keys(["state"]); choice("state", RULE_STATES.screen); break;
    case "appearance": keys(["state"]); choice("state", RULE_STATES.appearance); break;
    case "focus":
      err(`${label}: Focus is not a trigger. macOS tells apps only whether a Focus is on, and only with an entitlement Atelier cannot have. Use a Shortcuts automation that opens atelier://automation?run=<rule name> instead.`);
      break;
    default:
      err(`${label}.type "${value.type}" is not a trigger. Triggers: ${RULE_TRIGGERS.join(", ")}.`);
  }
}

function ruleAction(value, label, err) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.type !== "string") {
    return err(`${label} needs a "type": one of ${RULE_ACTIONS.join(", ")}.`);
  }
  const { keys, text, choice } = ruleFields(value, label, err);
  // Looks, scenes and shaders are named by identifiers: letters, digits, dots, hyphens and underscores.
  const token = (key) => {
    const t = text(key);
    if (t !== null && !isToken(t)) err(`${label}.${key} must be an identifier (letters, digits, . - _).`);
  };
  switch (value.type) {
    case "look": keys(["look"]); token("look"); break;
    case "dockProfile": keys(["profile"]); text("profile"); break;
    case "workspace": keys(["workspace"]); text("workspace"); break;
    case "liveWallpaper": keys(["shader"]); token("shader"); break;
    case "pauseLiveWallpaper": keys([]); break;
    case "screenSaverScene": keys(["scene"]); token("scene"); break;
    case "audioOutput": keys(["device"]); text("device"); break;
    case "eq":
      keys(["preset"]);
      if (value.preset !== "off" && !EQ_PRESETS.includes(value.preset)) err(`${label}.preset must be one of ${[...EQ_PRESETS, "off"].join(", ")}.`);
      break;
    case "typingSounds": case "xdrBoost": keys(["state"]); choice("state", RULE_STATES.toggle); break;
    case "shortcut": keys(["name"]); text("name"); break;
    case "notify": keys(["title", "body"]); text("title"); text("body", false); break;
    default:
      err(`${label}.type "${value.type}" is not an action. Actions: ${RULE_ACTIONS.join(", ")}.`);
  }
}

// --- Shader code: the restricted Metal of format 2 shader packs ---------------------------
//
// A faithful port of ShaderCode.swift: the same tokenizer, the same whitelist, the same limits,
// the same messages. It runs on the file's UTF-8 bytes. Nothing here compiles or runs the code.

export const SHADER_CODE = {
  maxBytes: 32 * 1024, maxFunctions: 16, maxLoopTurns: 64, maxNestedTurns: 4096, maxWork: 16_384, maxTokens: 12_000, maxDepth: 32,
};
const SC = (() => {
  const types = new Set(["bool", "int", "uint", "float", "half"]);
  for (const base of ["bool", "int", "uint", "float", "half"]) for (let n = 2; n <= 4; n++) types.add(`${base}${n}`);
  for (const base of ["float", "half"]) for (let c = 2; c <= 4; c++) for (let r = 2; r <= 4; r++) types.add(`${base}${c}x${r}`);
  const functions = new Set(["abs", "acos", "acosh", "asin", "asinh", "atan", "atan2", "atanh", "ceil", "clamp", "cos", "cosh", "cospi",
    "cross", "degrees", "distance", "dot", "exp", "exp2", "exp10", "faceforward", "floor", "fma", "fmax", "fmin",
    "fmod", "fract", "length", "length_squared", "log", "log2", "log10", "max", "min", "mix", "normalize", "pow",
    "powr", "radians", "reflect", "refract", "round", "rsqrt", "saturate", "sign", "sin", "sinh", "sinpi",
    "smoothstep", "sqrt", "step", "tan", "tanh", "tanpi", "trunc", "select", "all", "any", "isnan", "isinf",
    "isfinite", "transpose", "determinant", "copysign", "fdim", "ldexp", "distance_squared"]);
  const helpers = new Set(["hash21", "hash22", "noise", "fbm", "luma", "sampleWallpaper"]);
  const constants = new Set(["M_PI_F", "M_PI_2_F", "M_PI_4_F", "M_E_F", "M_SQRT2_F", "M_1_PI_F", "M_2_PI_F", "MAXFLOAT"]);
  const keywords = new Set(["if", "else", "for", "return", "break", "continue", "const", "true", "false"]);
  const uniforms = new Set(["resolution", "pointer", "time", "day", "daylight", "golden", "presence", "opacity", "seed", "contrast", "grain",
    "scale", "dim", "paletteMix", "palette"]);
  const reserved = new Set(["u", "wallpaper", "in", "Uniforms", "Varying", "shade", "atelierPackFragment", "livingVertex", "metal", "main"]);
  const refused = new Map();
  const refuse = (words, why) => words.forEach((w) => refused.set(w, why));
  refuse(["while", "do", "goto", "switch", "case", "default"], "only for loops with constant bounds are allowed");
  refuse(["device", "threadgroup", "threadgroup_imageblock", "thread", "constant", "ray_data", "object_data"],
    "address spaces are not allowed: a pack reads nothing but its uniforms");
  refuse(["kernel", "vertex", "fragment", "visible", "stitchable", "intersection", "mesh", "object"],
    "Atelier writes the entry point; write only shade and its helpers");
  refuse(["texture1d", "texture2d", "texture3d", "texturecube", "texture2d_array", "texture2d_ms", "depth2d", "sampler",
    "buffer", "array", "array_ref", "atomic", "atomic_int", "atomic_uint", "atomic_bool", "atomic_float",
    "imageblock", "visible_function_table", "intersection_function_table", "acceleration_structure",
    "patch_control_point", "simdgroup_matrix"],
  "buffers, textures and samplers are not allowed; read the wallpaper with sampleWallpaper(wallpaper, uv)");
  refuse(["asm", "__asm", "__asm__", "extern", "volatile", "register", "static", "inline", "constexpr", "template",
    "typename", "using", "namespace", "struct", "class", "union", "enum", "typedef", "operator", "new", "delete",
    "sizeof", "alignas", "alignof", "static_cast", "reinterpret_cast", "const_cast", "dynamic_cast", "as_type",
    "this", "friend", "virtual", "mutable", "auto", "decltype", "nullptr", "try", "catch", "throw",
    "threadgroup_barrier", "simdgroup_barrier", "discard_fragment", "packed_float3"],
  "this part of the language is not allowed in shader packs");
  const symbols = ["<<=", ">>=", "==", "!=", "<=", ">=", "&&", "||", "++", "--", "+=", "-=", "*=", "/=", "%=", "|=", "^=", "&=",
    "<<", ">>", "->", "::", "(", ")", "{", "}", "[", "]", ";", ",", ".", "+", "-", "*", "/", "%", "=", "<", ">",
    "!", "?", ":", "^", "|", "~", "&"].map((s) => [s, Buffer.from(s, "latin1")]);
  const signature = ["(", "float2", "uv", ",", "constant", "Uniforms", "&", "u", ",", "texture2d", "<", "float", ">", "wallpaper", ")"];
  return { types, functions, helpers, constants, keywords, uniforms, reserved, refused, symbols, signature };
})();

/** An integer literal's value (decimal or 0x hex, an optional u), or null: Int(text) in Swift. */
function scInteger(text) {
  let body = text;
  if (body.endsWith("u") || body.endsWith("U")) body = body.slice(0, -1);
  let big = null;
  if (body.startsWith("0x") || body.startsWith("0X")) { if (/^[0-9A-Fa-f]+$/.test(body.slice(2))) big = BigInt("0x" + body.slice(2)); }
  else if (/^\d+$/.test(body)) big = BigInt(body);
  return big !== null && big <= 0x7fffffffffffffffn ? Number(big) : null;
}

function scTokenize(bytes) {
  const tokens = [], n = bytes.length;
  let i = 0, line = 1;
  const isNameStart = (b) => (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b === 95;
  const isDigit = (b) => b >= 48 && b <= 57;
  const isName = (b) => isNameStart(b) || isDigit(b);
  const fail = (at, message) => ({ problem: { line: at, message } });
  const chr = (b) => String.fromCharCode(b);
  while (i < n) {
    const b = bytes[i];
    if (b === 10) { line++; i++; continue; }
    if (b === 32 || b === 9 || b === 13) { i++; continue; }
    if (!(b >= 32 && b < 127)) return fail(line, "only plain ASCII text is allowed");
    if (b === 47 && i + 1 < n && bytes[i + 1] === 47) { while (i < n && bytes[i] !== 10) i++; continue; }
    if (b === 47 && i + 1 < n && bytes[i + 1] === 42) {
      const start = line;
      let closed = false;
      i += 2;
      while (i + 1 < n) {
        if (bytes[i] === 10) line++;
        if (bytes[i] === 42 && bytes[i + 1] === 47) { closed = true; i += 2; break; }
        i++;
      }
      if (!closed) return fail(start, "a /* comment is never closed");
      continue;
    }
    if (b === 35) return fail(line, "# is not allowed: no #include, #define or #pragma");
    if (b === 92) return fail(line, "\\ is not allowed");
    if (b === 34 || b === 39) return fail(line, "strings and characters are not allowed");
    if (b === 64 || b === 36 || b === 96) return fail(line, `"${chr(b)}" is not allowed`);
    if (isNameStart(b)) {
      let j = i;
      while (j < n && isName(bytes[j])) j++;
      tokens.push({ kind: "name", text: bytes.toString("latin1", i, j), line });
      i = j;
      continue;
    }
    if (isDigit(b) || (b === 46 && i + 1 < n && isDigit(bytes[i + 1]))) {
      let j = i;
      if (b === 48 && j + 1 < n && (bytes[j + 1] === 120 || bytes[j + 1] === 88)) {
        j += 2;
        const digits = j;
        while (j < n && (isDigit(bytes[j]) || ((bytes[j] | 0x20) >= 97 && (bytes[j] | 0x20) <= 102))) j++;
        if (j === digits) return fail(line, "a hex number needs digits");
        if (j < n && (bytes[j] | 0x20) === 117) j++;
      } else {
        while (j < n && isDigit(bytes[j])) j++;
        if (j < n && bytes[j] === 46) { j++; while (j < n && isDigit(bytes[j])) j++; }
        if (j < n && (bytes[j] | 0x20) === 101) {
          let k = j + 1;
          if (k < n && (bytes[k] === 43 || bytes[k] === 45)) k++;
          if (!(k < n && isDigit(bytes[k]))) return fail(line, "a number's exponent needs digits");
          j = k;
          while (j < n && isDigit(bytes[j])) j++;
        }
        if (j < n && [102, 70, 104, 72, 117, 85].includes(bytes[j])) j++;
      }
      if (j < n && (isName(bytes[j]) || bytes[j] === 46)) return fail(line, `"${bytes.toString("latin1", i, j + 1)}" is not a number`);
      tokens.push({ kind: "number", text: bytes.toString("latin1", i, j), line });
      i = j;
      continue;
    }
    const symbol = SC.symbols.find(([, u]) => i + u.length <= n && u.every((c, k) => bytes[i + k] === c));
    if (!symbol) return fail(line, `"${chr(b)}" is not allowed`);
    tokens.push({ kind: "symbol", text: symbol[0], line });
    i += symbol[1].length;
    if (tokens.length > SHADER_CODE.maxTokens) return fail(line, `the shader is longer than ${SHADER_CODE.maxTokens} words and symbols`);
  }
  return { tokens };
}

/**
 * Checks a shader pack's fragment code. Null when it passes, or its problems (at most ten), each
 * { line, message, description } where description reads "line 3: …" as Atelier shows it.
 */
export function validateShaderCode(source) {
  const L = SHADER_CODE;
  const problems = [];
  const fail = (line, message) => { if (problems.length < 10) problems.push({ line, message }); };
  const done = () => (problems.length ? problems.slice(0, 10).map((p) => ({ ...p, description: p.line > 0 ? `line ${p.line}: ${p.message}` : p.message })) : null);
  const bytes = Buffer.from(source, "utf8");
  if (bytes.length > L.maxBytes) { fail(0, `the shader is larger than ${L.maxBytes / 1024} KB`); return done(); }
  const lexed = scTokenize(bytes);
  if (lexed.problem) { problems.push(lexed.problem); return done(); }
  const tokens = lexed.tokens;
  const defined = new Set(), work = new Map();
  let index = 0, sawShade = false;
  const current = () => tokens[index];
  const lineNow = () => current()?.line ?? tokens.at(-1)?.line ?? 0;
  const isNewName = (t) => !t.startsWith("__") && !t.startsWith("metal_") && !SC.reserved.has(t) && !SC.types.has(t)
    && !SC.functions.has(t) && !SC.helpers.has(t) && !SC.constants.has(t) && !SC.keywords.has(t)
    && !SC.refused.has(t) && t !== "void" && t.length <= 64;
  const isSwizzle = (t) => t.length >= 1 && t.length <= 4 && (/^[xyzw]+$/.test(t) || /^[rgba]+$/.test(t));
  const matching = (start) => {
    const open = tokens[start].text, close = open === "{" ? "}" : open === "(" ? ")" : "]";
    let depth = 0;
    for (let i = start; i < tokens.length; i++) {
      if (tokens[i].kind !== "symbol") continue;
      if (tokens[i].text === open) depth++;
      if (tokens[i].text === close) { depth--; if (depth === 0) return i; }
    }
    return null;
  };
  const expect = (text) => {
    const t = current();
    if (!t || t.text !== text || t.kind === "number") { fail(lineNow(), `expected "${text}"${t ? `, found "${t.text}"` : " at the end"}`); return false; }
    index++;
    return true;
  };
  const assigns = (i, start, end) => {
    const after = i + 1 < end ? tokens[i + 1].text : "", before = i > start ? tokens[i - 1].text : "";
    return ["=", "+=", "-=", "*=", "/=", "%=", "|=", "^=", "<<=", ">>=", "++", "--"].includes(after) || before === "++" || before === "--";
  };

  // for (int i = A; i < B; i++) { … } with literal bounds, at most 64 turns.
  const forLoop = (start, end, scope) => {
    const line = tokens[start].line;
    const bad = (why) => { fail(line, `a for loop must read for (int i = 0; i < N; i++) { … } with N at most ${L.maxLoopTurns}: ${why}`); return null; };
    if (!(start + 1 < end && tokens[start + 1].text === "(")) return bad("its header is incomplete");
    const close = matching(start + 1);
    if (close === null || close >= end) return bad("its header is incomplete");
    const head = tokens.slice(start + 2, close);
    if (!(head.length >= 9 && ["int", "uint"].includes(head[0].text) && head[1].kind === "name" && isNewName(head[1].text) && head[2].text === "=")) {
      return bad("it must declare its counter");
    }
    const variable = head[1].text;
    let k = 3;
    const literal = () => {
      let sign = 1;
      if (k < head.length && head[k].text === "-") { sign = -1; k++; }
      if (!(k < head.length && head[k].kind === "number")) return null;
      const value = scInteger(head[k].text);
      if (value === null) return null;
      k++;
      return sign * value;
    };
    const from = literal();
    if (from === null || !(k < head.length && head[k].text === ";")) return bad("its start must be a whole number");
    k++;
    if (!(k + 1 < head.length && head[k].text === variable && ["<", "<=", ">", ">="].includes(head[k + 1].text))) {
      return bad("it must compare its counter with a number");
    }
    const compare = head[k + 1].text;
    k += 2;
    const to = literal();
    if (to === null || !(k < head.length && head[k].text === ";")) return bad("its end must be a whole number");
    k++;
    const step = head.slice(k).map((t) => t.text);
    const is = (list) => step.length === list.length && list.every((s, x) => step[x] === s);
    let by;
    if (is([variable, "++"]) || is(["++", variable])) by = 1;
    else if (is([variable, "--"]) || is(["--", variable])) by = -1;
    else {
      const amount = step.length === 3 ? scInteger(step[2]) : null;
      if (step.length === 3 && step[0] === variable && (step[1] === "+=" || step[1] === "-=") && amount !== null && amount > 0) by = step[1] === "+=" ? amount : -amount;
      else return bad("its step must be i++, i--, i += N or i -= N");
    }
    let turns;
    switch (compare) {
      case "<": turns = by > 0 && to > from ? Math.trunc((to - from + by - 1) / by) : 0; break;
      case "<=": turns = by > 0 && to >= from ? Math.trunc((to - from) / by) + 1 : 0; break;
      case ">": turns = by < 0 && from > to ? Math.trunc((from - to - by - 1) / -by) : 0; break;
      default: turns = by < 0 && from >= to ? Math.trunc((from - to) / -by) + 1 : 0;
    }
    if ((compare === "<" || compare === "<=") && by < 0) return bad("it would never end");
    if ((compare === ">" || compare === ">=") && by > 0) return bad("it would never end");
    if (turns > L.maxLoopTurns) return bad(`it turns ${turns} times`);
    if (!(close + 1 < end && tokens[close + 1].text === "{")) return bad("its body must be in braces");
    const bodyEnd = matching(close + 1);
    if (bodyEnd === null || bodyEnd >= end) return bad("its body must be in braces");
    scope.add(variable);
    return { turns: Math.max(turns, 1), variable, bodyStart: close + 1, bodyEnd };
  };

  // A function's body; returns its loop turns per call, helpers included.
  const body = (start, end, fn, scope) => {
    const loops = [];
    const enclosing = () => loops.reduce((product, l) => product * l.turns, 1);
    let cost = 0, depth = 0, declaring = false, declaringDepth = 0, i = start;
    while (i < end && !problems.length) {
      while (loops.length && i > loops.at(-1).end) loops.pop();
      const token = tokens[i];
      const previous = i > start ? tokens[i - 1] : undefined;
      const next = i + 1 < end ? tokens[i + 1] : undefined;
      if (token.kind === "symbol") {
        switch (token.text) {
          case "(": case "{":
            depth++;
            if (depth > L.maxDepth) { fail(token.line, `nested more than ${L.maxDepth} deep`); return cost; }
            break;
          case ")": case "}": depth--; break;
          case ";": if (declaring && depth === declaringDepth) declaring = false; break;
          case ",":
            if (declaring && depth === declaringDepth && next && next.kind === "name") {
              if (!isNewName(next.text)) { fail(next.line, `"${next.text}" cannot be used as a name`); return cost; }
              scope.add(next.text);
              i += 2;
              continue;
            }
            break;
          case "&": case "&=": fail(token.line, "no references or addresses: & is not allowed (&& is)"); return cost;
          case "->": case "::": fail(token.line, `"${token.text}" is not allowed`); return cost;
          case "*": {
            const operand = previous
              ? previous.kind === "number" || (previous.kind === "name" && !SC.keywords.has(previous.text)) || previous.text === ")" || previous.text === "]"
              : false;
            if (!operand) { fail(token.line, "no pointers: * only multiplies"); return cost; }
            break;
          }
          case "[": {
            // Only u.palette[0…3].
            const value = next && next.kind === "number" ? scInteger(next.text) : null;
            if (!(i >= 3 && tokens[i - 1].text === "palette" && tokens[i - 2].text === "." && tokens[i - 3].text === "u"
                  && value !== null && value >= 0 && value <= 3 && i + 2 < end && tokens[i + 2].text === "]")) {
              fail(token.line, "no arrays: [ ] only reads u.palette[0] to u.palette[3]");
              return cost;
            }
            i += 3;
            continue;
          }
          case "]": fail(token.line, "no arrays"); return cost;
        }
      } else if (token.kind === "name") {
        const text = token.text;
        if (previous?.text === ".") {
          // A member: a uniform's field, or a swizzle.
          if (i >= 2 && tokens[i - 2].text === "u" && tokens[i - 2].kind === "name" && (i < 3 || tokens[i - 3].text !== ".")) {
            if (!SC.uniforms.has(text)) { fail(token.line, `Uniforms has no field "${text}"`); return cost; }
            if (text === "palette" && next?.text !== "[") { fail(token.line, "read the palette one colour at a time, like u.palette[0]"); return cost; }
          } else if (!isSwizzle(text)) {
            fail(token.line, `".${text}" is not a swizzle like .xy or .rgb`);
            return cost;
          }
        } else {
          if (SC.refused.has(text)) { fail(token.line, `"${text}": ${SC.refused.get(text)}`); return cost; }
          if (text.startsWith("__")) { fail(token.line, "names starting with __ are not allowed"); return cost; }
          if (text === "for") {
            const loop = forLoop(i, end, scope);
            if (!loop) return cost;
            const turns = loops.reduce((product, l) => product * l.turns, loop.turns);
            if (turns > L.maxNestedTurns) { fail(token.line, `nested loops may turn at most ${L.maxNestedTurns} times in all`); return cost; }
            loops.push({ end: loop.bodyEnd, turns: loop.turns, variable: loop.variable });
            cost += turns;
            i = loop.bodyStart;
            continue;
          }
          if (SC.keywords.has(text) || SC.constants.has(text)) {
            // A keyword or one of Metal's constants.
          } else if (SC.types.has(text)) {
            if (next?.text === "*" || next?.text === "&") { fail(token.line, "no pointers or references"); return cost; }
            if (next && next.kind === "name") {
              // A declaration: `float3 a = …, b;`
              if (!isNewName(next.text)) { fail(next.line, `"${next.text}" cannot be used as a name`); return cost; }
              if (i + 2 < end && tokens[i + 2].text === "[") { fail(next.line, "no arrays"); return cost; }
              if (i + 2 < end && tokens[i + 2].text === "(") { fail(next.line, "functions cannot be written inside other functions"); return cost; }
              scope.add(next.text);
              declaring = true;
              declaringDepth = depth;
              i += 2;
              continue;
            }
          } else if (text === "u") {
            if (next?.text !== ".") { fail(token.line, "u is read through its fields, like u.time"); return cost; }
          } else if (text === "wallpaper") {
            if (!(i >= 2 && tokens[i - 1].text === "(" && tokens[i - 2].text === "sampleWallpaper")) {
              fail(token.line, "the wallpaper is read only with sampleWallpaper(wallpaper, uv)");
              return cost;
            }
          } else if (text === fn) {
            fail(token.line, `${text} calls itself: recursion is not allowed`);
            return cost;
          } else if (SC.functions.has(text) || SC.helpers.has(text) || defined.has(text)) {
            if (next?.text !== "(") { fail(token.line, `${text} is a function: call it`); return cost; }
            if (work.has(text)) cost += enclosing() * work.get(text);
            else if (text === "fbm") cost += enclosing() * 8;
          } else if (scope.has(text)) {
            if (loops.some((l) => l.variable === text) && assigns(i, start, end)) { fail(token.line, `the loop counter ${text} may not change inside its loop`); return cost; }
          } else {
            fail(token.line, `unknown name "${text}"`);
            return cost;
          }
        }
      }
      i++;
    }
    return Math.max(cost, 1);
  };

  const fnDecl = () => {
    const returnType = current();
    if (!returnType || returnType.kind !== "name") return fail(lineNow(), "expected a function");
    if (SC.refused.has(returnType.text)) return fail(returnType.line, `"${returnType.text}": ${SC.refused.get(returnType.text)}`);
    if (!SC.types.has(returnType.text) && returnType.text !== "void") {
      return fail(returnType.line, `only functions may be written here, starting with their return type (found "${returnType.text}")`);
    }
    index++;
    const name = current();
    if (!name || name.kind !== "name") return fail(lineNow(), "expected the function's name");
    index++;
    const scope = new Set();
    if (name.text === "shade") {
      const sig = SC.signature;
      if (!(returnType.text === "float4" && tokens.length >= index + sig.length && sig.every((s, k) => tokens[index + k].text === s))) {
        return fail(name.line, "shade must be declared exactly as float4 shade(float2 uv, constant Uniforms &u, texture2d<float> wallpaper)");
      }
      index += sig.length;
      scope.add("uv");
      sawShade = true;
    } else {
      if (!isNewName(name.text) || defined.has(name.text)) return fail(name.line, `"${name.text}" cannot be used as a function name`);
      if (!expect("(")) return;
      if (current()?.text !== ")") {
        while (true) {
          if (current()?.text === "const") index++;
          const word = current()?.text;
          if (word !== undefined && SC.refused.has(word)) return fail(lineNow(), `"${word}": ${SC.refused.get(word)}`);
          const type = current();
          if (!type || !SC.types.has(type.text)) return fail(lineNow(), "a parameter is a number, vector or matrix type followed by its name");
          index++;
          if (current()?.text === "&" || current()?.text === "*") return fail(lineNow(), "no pointers or references");
          const param = current();
          if (!param || param.kind !== "name" || !isNewName(param.text)) return fail(lineNow(), "expected the parameter's name");
          index++;
          scope.add(param.text);
          if (current()?.text === ",") { index++; continue; }
          break;
        }
      }
      if (!expect(")")) return;
    }
    if (current()?.text !== "{") return fail(lineNow(), "expected the function's body in braces");
    const end = matching(index);
    if (end === null) return fail(lineNow(), "a { is never closed");
    const cost = body(index + 1, end, name.text, scope);
    if (!problems.length && cost > L.maxWork) {
      fail(name.line, `${name.text} does too much for one pixel: ${cost} loop turns with its helpers; the limit is ${L.maxWork}`);
    }
    index = end + 1;
    defined.add(name.text);
    work.set(name.text, cost);
  };

  if (!tokens.length) { fail(0, "the file is empty: write a shade function"); return done(); }
  let count = 0;
  while (current() && !problems.length) {
    if (sawShade) { fail(lineNow(), "shade must be the last function in the file"); return done(); }
    count++;
    if (count > L.maxFunctions) { fail(lineNow(), `at most ${L.maxFunctions} functions, shade included`); return done(); }
    fnDecl();
  }
  if (!problems.length && !sawShade) fail(0, "the file needs float4 shade(float2 uv, constant Uniforms &u, texture2d<float> wallpaper)");
  return done();
}

export const isPackKind = (kind) => Object.hasOwn(PACKS, kind);
