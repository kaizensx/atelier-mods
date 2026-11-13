// Tests for author keys, collections and the community data step. Node's own test runner:
//
//   node --test scripts/test/
//
// Nothing here talks to GitHub: the community step runs against a fake fetch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { ed25519Sign, ed25519Verify, ed25519PublicOf, isEd25519Key, authorOf, zipFolder, sha256, releaseURL } from "../lib.mjs";
import { addReleases, addDiscussions, github } from "../community.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const script = (name) => join(repoRoot, "scripts", name);
const newKey = () => generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32).toString("base64");
const run = (name, args, env = {}) => spawnSync(process.execPath, [script(name), ...args], { encoding: "utf8", env: { ...process.env, ...env } });

/** A scratch catalog with one real plugin from this repository, owned by kaizensx. */
function scratch() {
  const root = mkdtempSync(join(tmpdir(), "atelier-mods-test-"));
  mkdirSync(join(root, "mods"));
  cpSync(join(repoRoot, "mods", "com.example.pomodoro"), join(root, "mods", "com.example.pomodoro"), { recursive: true });
  const modPath = join(root, "mods", "com.example.pomodoro", "mod.json");
  const mod = JSON.parse(readFileSync(modPath, "utf8"));
  return { root, modDir: join(root, "mods", "com.example.pomodoro"), mod, save: (m) => writeFileSync(modPath, JSON.stringify(m, null, 2)) };
}

test("Ed25519 helpers sign, verify and refuse", () => {
  const secret = newKey(), pub = ed25519PublicOf(secret), data = Buffer.from("a package");
  const sig = ed25519Sign(data, secret);
  assert.ok(isEd25519Key(pub));
  assert.ok(!isEd25519Key("short"));
  assert.ok(ed25519Verify(data, sig, pub));
  assert.ok(ed25519Verify(data, sig + "\n", pub));
  assert.ok(!ed25519Verify(Buffer.from("another"), sig, pub));
  assert.ok(!ed25519Verify(data, sig, ed25519PublicOf(newKey())));
  assert.deepEqual(authorOf({ author: "Ana" }), { name: "Ana", key: null, url: null });
  assert.deepEqual(authorOf({ author: { name: "Ana", key: pub, url: "https://ana.dev" } }), { name: "Ana", key: pub, url: "https://ana.dev" });
  assert.equal(releaseURL("o/r", "com.x.y", "1.0.0"), "https://github.com/o/r/releases/download/com.x.y%401.0.0/com.x.y-1.0.0.zip");
});

