# Native mods

Native mods are compiled code that Atelier loads into the Dock through the Dock Bridge, the
scripting addition behind the Beyond SIP chapter. They are not sandboxed: a native mod can see
and change every window and Space. This tier is separate from plugins and themes on purpose.

* Atelier shows native mods only on a Mac where the Dock Bridge is set up and answering.
* Installing one asks the owner to confirm a strong warning first.
* A pull request that touches `native/` needs the `native-reviewed` label, which only a
  maintainer can add, after reading the source. The `homepage` in `mod.json` must link that
  source (GitHub, GitLab or Codeberg), and the payload must build from it.

## Layout

```
native/io.github.you.dock-fx/
├── mod.json                  "kind": "native"
├── description.md
├── screenshots/1.png
└── dock-fx.ateliermod/
    ├── atelier-mod.json
    └── payload.dylib         universal: arm64e and x86_64
```

`atelier-mod.json`:

```json
{
  "format": 1,
  "id": "io.github.you.dock-fx",
  "name": "Dock FX",
  "version": "1.0.0",
  "bridge": "1.0",
  "architectures": ["arm64e", "x86_64"],
  "payload": "payload.dylib"
}
```

Only `.dylib` files that are Mach-O are allowed as binaries, and only here.

> The current Dock Bridge does not load third-party payloads yet. Atelier verifies and installs
> native mods into `~/Library/Application Support/Atelier/Mods/Native/`, ready for the bridge
> version that will. Until then this tier stays empty.
