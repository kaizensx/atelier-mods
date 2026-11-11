#!/usr/bin/env node
// Builds the published catalog: zips every package, copies screenshots, and writes index.json.
//
//   node scripts/build-index.mjs --root . --out dist [--base-url <url>] [--now <ISO date>]
//
// --out is a checkout of the `dist` branch. Published files there are never rewritten: a
// version, once out, stays downloadable byte for byte, so the version history keeps working
// and a checksum never changes under someone's feet.
// --base-url defaults to catalog.json's baseURL. Point it at http://127.0.0.1:<port> to serve
// a local test catalog with `python3 -m http.server`.
//
// Sign the result afterwards with scripts/sign-index.mjs.

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, compareVersions, readJSON } from "./lib.mjs";

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const here = dirname(fileURLToPath(import.meta.url));
const root = opt("root", join(here, ".."));
const out = opt("out", join(root, "dist"));
const config = readJSON(join(root, "catalog.json"));
const baseURL = (opt("base-url", config.baseURL)).replace(/\/$/, "");
const now = opt("now", new Date().toISOString().replace(/\.\d+Z$/, "Z"));
const previousPath = join(out, "index.json");
const previous = existsSync(previousPath) ? readJSON(previousPath) : null;

// validate.mjs reads its options from the command line: hand it the same root and the live index.
process.argv = [process.argv[0], fileURLToPath(import.meta.url), "--root", root, ...(previous ? ["--published", previousPath] : [])];
const { validateAll, counts } = await import("./validate.mjs");
const results = validateAll();
if (counts().errors) {
  console.error(`\nNot publishing: ${counts().errors} error(s).`);
  process.exit(1);
}

const url = (path) => `${baseURL}/${path.split("/").map(encodeURIComponent).join("/")}`;
const write = (path, data) => { mkdirSync(dirname(join(out, path)), { recursive: true }); writeFileSync(join(out, path), data); };

const mods = [];
for (const r of results) {
  const { mod, zip, hash, description, shots } = r;
  const zipPath = `packages/${mod.id}/${mod.version}.zip`;
  const existing = join(out, zipPath);
  if (existsSync(existing)) {
    if (sha256(readFileSync(existing)) !== sha256(zip)) {
      console.error(`${mod.id} ${mod.version} is already published with different contents. Bump the version.`);
      process.exit(1);
    }
  } else {
    write(zipPath, zip);
  }
  const pkg = { url: url(zipPath), sha256: sha256(zip), size: zip.length };

  const screenshots = shots.map((s) => {
    const path = `screenshots/${mod.id}/${mod.version}/${basename(s.file)}`;
    if (!existsSync(join(out, path))) write(path, s.buf);
    return { url: url(path), sha256: sha256(s.buf), size: s.buf.length, width: s.width, height: s.height, ...(s.caption ? { caption: s.caption } : {}) };
  });

  const before = previous?.mods?.find((m) => m.id === mod.id);
  const versions = (before?.versions ?? []).filter((v) => v.version !== mod.version);
  const already = before?.versions?.find((v) => v.version === mod.version);
  versions.push(already ?? { version: mod.version, date: now, ...(mod.changes ? { notes: mod.changes } : {}), package: pkg });
  versions.sort((a, b) => compareVersions(b.version, a.version));

  mods.push({
    id: mod.id,
    name: mod.name,
    author: mod.author,
    github: mod.github,
    kind: mod.kind,
    version: mod.version,
    summary: mod.summary,
    description,
    permissions: mod.permissions ?? [],
    hosts: mod.hosts ?? [],
    ...(mod.minAtelier ? { minAtelier: mod.minAtelier } : {}),
    ...(mod.homepage ? { homepage: mod.homepage } : {}),
    license: mod.license,
    tags: mod.tags ?? [],
    added: before?.added ?? now,
    updated: already ? before.updated ?? now : now,
    screenshots,
    package: pkg,
    contentHash: hash,
    versions,
  });
}
mods.sort((a, b) => a.id.localeCompare(b.id));

const index = {
  format: 1,
  generated: now,
  catalog: config.catalog,
  featured: (config.featured ?? []).filter((id) => mods.some((m) => m.id === id)),
  mods,
};
write("index.json", JSON.stringify(index, null, 2) + "\n");
if (!existsSync(join(out, "README.md"))) {
  write("README.md", "# atelier-mods: dist\n\nBuilt by the publish workflow. Do not edit by hand.\n`index.json` is signed: `index.json.sig` is an Ed25519 signature of its exact bytes.\n");
}
console.log(`Wrote ${join(out, "index.json")}: ${mods.length} mod(s), generated ${now}.`);
