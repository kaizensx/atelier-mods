#!/usr/bin/env node
// Adds what GitHub knows to a freshly built index.json: release assets (and with them install
// counts) and discussion threads (and their likes). Runs in the publish workflow between
// build-index.mjs and sign-index.mjs.
//
//   GITHUB_TOKEN=… node scripts/community.mjs out/index.json [--releases] [--discussions] [--repo owner/name]
//
// --releases     Every published package version is also a GitHub Release asset: tag
//                `<id>@<version>`, asset `<id>-<version>.zip`, the same bytes as on dist (checked
//                by size and SHA-256 before it is uploaded and before it is linked). Atelier
//                downloads from there first, so GitHub's download_count is the install count:
//                `downloads` per mod, summed over its versions. No other numbers are collected.
// --discussions  One discussion per mod in the "Mods" category, created when missing; its URL
//                becomes `discussion` and its thumbs-up count `likes`. When discussions are off,
//                or there is no "Mods" category, this step says so and changes nothing.
//
// Nothing here fails the publish: a step GitHub cannot answer leaves the values build-index.mjs
// carried over from the published index.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sha256, readJSON, releaseTag, releaseAsset } from "./lib.mjs";

export const CATEGORY = "Mods";
const marker = (id) => `<!-- atelier-mod:${id} -->`;

/** A small GitHub client. `fetchImpl` is replaceable for the tests. */
export function github({ token, fetchImpl = fetch }) {
  const headers = (extra = {}) => ({
    "User-Agent": "atelier-mods-publish", "X-GitHub-Api-Version": "2022-11-28", Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra,
  });
  const call = async (method, url, body, extra) => {
    const res = await fetchImpl(url.startsWith("http") ? url : `https://api.github.com${url}`, {
      method, headers: headers(extra), body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${method} ${url}: ${res.status}`);
    return res.status === 204 ? null : res.json();
  };
  return {
    get: (url) => call("GET", url),
    post: (url, body, extra) => call("POST", url, body, extra),
    graphql: async (query, variables) => {
      const data = await call("POST", "/graphql", { query, variables });
      if (data?.errors?.length) throw new Error(data.errors.map((e) => e.message).join("; "));
      return data?.data;
    },
  };
}

// --- Releases and install counts ---------------------------------------------------------

/** Every release of the repository, by tag. */
async function releasesByTag(gh, repo) {
  const byTag = new Map();
  for (let page = 1; page <= 50; page++) {
    const batch = (await gh.get(`/repos/${repo}/releases?per_page=100&page=${page}`)) ?? [];
    for (const r of batch) byTag.set(r.tag_name, r);
    if (batch.length < 100) break;
  }
  return byTag;
}

/**
 * Makes sure every version has its release asset (when `create`), links each asset whose size
 * matches into `package.release`, and sums the download counts into `downloads`.
 */
export async function addReleases(index, { gh, repo, packagesDir, create = true, log = console.log }) {
  const releases = await releasesByTag(gh, repo);
  for (const mod of index.mods) {
    let downloads = 0, counted = false;
    for (const v of mod.versions ?? []) {
      const tag = releaseTag(mod.id, v.version), name = releaseAsset(mod.id, v.version);
      let release = releases.get(tag);
      let asset = release?.assets?.find((a) => a.name === name);
      if (!asset && create && packagesDir) {
        const file = join(packagesDir, "packages", mod.id, `${v.version}.zip`);
        if (!existsSync(file)) { log(`skip ${tag}: ${file} is not on dist.`); continue; }
        const bytes = readFileSync(file);
        if (bytes.length !== v.package.size || sha256(bytes) !== v.package.sha256) { log(`skip ${tag}: the dist file does not match the index.`); continue; }
        release ??= await gh.post(`/repos/${repo}/releases`, {
          tag_name: tag, name: `${mod.name} ${v.version}`, body: `${v.notes ?? ""}\n\nSHA-256 \`${v.package.sha256}\``.trim(),
          target_commitish: process.env.GITHUB_SHA || "main", make_latest: "false",
        });
        const upload = String(release.upload_url ?? "").replace(/\{.*\}$/, "");
        asset = await gh.post(`${upload}?name=${encodeURIComponent(name)}`, bytes, { "Content-Type": "application/zip" });
        release.assets = [...(release.assets ?? []), asset];
        releases.set(tag, release);
        log(`released ${tag}`);
      }
      if (!asset) continue;
      if (asset.size !== v.package.size) { log(`not linking ${tag}: the asset is ${asset.size} bytes, the index says ${v.package.size}.`); continue; }
      v.package.release = asset.browser_download_url;
      if (v.version === mod.version) mod.package.release = asset.browser_download_url;
      downloads += asset.download_count ?? 0;
      counted = true;
    }
    if (counted) mod.downloads = downloads;
  }
  return index;
}

