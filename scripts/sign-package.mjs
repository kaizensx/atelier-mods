#!/usr/bin/env node
// Lets an author sign their own package, so Atelier can tell it was them who published it.
//
//   node scripts/sign-package.mjs --generate [--key-file <path>]
//       Makes a new Ed25519 key. The private key goes to <path> (default
//       ~/.atelier/author-ed25519.key, readable only by you); the public key is printed. Put the
//       public key in mod.json as "author": { "name": "…", "key": "<public key>" }.
//
//   node scripts/sign-package.mjs mods/<id> [--key-file <path>]
//       Zips the package exactly as the catalog will publish it and writes the signature to
//       mods/<id>/package.sig. ATELIER_AUTHOR_KEY=<base64> works instead of --key-file.
//       Sign again whenever the package changes.
//
//   node scripts/sign-package.mjs --verify mods/<id>
//       Checks package.sig against the key in mod.json.
//
// Keep the private key to yourself and never commit it. If you lose it, a maintainer can accept
// a new key (the key-change label); everyone who has your mod is asked to confirm the change.

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { generateKeyPairSync } from "node:crypto";
import { findPackage, zipFolder, readJSON, authorOf, ed25519Sign, ed25519PublicOf, ed25519Verify, isEd25519Key } from "./lib.mjs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const fail = (message) => { console.error(message); process.exit(1); };
const defaultKeyFile = join(homedir(), ".atelier", "author-ed25519.key");

/** The package zip, byte for byte what build-index.mjs publishes. */
function packageZip(modDir) {
  const mod = readJSON(join(modDir, "mod.json"));
  const pkg = findPackage(modDir, mod.kind);
  if (!pkg || Array.isArray(pkg)) throw new Error(`No single package folder in ${modDir}.`);
  return { mod, zip: zipFolder(pkg, basename(pkg)) };
}

if (args.includes("--generate")) {
  const file = resolve(opt("key-file") ?? defaultKeyFile);
  if (existsSync(file)) fail(`${file} already exists. Keep using it, or choose another --key-file.`);
  const { privateKey } = generateKeyPairSync("ed25519");
  const raw = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32).toString("base64");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, raw + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  console.log(`Private key: ${file} (keep it secret, back it up, never commit it)`);
  console.log(`Public key for mod.json "author.key":\n${ed25519PublicOf(raw)}`);
  process.exit(0);
}

const target = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--key-file")[0];
if (!target) fail("usage: sign-package.mjs mods/<id> [--key-file <path>] | --verify mods/<id> | --generate");
const modDir = resolve(target);
const { mod, zip } = packageZip(modDir);
const { key } = authorOf(mod);

if (args.includes("--verify")) {
  const sigFile = join(modDir, "package.sig");
  if (!existsSync(sigFile)) fail("There is no package.sig.");
  if (!isEd25519Key(key)) fail("mod.json has no author.key.");
  const ok = ed25519Verify(zip, readFileSync(sigFile, "utf8"), key);
  console.log(ok ? "package signature OK" : "package signature MISMATCH");
  process.exit(ok ? 0 : 1);
}

const keyFile = resolve(opt("key-file") ?? defaultKeyFile);
const secret = (process.env.ATELIER_AUTHOR_KEY ?? (existsSync(keyFile) ? readFileSync(keyFile, "utf8") : "")).trim();
if (!secret) fail("No key: run with --generate first, pass --key-file, or set ATELIER_AUTHOR_KEY.");
const publicKey = ed25519PublicOf(secret);
if (!key) fail(`Add your public key to mod.json first: "author": { "name": "${authorOf(mod).name}", "key": "${publicKey}" }`);
if (key !== publicKey) fail(`This key does not match mod.json's author.key.\n  mod.json: ${key}\n  this key: ${publicKey}`);
const signature = ed25519Sign(zip, secret);
writeFileSync(join(modDir, "package.sig"), signature + "\n");
if (!ed25519Verify(zip, signature, key)) fail("The new signature does not verify. Nothing was signed.");
console.log(`Signed ${mod.id} ${mod.version}: ${join(target, "package.sig")}`);
