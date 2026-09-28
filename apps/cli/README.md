# ingot-workbench

The [Ingot](https://github.com/alpersarper/ingot) design-kit distillation
workbench, running on your machine with nothing installed.

```bash
npx ingot-workbench
```

That starts the panel on <http://127.0.0.1:4310> and opens it. No account, no
sign-up, no Docker, no database to provision: the library is a SQLite file in
`~/.ingot`, and nothing leaves your machine unless you turn the optional LLM
assistant on.

> The npm name `ingot` belongs to an unrelated, abandoned 2014 package, so the
> published name carries the product's other word. The command the package
> installs is `ingot`.

## What it does

Capture UI components from any site with the Chrome extension, then distil the
pile into **one** coherent token-driven design kit -- colour roles with a
guaranteed contrast floor, a spacing scale, type and radius steps, and component
recipes -- with every decision showing its evidence and every one of them
overridable. Out the far end come `tokens.json`, a `design-kit.md` written for an
LLM to build against, a spec-conformant
[`DESIGN.md`](https://github.com/google-labs-code/design.md), per-component
markdown and a standalone docs site.

## Options

| | |
| --- | --- |
| `-p, --port <port>` | Port to serve on. Default `4310`. |
| `--host <host>` | Address to bind. Default `127.0.0.1` -- this machine only. |
| `-d, --data-dir <dir>` | Library, screenshots and pairing token. Default `~/.ingot`. |
| `--token <token>` | Pin the pairing token instead of letting the panel mint one. |
| `--no-open` | Do not open a browser. |
| `-h, --help` / `-v, --version` | |

Every option also has an `INGOT_*` environment variable, and so do the assistant
settings; the full list is in
[docs/panel.md](https://github.com/alpersarper/ingot/blob/main/docs/panel.md).
Flags win over the environment.

## The pairing token

The panel is an ordinary web app on a known local port, so a guard stops any
other page you happen to have open from scripting requests at it. The server
mints a token on first run and the command above hands it to your browser in the
URL fragment, which is never sent to any server -- so pairing happens without you
copying anything. It is **not a login**; there are no accounts. The token is also
printed, and written to `pairing-token.txt` in the data directory, because the
capture extension needs it too.

## Requirements

Node 22 or newer. The one native dependency, `better-sqlite3`, ships prebuilt
binaries for macOS, Linux and Windows on x64 and arm64, so there is nothing to
compile.

## The durable path

For something long-lived -- a pinned image, a managed volume, a restart policy --
run the panel in Docker instead. Same server, same data format:
[the repository README](https://github.com/alpersarper/ingot#the-durable-path-docker).