// --- Discussions and likes ---------------------------------------------------------------

const REPO_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    id hasDiscussionsEnabled
    discussionCategories(first: 50) { nodes { id name } }
  }
}`;

const LIST_QUERY = `query($owner: String!, $name: String!, $category: ID!, $after: String) {
  repository(owner: $owner, name: $name) {
    discussions(first: 100, after: $after, categoryId: $category) {
      pageInfo { hasNextPage endCursor }
      nodes { url body reactionGroups { content reactors { totalCount } } }
    }
  }
}`;

const CREATE = `mutation($repo: ID!, $category: ID!, $title: String!, $body: String!) {
  createDiscussion(input: { repositoryId: $repo, categoryId: $category, title: $title, body: $body }) {
    discussion { url reactionGroups { content reactors { totalCount } } }
  }
}`;

const thumbs = (d) => d?.reactionGroups?.find((g) => g.content === "THUMBS_UP")?.reactors?.totalCount ?? 0;

export async function addDiscussions(index, { gh, repo, create = true, log = console.log }) {
  const [owner, name] = repo.split("/");
  const info = (await gh.graphql(REPO_QUERY, { owner, name }))?.repository;
  if (!info?.hasDiscussionsEnabled) { log("Discussions are off for this repository: no threads, no likes."); return index; }
  const category = info.discussionCategories?.nodes?.find((c) => c.name.toLowerCase() === CATEGORY.toLowerCase());
  if (!category) { log(`There is no "${CATEGORY}" discussion category: no threads, no likes.`); return index; }

  const threads = [];
  let after = null;
  for (let page = 0; page < 20; page++) {
    const list = (await gh.graphql(LIST_QUERY, { owner, name, category: category.id, after }))?.repository?.discussions;
    threads.push(...(list?.nodes ?? []));
    if (!list?.pageInfo?.hasNextPage) break;
    after = list.pageInfo.endCursor;
  }
  for (const mod of index.mods) {
    let thread = threads.find((t) => (t.body ?? "").includes(marker(mod.id))) ?? threads.find((t) => mod.discussion && t.url === mod.discussion);
    if (!thread && create) {
      const body = `${mod.summary}\n\nBy ${mod.author} (@${mod.github}). Install it from **Mods** in Atelier, or see it on https://kaizensx.github.io/Atelier/mod.html?id=${encodeURIComponent(mod.id)}.\n\nLeave a 👍 on this post if you like it; Atelier shows the count.\n\n${marker(mod.id)}`;
      thread = (await gh.graphql(CREATE, { repo: info.id, category: category.id, title: mod.name, body }))?.createDiscussion?.discussion;
      if (thread) { threads.push({ ...thread, body }); log(`opened a discussion for ${mod.id}`); }
    }
    if (!thread) continue;
    mod.discussion = thread.url;
    mod.likes = thumbs(thread);
  }
  return index;
}

// --- Command line ------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const indexPath = resolve(args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--repo") ?? "");
  if (!existsSync(indexPath)) { console.error("usage: community.mjs <index.json> [--releases] [--discussions] [--repo owner/name]"); process.exit(1); }
  const here = dirname(fileURLToPath(import.meta.url));
  const config = readJSON(join(here, "..", "catalog.json"));
  const repo = args.includes("--repo") ? args[args.indexOf("--repo") + 1] : process.env.GITHUB_REPOSITORY || config.catalog;
  const gh = github({ token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "" });
  const index = readJSON(indexPath);
  if (args.includes("--releases")) {
    try { await addReleases(index, { gh, repo, packagesDir: dirname(indexPath) }); } catch (e) { console.warn(`Releases skipped: ${e.message}`); }
  }
  if (args.includes("--discussions")) {
    try { await addDiscussions(index, { gh, repo }); } catch (e) { console.warn(`Discussions skipped: ${e.message}`); }
  }
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
  const total = index.mods.reduce((n, m) => n + (m.downloads ?? 0), 0);
  console.log(`Community data added to ${indexPath}: ${total} install(s) across ${index.mods.length} mod(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
