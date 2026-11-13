# Atelier Mods

The community catalog for [Atelier](https://github.com/kaizensx/Atelier): plugins, themes and
data-only packs (icons, sounds, shaders, snap layouts, minimise effects and Looks) anyone can
share, and, in a separate tier, native mods for Macs with the Dock Bridge.

Atelier's **Mods** chapter reads this repository. Browse, install, update and remove from there;
nothing here needs to be downloaded by hand.

## How it works

```
mods/<id>/            plugins, themes and packs     ┐
native/<id>/          native mods (reviewed tier)   ├─ main: what people submit
catalog.json          featured list, maintainers    ┘
        │  pull request → "Validate mods" checks it → a maintainer reviews → merge
        ▼
"Publish catalog" zips every package, records its SHA-256, writes index.json,
signs it with the catalog key, and pushes to the dist branch
        │
        ▼
dist/index.json, index.json.sig, packages/<id>/<version>.zip, screenshots/…
        │  https://raw.githubusercontent.com/kaizensx/atelier-mods/dist/index.json
        ▼
Atelier checks the signature against the key built into the app, then each download
against the checksum in the signed index, before anything is installed.
```

* **Signed.** `index.json.sig` is an Ed25519 signature of `index.json`'s exact bytes. The private
  key exists only as this repository's `MODS_SIGNING_KEY` secret and on the maintainer's Mac.
  Atelier carries the public key: `SATwJOjY3lMsJm4Ak8pOlyv54/DlSPynY0qz71XiGSY=`.
* **Checked to the byte.** Every package and screenshot is listed with its size and SHA-256.
  A file that does not match is refused.
* **No rollback.** Atelier never accepts an index older than one it already has.
* **Still sandboxed.** A plugin from the catalog runs exactly like one you installed yourself:
  its own JavaScript engine, no file access, and each permission asked for when you switch it on.
  An update that asks for more is switched off until you allow it.
* **Versions stay.** Published packages on `dist` are never rewritten, so every version in a mod's
  history stays downloadable with the same checksum.

## Share a mod

Read [CONTRIBUTING.md](CONTRIBUTING.md). In short: fork, add `mods/<your id>/` with `mod.json`,
a screenshot and your package, open a pull request. The checks tell you what to fix.

## Layout

```
mods/com.example.pomodoro/
├── mod.json                     the catalog entry
├── description.md               the mod page, in Markdown
├── screenshots/1-board.jpg
└── pomodoro.atelierplugin/      the package, exactly as Atelier installs it
    ├── manifest.json
    └── main.js
```

| Folder | Holds |
|---|---|
| `mods/` | Plugins (`.atelierplugin`) and themes (`.ateliertheme`) |
| `native/` | Native mods (`.ateliermod`). See [native/README.md](native/README.md) |
| `schema/` | `mod.schema.json`, and a copy of Atelier's `atelier-theme.schema.json` |
| `scripts/` | `validate.mjs`, `build-index.mjs`, `sign-index.mjs` (Node 20, no dependencies) |
| `catalog.json` | The featured list, the maintainers, the public key, the published URL |

The six seed mods (three plugins, three themes) are Atelier's own examples.

## Try it locally

```sh
node scripts/validate.mjs                                  # check every mod
node scripts/build-index.mjs --out /tmp/catalog --base-url http://127.0.0.1:8765
node scripts/sign-index.mjs /tmp/catalog/index.json --key-file <key>   # maintainers only
python3 -m http.server 8765 --bind 127.0.0.1 --directory /tmp/catalog
open "atelier://mods?catalog=http://127.0.0.1:8765/index.json"
```

Atelier only trusts a catalog signed with the catalog key, so a local copy shows up in the app
only once a maintainer signed it. `atelier://mods?catalog=default` switches back.

## Maintainers

One-time setup of this repository:

1. **Secret.** Settings > Environments > New environment `catalog-signing`, limited to the
   `main` branch. Add the secret `MODS_SIGNING_KEY`: the 44-character contents of
   `~/Library/Application Support/Atelier Release/mods-ed25519.key` on the maintainer's Mac.
2. **Branch protection** on `main`: require a pull request, one approving review, review from
   Code Owners, and the *Check the changed mods* status check.
3. **Labels:** `native-reviewed` (only after reading a native mod's source),
   `maintainer-approved` (lets a maintainer approve a change to someone else's mod), `report`,
   `idea`, `catalog`.
4. **Actions:** Settings > Actions > General: "Require approval for all outside collaborators"
   for workflows from forks.
5. Merge once to `main` (or run *Publish catalog* by hand) to create the `dist` branch.

Featuring a mod: add its id to `featured` in `catalog.json`.
Taking a mod down: delete its folder in a pull request; its old packages stay on `dist` but
leave the index, so Atelier no longer offers them. Installed copies stay until their owners
remove them.
