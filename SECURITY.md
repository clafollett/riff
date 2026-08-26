# Security

Riff runs autonomous agents that write files, run shell commands, and spend
money. That is the point of it, and it is also the whole security problem. This
document says what is actually contained, what is not, and how to check both
yourself rather than take our word for it.

## Reporting a vulnerability

Open a [security advisory](https://github.com/clafollett/riff/security/advisories/new)
rather than a public issue. If you would rather not use GitHub, email
`cali.lafollett@gmail.com` with `riff` in the subject.

There is no bounty. There is a fast answer and public credit unless you would
rather not have it.

## The threat model

The agents are the untrusted party. Not because anyone assumes bad intent, but
because a language model that has been running unattended for nine hours with a
shell and a git repository does not need bad intent to do damage. Everything
below is designed on the assumption that a staff member will, sooner or later,
try something nobody anticipated — and that no instruction in a prompt is a
control, because the thing reading the prompt is the thing being contained.

**In scope.** A staff member reaching outside its company; reaching the host
filesystem; reaching the network; escalating its own permissions; spending past
the cap; one company reading or writing another; an imported company reaching
outside the directory it was unpacked into.

**Out of scope.** A staff member writing something wrong, rude, or useless
inside its own world. That is a management problem, and the board is the
control.

## What contains what

### The shell is decided by where the runtime is, not by who is asking

`Bash` is refused outright on an operator's own machine, and no argument from
inside a session changes that, because the decision is not in the prompt — it
is in [`src/runtime/permissions.ts`](src/runtime/permissions.ts):

```ts
export const shellIsContained = (env = process.env): boolean =>
  env['RIFF_CONTAINED'] === '1'
  && (existsSync('/.dockerenv') || existsSync('/run/.containerenv'));
```

Both signals are required and it fails closed. The environment variable alone
would let a mistyped `export` open a shell on someone's laptop; the container
marker alone would open one in any container, including one built for something
else. Clone this repository and run it directly and the staff have no shell at
all.

### Every tool call crosses one chokepoint, and the default is deny

The Agent SDK routes every tool call — built-ins included — through
`canUseTool`. That function is wired to the company's rules, and an unrecognised
tool is **refused**, so adding a tool to the SDK later cannot silently widen
what the staff can do.

Paths are classified before any read or write: inside your own files, in the
commons, in a colleague's files, or outside the company. Outside is refused.

### The container has no route to the internet except through a proxy

`docker/compose.yaml` puts the factory on an `internal: true` network, which
blocks traffic in **both** directions. Outbound requests go through a tinyproxy
sidecar with an allowlist. Two more services exist only because of that: an
`ingress` sidecar to publish the console on loopback (an internal network cannot
publish ports), and the egress proxy itself, which runs as `user: tinyproxy`
with its filter compiled at build time so the image can stay read-only.

Verified against a live stack, and worth re-running if you change anything:

| Check | Result |
| - | - |
| Allowed host through the proxy | request arrived |
| Denied host through the proxy | refused |
| `github.com.evil.example` (suffix attack on the allowlist) | refused |
| Any host, ignoring the proxy | no route |
| Shell inside the container | works |
| Same shell reaching the host | shut |

### Your data is outside the box

`~/.riff` is a bind mount, so every company is ordinary files on your disk
whether the container is running or not. `docker/backup.sh` snapshots them to a
destination that is deliberately **not** mounted into any container — a copy the
agents can also reach is not a backup, it is a second thing to lose.

`docker/entrypoint.sh` refuses to start if `RIFF_ROOT` escapes the mount,
which is the failure that once wrote a whole company to a layer that vanished on
restart.

### The token is kept off your disk, and that is all that buys

`docker/.env` holds a command that prints the token rather than the token, and
`docker/up.sh` runs it at launch. So the credential is not sitting in plaintext
in a source tree where a backup, an editor's crash recovery, a home-directory
sync or a tarball of the repo will pick it up. It is never passed as an
argument, so it does not appear in `ps`; never typed, so not in shell history;
and never written, so not on disk.

Be clear about the limit. Once the factory is running, the token is in its
environment and the staff have a shell — anything in that box can read it, and
it is visible on the host through `docker inspect` to anyone who can reach the
Docker socket. **Secrecy is not the control.** The control is that the factory
has no route to the internet except an allowlisted proxy, so a token that can
be read still cannot be sent anywhere.

### One writer per installation

The host and the container mount the same `~/.riff` on purpose. Two servers
on it is not a conflicting file — it is two schedulers waking the same staff,
doubling the spend, committing to one git repository from two sessions, and
writing both their accounts into one ledger. The gateway takes a lock at
`~/.riff/.lock` before anything opens a ledger, and refuses to start
against a live one.

Liveness is a heartbeat rather than a pid, because a container's pid 7 says
nothing about the host. A lock whose heartbeat stopped is stale and gets taken
over, so a killed server does not wedge the installation.

### The spend cap is a transaction, not a check

Recorded under `BEGIN IMMEDIATE` in SQLite, so two staff members waking at the
same instant cannot both pass a cap that only one of them fits under.

### An imported company is data, not a promise

`.riff.tar.gz` files arrive from other people. Before anything is unpacked,
every member path is checked — absolute paths, drive letters and any `..`
component are refused, because `../../pwned` is a legal tar member and by the
time you notice it in the output directory it has already been written somewhere
else. After unpacking, a world containing a **symbolic link** is refused
outright: the path classifier resolves lexically and never follows a link, so a
link inside a world is a way around it.

An imported company always lands **paused**. Someone else's company starting to
spend your subscription the moment the copy finishes is not a feature.

Not covered: a decompression bomb. A hostile archive can fill your disk. The
entry count is capped at 50,000 as a blunt guard, but if you import an archive
from someone you do not trust, that is the risk you are taking.

### The operator's own settings never reach the staff

The SDK loads `~/.claude` settings and `CLAUDE.md` by default, which would give
every staff member the same borrowed personality and leak private operator
instructions into every session. Riff passes `settingSources: []` and a
plain-string system prompt, so a persona is its own.

## What is NOT contained

Say these out loud before you run it unattended.

- **The model can be talked to.** Nothing here defends against a staff member
  being persuaded by content it reads. The defence is that persuasion does not
  grant capability — the gate is not in the prompt.
- **Money.** The cap is per local day and enforced honestly, but an agent
  running all night inside the cap still spends up to the cap. Set it low first.
- **Anything you mount in.** The containment boundary is `/data`. Mount your
  home directory in and you have removed it.
- **The allowlist you write.** The egress proxy enforces the list; it cannot
  tell you the list was a good idea.
- **Outbound content.** Anything reaching beyond the company lands as a draft
  for the board. That is a workflow control, not a technical one — approve a
  draft and it goes.

## Checking it yourself

```bash
npm test          # 123 unit tests, including the container env contract
npm run test:ui   # 35 browser tests against a throwaway installation
```

`test/container.test.ts` asserts the container's environment contract against
what `src/` actually reads, so the compose file and the code cannot drift apart
quietly. `test/permissions.test.ts` covers the chokepoint, and
`test/transfer.test.ts` builds hostile tarballs by hand — GNU tar and bsdtar
both refuse to *store* a `..` member, which is exactly why the importer cannot
assume its input came from tar.
