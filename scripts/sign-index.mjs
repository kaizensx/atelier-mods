#!/usr/bin/env node
// Signs index.json with the catalog's Ed25519 key, and checks signatures.
//
//   MODS_SIGNING_KEY=<base64 key> node scripts/sign-index.mjs dist/index.json
//   node scripts/sign-index.mjs dist/index.json --key-file <path>      (local, maintainer only)
//   node scripts/sign-index.mjs --verify dist/index.json [<base64 public key>]
//
// The key is the 32 raw bytes of an Ed25519 private key, base64 encoded: the same format the
// Atelier app's CryptoKit keys use. It lives only in the repository secret MODS_SIGNING_KEY and on
// the maintainer's Mac; it is never written to disk here. The signature is written beside the
// index as index.json.sig (base64 of the 64-byte signature over the file's exact bytes), then
// verified against catalog.json's public key, so a wrong secret fails the run instead of
// publishing a catalog no Atelier would accept.

import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, "..", "catalog.json"), "utf8"));

const fail = (message) => { console.error(message); process.exit(1); };

function publicKey(base64) {
  const raw = Buffer.from(base64, "base64");
  if (raw.length !== 32) fail("The public key must be 32 bytes, base64.");
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

function check(indexPath, keyBase64) {
  const data = readFileSync(indexPath);
  const sig = Buffer.from(readFileSync(indexPath + ".sig", "utf8").trim(), "base64");
  if (sig.length !== 64) return false;
  return verify(null, data, publicKey(keyBase64), sig);
}

const args = process.argv.slice(2);
if (args[0] === "--verify") {
  const ok = check(args[1] ?? fail("usage: sign-index.mjs --verify <index.json> [public key]"), args[2] ?? config.publicKey);
  console.log(ok ? "signature OK" : "signature MISMATCH");
  process.exit(ok ? 0 : 1);
}

const indexPath = args[0] ?? fail("usage: sign-index.mjs <index.json> [--key-file <path>]");
const keyFile = args.indexOf("--key-file") >= 0 ? args[args.indexOf("--key-file") + 1] : null;
const secret = (keyFile ? readFileSync(keyFile, "utf8") : process.env.MODS_SIGNING_KEY ?? "").trim();
if (!secret) fail("No signing key: set MODS_SIGNING_KEY, or pass --key-file.");
const raw = Buffer.from(secret, "base64");
if (raw.length !== 32) fail("MODS_SIGNING_KEY must be 32 raw bytes, base64 (44 characters).");
const key = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, raw]), format: "der", type: "pkcs8" });
const signature = sign(null, readFileSync(indexPath), key);
writeFileSync(indexPath + ".sig", signature.toString("base64") + "\n");
if (!check(indexPath, config.publicKey)) fail("The new signature does not match catalog.json's public key. Is MODS_SIGNING_KEY the right key?");
console.log(`Signed ${indexPath}.`);
