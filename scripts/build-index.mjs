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
// Then scripts/community.mjs adds what GitHub knows (release assets, install counts, discussion
// threads and likes), and scripts/sign-index.mjs signs the result.
//
// What a mod already had in the published index (its install count, likes, discussion, release
// asset links) is carried over, so a run where GitHub cannot be reached loses nothing.

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, compareVersions, readJSON } from "./lib.mjs";
import { isReverseDNS } from "./lib.mjs";

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
const { validateAll, counts, readCollections } = await import("./validate.mjs");
const results = validateAll();
if (counts().errors) {
  console.error(`\nNot publishing: ${counts().errors} error(s).`);
  process.exit(1);
}

const url = (path) => `${baseURL}/${path.split("/").map(encodeURIComponent).join("/")}`;
const write = (path, data) => { mkdirSync(dirname(join(out, path)), { recursive: true }); writeFileSync(join(out, path), data); };

const mods = [];
for (const r of results) {
  const { mod, zip, hash, description, shots, author: who, signature } = r;
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
  const before = previous?.mods?.find((m) => m.id === mod.id);
  const already = before?.versions?.find((v) => v.version === mod.version);
  const pkg = { url: url(zipPath), sha256: sha256(zip), size: zip.length, ...(already?.package?.release ? { release: already.package.release } : {}) };
  // The author's key and signature for this version; an unsigned mod has neither.
  const signed = who.key && signature ? { authorKey: who.key, packageSignature: signature } : {};

  const screenshots = shots.map((s) => {
    const path = `screenshots/${mod.id}/${mod.version}/${basename(s.file)}`;
    if (!existsSync(join(out, path))) write(path, s.buf);
    return { url: url(path), sha256: sha256(s.buf), size: s.buf.length, width: s.width, height: s.height, ...(s.caption ? { caption: s.caption } : {}) };
  });

  const versions = (before?.versions ?? []).filter((v) => v.version !== mod.version);
  versions.push(already ?? {
    version: mod.version, date: now, ...(mod.changes ? { notes: mod.changes } : {}), package: pkg, ...signed,
    permissions: mod.permissions ?? [], hosts: mod.hosts ?? [],
  });
  versions.sort((a, b) => compareVersions(b.version, a.version));

  mods.push({
    id: mod.id,
    name: mod.name,
    author: who.name,
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
    ...signed,
    ...(who.url ? { authorURL: who.url } : {}),
    // Filled in by community.mjs; carried over when it cannot reach GitHub.
    ...(Number.isInteger(before?.downloads) ? { downloads: before.downloads } : {}),
    ...(Number.isInteger(before?.likes) ? { likes: before.likes } : {}),
    ...(before?.discussion ? { discussion: before.discussion } : {}),
  });
}
mods.sort((a, b) => a.id.localeCompare(b.id));

// Authors, from their mod.json files: one entry per GitHub handle.
const authors = new Map();
for (const r of results) {
  const handle = r.mod.github, key = handle?.toLowerCase();
  if (!key) continue;
  const a = authors.get(key) ?? { github: handle, name: r.author.name || handle, mods: [] };
  if (r.author.url && !a.url) a.url = r.author.url;
  a.mods.push(r.mod.id);
  authors.set(key, a);
}
const known = new Set(mods.map((m) => m.id));
const collections = readCollections()
  .map((c) => ({ id: c.id, title: c.title, ...(c.description ? { description: c.description } : {}), mods: (c.mods ?? []).filter((id) => known.has(id) && isReverseDNS(id)) }))
  .filter((c) => c.mods.length);

const index = {
  format: 1,
  generated: now,
  catalog: config.catalog,
  featured: (config.featured ?? []).filter((id) => mods.some((m) => m.id === id)),
  ...(config.featuredNote ? { featuredNote: config.featuredNote } : {}),
  collections,
  authors: [...authors.values()].sort((a, b) => a.github.localeCompare(b.github)),
  mods,
};
write("index.json", JSON.stringify(index, null, 2) + "\n");
if (!existsSync(join(out, "README.md"))) {
  write("README.md", "# atelier-mods: dist\n\nBuilt by the publish workflow. Do not edit by hand.\n`index.json` is signed: `index.json.sig` is an Ed25519 signature of its exact bytes.\n");
}
console.log(`Wrote ${join(out, "index.json")}: ${mods.length} mod(s), generated ${now}.`);