test("a signed mod validates; a tampered package does not", () => {
  const { root, modDir, mod, save } = scratch();
  try {
    const secret = newKey();
    save({ ...mod, author: { name: "Atelier Examples", key: ed25519PublicOf(secret), url: "https://example.com" } });
    // No package.sig yet.
    assert.notEqual(run("validate.mjs", ["--root", root]).status, 0);
    const signed = run("sign-package.mjs", [modDir], { ATELIER_AUTHOR_KEY: secret });
    assert.equal(signed.status, 0, signed.stderr);
    assert.equal(run("sign-package.mjs", ["--verify", modDir]).status, 0);
    const ok = run("validate.mjs", ["--root", root]);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    // A wrong key cannot sign for this mod.
    assert.notEqual(run("sign-package.mjs", [modDir], { ATELIER_AUTHOR_KEY: newKey() }).status, 0);
    // Change one byte of the package after signing.
    const main = join(modDir, "pomodoro.atelierplugin", "main.js");
    writeFileSync(main, readFileSync(main, "utf8") + "\n// changed\n");
    const bad = run("validate.mjs", ["--root", root]);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stdout, /package\.sig does not match/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a published mod keeps its author key unless a maintainer labels key-change", () => {
  const { root, modDir, mod, save } = scratch();
  try {
    const oldKey = ed25519PublicOf(newKey()), secret = newKey();
    save({ ...mod, version: "9.0.0", author: { name: "Atelier Examples", key: ed25519PublicOf(secret) } });
    // The package's own version must match mod.json.
    const manifestPath = join(modDir, "pomodoro.atelierplugin", "manifest.json");
    writeFileSync(manifestPath, JSON.stringify({ ...JSON.parse(readFileSync(manifestPath, "utf8")), version: "9.0.0" }, null, 2));
    assert.equal(run("sign-package.mjs", [modDir], { ATELIER_AUTHOR_KEY: secret }).status, 0);
    const published = join(root, "published.json");
    writeFileSync(published, JSON.stringify({ format: 1, mods: [{ id: mod.id, version: mod.version, github: "kaizensx", authorKey: oldKey }] }));
    const base = ["--root", root, "--pr", "--published", published, "--author", "kaizensx", "--only", mod.id];
    const refused = run("validate.mjs", [...base, "--labels", ""]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stdout, /author key of com\.example\.pomodoro changed/);
    const allowed = run("validate.mjs", [...base, "--labels", "key-change"]);
    assert.equal(allowed.status, 0, allowed.stdout);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("collections are checked and land in the index with authors and the featured note", () => {
  const out = mkdtempSync(join(tmpdir(), "atelier-mods-out-"));
  try {
    const built = run("build-index.mjs", ["--root", repoRoot, "--out", out, "--now", "2026-11-12T00:00:00Z"]);
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const index = JSON.parse(readFileSync(join(out, "index.json"), "utf8"));
    assert.ok(index.collections.length >= 1);
    for (const c of index.collections) for (const id of c.mods) assert.ok(index.mods.some((m) => m.id === id));
    assert.ok(index.authors.some((a) => a.github === "kaizensx" && a.mods.length === index.mods.length));
    assert.equal(typeof index.featuredNote, "string");
    const v = index.mods[0].versions[0];
    assert.deepEqual(v.permissions, index.mods[0].permissions);          // each version records what it asked for
    assert.equal(typeof index.mods[0].author, "string");                // Atelier reads a name
  } finally { rmSync(out, { recursive: true, force: true }); }
});

// --- The community step, against a fake GitHub ---------------------------------------------

function fakeGitHub({ discussions = true, category = true } = {}) {
  const calls = [];
  const releases = [];
  const threads = [];
  const fetchImpl = async (url, init) => {
    calls.push(`${init.method} ${url}`);
    const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
    if (url.includes("/releases?per_page")) return json(releases);
    if (url.endsWith("/releases") && init.method === "POST") {
      const body = JSON.parse(init.body);
      const r = { tag_name: body.tag_name, upload_url: `https://uploads.github.com/repos/o/r/releases/${releases.length + 1}/assets{?name,label}`, assets: [] };
      releases.push(r);
      return json(r, 201);
    }
    if (url.startsWith("https://uploads.github.com")) {
      const name = decodeURIComponent(new URL(url).searchParams.get("name"));
      const asset = { name, size: init.body.length, download_count: 0, browser_download_url: `https://github.com/o/r/releases/download/x/${name}` };
      releases.find((r) => url.includes(`/releases/${releases.indexOf(r) + 1}/`)).assets.push(asset);
      return json(asset, 201);
    }
    if (url.endsWith("/graphql")) {
      const { query, variables } = JSON.parse(init.body);
      if (query.includes("hasDiscussionsEnabled")) {
        return json({ data: { repository: { id: "R1", hasDiscussionsEnabled: discussions, discussionCategories: { nodes: category ? [{ id: "C1", name: "Mods" }] : [] } } } });
      }
      if (query.includes("createDiscussion")) {
        const d = { url: `https://github.com/o/r/discussions/${threads.length + 1}`, body: variables.body, reactionGroups: [] };
        threads.push(d);
        return json({ data: { createDiscussion: { discussion: d } } });
      }
      return json({ data: { repository: { discussions: { pageInfo: { hasNextPage: false }, nodes: threads } } } });
    }
    return json(null, 404);
  };
  return { gh: github({ token: "t", fetchImpl }), calls, releases, threads };
}

function sampleIndex(dir) {
  const zip = zipFolder(join(repoRoot, "mods", "com.example.pomodoro", "pomodoro.atelierplugin"), "pomodoro.atelierplugin");
  mkdirSync(join(dir, "packages", "com.example.pomodoro"), { recursive: true });
  writeFileSync(join(dir, "packages", "com.example.pomodoro", "1.0.0.zip"), zip);
  const pkg = { url: "https://raw.githubusercontent.com/o/r/dist/packages/com.example.pomodoro/1.0.0.zip", sha256: sha256(zip), size: zip.length };
  return { format: 1, mods: [{ id: "com.example.pomodoro", name: "Pomodoro", author: "A", github: "a", summary: "S", version: "1.0.0", package: { ...pkg }, versions: [{ version: "1.0.0", package: { ...pkg } }] }] };
}

test("every version becomes a release asset, and its downloads become the install count", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atelier-mods-rel-"));
  try {
    const fake = fakeGitHub();
    const index = sampleIndex(dir);
    await addReleases(index, { gh: fake.gh, repo: "o/r", packagesDir: dir, log: () => {} });
    assert.equal(fake.releases.length, 1);
    assert.equal(fake.releases[0].tag_name, "com.example.pomodoro@1.0.0");
    assert.match(index.mods[0].package.release, /com\.example\.pomodoro-1\.0\.0\.zip$/);
    assert.equal(index.mods[0].versions[0].package.release, index.mods[0].package.release);
    assert.equal(index.mods[0].downloads, 0);
    // A second run counts and does not upload again.
    fake.releases[0].assets[0].download_count = 1234;
    const again = sampleIndex(dir);
    await addReleases(again, { gh: fake.gh, repo: "o/r", packagesDir: dir, log: () => {} });
    assert.equal(fake.releases.length, 1);
    assert.equal(again.mods[0].downloads, 1234);
    // An asset whose size does not match is never linked.
    fake.releases[0].assets[0].size = 1;
    const wrong = sampleIndex(dir);
    await addReleases(wrong, { gh: fake.gh, repo: "o/r", packagesDir: dir, create: false, log: () => {} });
    assert.equal(wrong.mods[0].package.release, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("each mod gets one discussion and its likes; discussions off changes nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atelier-mods-disc-"));
  try {
    const fake = fakeGitHub();
    const index = sampleIndex(dir);
    await addDiscussions(index, { gh: fake.gh, repo: "o/r", log: () => {} });
    assert.equal(index.mods[0].discussion, "https://github.com/o/r/discussions/1");
    assert.equal(index.mods[0].likes, 0);
    fake.threads[0].reactionGroups = [{ content: "THUMBS_UP", reactors: { totalCount: 7 } }];
    const again = sampleIndex(dir);
    await addDiscussions(again, { gh: fake.gh, repo: "o/r", log: () => {} });
    assert.equal(fake.threads.length, 1);                                 // found by its marker, not opened twice
    assert.equal(again.mods[0].likes, 7);

    for (const options of [{ discussions: false }, { category: false }]) {
      const off = fakeGitHub(options);
      const untouched = { ...sampleIndex(dir) };
      untouched.mods[0].likes = 3;
      const logs = [];
      await addDiscussions(untouched, { gh: off.gh, repo: "o/r", log: (m) => logs.push(m) });
      assert.equal(untouched.mods[0].likes, 3);                          // carried over, not wiped
      assert.equal(off.threads.length, 0);
      assert.match(logs.join(" "), /no threads, no likes/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
