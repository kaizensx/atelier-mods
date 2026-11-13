# Sharing a mod

Thank you for making something for Atelier. This page is everything you need to get a plugin, a
theme or a pack into the catalog. The formats themselves are documented in Atelier's repository:
[PLUGINS.md](https://github.com/kaizensx/Atelier/blob/main/docs/PLUGINS.md),
[THEMES.md](https://github.com/kaizensx/Atelier/blob/main/docs/THEMES.md) and
[PACKS.md](https://github.com/kaizensx/Atelier/blob/main/docs/PACKS.md) (icon packs, sound packs,
shader packs, layout packs, effect packs and Looks).

## 1. Make it and try it

Install your `.atelierplugin`, `.ateliertheme` or pack in Atelier (drop it on **Mods › Library**) and
use it for a while. Try a light setup and a dark one.

## 2. Pick an id

A reverse-DNS id that is yours: `io.github.<your handle>.<name>`, or a domain you own.
The id is permanent: it is how Atelier recognises updates. It must be the same in your package's
manifest and in `mod.json`, and it names the folder.

## 3. Add the folder

Fork this repository and add:

```
mods/io.github.you.focus-ring/
├── mod.json
├── description.md
├── screenshots/
│   └── 1.png
└── focus-ring.atelierplugin/
    ├── manifest.json
    └── main.js
```

`mod.json`:

```json
{
  "id": "io.github.you.focus-ring",
  "name": "Focus Ring",
  "author": "Your Name",
  "github": "you",
  "version": "1.0.0",
  "kind": "plugin",
  "summary": "A ring that fills as your focus session runs.",
  "screenshots": [{ "file": "screenshots/1.png", "caption": "On the board." }],
  "permissions": ["notifications"],
  "minAtelier": "1.0.0",
  "homepage": "https://github.com/you/focus-ring",
  "license": "MIT",
  "tags": ["focus"],
  "changes": "First release."
}
```

| Key | |
|---|---|
| `id`, `name`, `version` | Exactly as in the package's own `manifest.json`, `atelier-theme.json` or pack manifest. |
| `author` | Shown on the card. |
| `github` | **Your** GitHub handle. Only you (or a maintainer) can update the mod later. |
| `kind` | `plugin`, `theme`, or a pack: `icons`, `sounds`, `shader`, `layouts`, `effects`, `look` (all in `mods/`); `native` (in `native/`). |
| `summary` | One or two sentences, up to 400 characters. |
| `description` | Markdown for the mod page. Or write `description.md` beside `mod.json`. |
| `screenshots` | 1 to 6 PNG or JPEG files in `screenshots/`, at least 640 px wide, up to 1.5 MB each. 16:10 fills the card. |
| `permissions` | Plugins: exactly the permissions in `manifest.json`. |
| `hosts` | Plugins with `network`: exactly `network.hosts` from `manifest.json`. |
| `minAtelier` | The oldest Atelier it works with. |
| `homepage` | An https link: your site or the source. |
| `license` | An SPDX id: `MIT`, `Apache-2.0`, `GPL-3.0-only`, `CC-BY-4.0`… |
| `tags` | Up to 8 lowercase words. |
| `changes` | What is new in this version. Shown in the version history. |

The full schema is [schema/mod.schema.json](schema/mod.schema.json).

## 4. Check it yourself

```sh
node scripts/validate.mjs --only io.github.you.focus-ring
```

## 5. Open a pull request

One mod per pull request. The **Validate mods** check runs on it and lists anything to fix.
A maintainer then reads the code, tries the mod, and merges. Within a few minutes of the merge
it is in everyone's Mods chapter.

## What the checks look for

* `mod.json` follows the schema, and its id, name and version match the package.
* **Permissions tell the truth.** The script is scanned for `atelier.http`, `atelier.notify`,
  `atelier.openURL` and `atelier.theme`. Using one without asking for its permission fails; asking
  for one the script never uses fails too. Reaching `atelier` indirectly (`atelier["http"]`, or
  passing `atelier` around) cannot be followed by the scan and gets a closer human look.
* **No binaries** outside the native tier: no executables, libraries, archives, WebAssembly or
  `#!` scripts. A plugin may hold `.js`, `.json`, `.md`, `.txt` and images; a theme may also hold
  `.heic`, `.tiff` and sounds. No hidden files, no symbolic links.
* **Sizes:** a plugin zips to at most 2 MB (its script at most 512 KB), a theme to 40 MB, a
  native mod to 20 MB. Packs: icons 60 MB, sounds 20 MB, Looks 80 MB, shaders 1 MB, layouts and
  effects 256 KB.
* **Packs are data only** and are checked by the same rules as Atelier (`scripts/packs.mjs`): every
  file by its own bytes (a `.wav` must really be a WAV), icons PNG, HEIC or ICNS of at most 1 MB
  and at least 256 px (600 at most), sounds CAF, M4A or WAV of at most 1 MB and 2 s (typing sounds
  1 s), shaders built from Atelier's own shaders with values in range, layout zones inside the
  screen and never thinner than 0.05, effects of 0.15 to 1.2 s whose keyframes start on the window,
  and a Look's theme and packs inside it, each checked too.
* Themes are checked against Atelier's theme schema.
* At least one screenshot, present and readable.
* **Updates:** the version goes up. The same version may never change its contents; a published
  version is permanent.
* **Ownership:** a new mod's `github` must be you; changing an existing mod needs its owner or a
  maintainer.
* Pull requests from contributors may only touch `mods/` and `native/`.

## Updating your mod

Change the package, raise `version` in both the package and `mod.json`, say what changed in
`changes`, and open a pull request. Atelier offers the update to everyone who has the mod. If the
update asks for a new permission, it stays switched off on their Mac until they allow it, so only
ask for what you need.

## Rules

* Make it yourself, or have the right to share it under the licence you name.
* Do what the page says, and nothing else. No tracking, no ads, no hidden network use.
* Plugins reach only the hosts they list. Ask for a token with `atelier.prompt` and keep it in
  `atelier.storage`; never ship one.
* No content that is illegal, hateful, or sexual.
* Maintainers may decline, delist or remove a mod that breaks these rules, and will say why.

## Native mods

They run inside the Dock and are reviewed separately. Read [native/README.md](native/README.md)
before starting one.
