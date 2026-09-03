import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, existsSync,
         copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';

/**
 * The container's environment is a contract with src/core/config.ts, and
 * nothing was checking it.
 *
 * It had already rotted: the Dockerfile set RIFF_HOME=/world from the
 * single-company era, so under the current resolver every company would have
 * been written to the container's own filesystem instead of the mounted
 * volume — and destroyed, silently, on the next restart. These tests are the
 * cheapest thing that would have caught that.
 */
const dockerfile = readFileSync('docker/Dockerfile', 'utf8');
const compose = readFileSync('docker/compose.yaml', 'utf8');
const entrypoint = readFileSync('docker/entrypoint.sh', 'utf8');

/** Every source file, so "does anything read this?" is answered honestly. */
const allSource = ((): string => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
  return walk('src').map((p) => readFileSync(p, 'utf8')).join('\n');
})();

/** The mount target the factory writes to, read from compose. */
const MOUNT = '/data';

/**
 * One service block from compose.
 *
 * Sliced to the NEXT key at service indentation, not to a named one: slicing
 * factory-to-egress silently swallowed the ingress service when it was added
 * between them, and the assertions then described the wrong container.
 * Matching on a bare name is wrong too — 'egress:' also appears inside
 * http://egress:8888.
 */
const service = (name: string): string => {
  const start = compose.indexOf(`\n  ${name}:`);
  assert.ok(start >= 0, `compose must declare a ${name} service`);
  const rest = compose.slice(start + 1);
  const next = /\n {2}[a-z][a-z0-9_-]*:\n/.exec(rest.slice(name.length + 3));
  return next ? rest.slice(0, name.length + 3 + next.index) : rest;
};

const factoryBlock = service('factory');

describe('the container writes where the volume is', () => {
  test('the installation root is set, and set to the mount', () => {
    const m = /RIFF_ROOT=(\S+)/.exec(dockerfile);
    assert.ok(m, 'the Dockerfile must set RIFF_ROOT');
    assert.ok(m[1]!.startsWith(MOUNT),
      `RIFF_ROOT is ${m[1]} — anything outside ${MOUNT} is lost on restart`);
  });

  test('compose agrees with the image about where that is', () => {
    assert.match(compose, /RIFF_ROOT:\s*\/data/);
    assert.match(compose, new RegExp(`:${MOUNT}\\b`), 'the volume must be mounted at the root');
  });

  test('the container and the host share one installation', () => {
    // Compose interpolates ${HOME} client-side, in the process that runs the
    // command — so it is the invoking user's home, never the daemon's. And it
    // points at the SAME ~/.riff the host uses: a second directory would
    // mean a company founded one way is invisible the other.
    assert.match(compose, /\$\{RIFF_DATA:-\$\{HOME\}\/\.riff\}/);
  });

  test('it checks it can write the mount before doing anything', () => {
    // Docker Desktop maps bind-mount ownership; a rootful Linux daemon does
    // not, and the container's uid then cannot create anything. Unchecked,
    // that surfaces as a confusing crash deep inside a git call.
    assert.match(entrypoint, /touch \/data/);
    assert.match(entrypoint, /Cannot write to \/data/);
    assert.match(entrypoint, /chown/, 'the failure must carry its own fix');
  });

  test('the entrypoint refuses to start if the root escapes the mount', () => {
    // Belt and braces: if someone overrides it at run time, fail loudly rather
    // than writing a whole company somewhere it will not survive.
    assert.match(entrypoint, /RIFF_ROOT/);
    assert.match(entrypoint, /exit 1/);
  });

  test('the single-company variable is gone from the image', () => {
    // RIFF_HOME means "one company lives here". Setting it installation-wide
    // is what broke this.
    assert.ok(!/ENV[\s\S]*RIFF_HOME=/.test(dockerfile), 'RIFF_HOME must not be set image-wide');
  });
});

const entrypointSrc = readFileSync(new URL('../docker/entrypoint.sh', import.meta.url), 'utf8');

describe('the container only sets variables the code reads', () => {
  test('every RIFF_* it sets is one config.ts looks up', () => {
    const set = new Set<string>();
    for (const src of [dockerfile, compose]) {
      for (const m of src.matchAll(/\b(RIFF_[A-Z_]+)\b/g)) set.add(m[1]!);
    }
    // Consumed by compose itself, before the container exists.
    const composeOnly = new Set(['RIFF_DATA']);
    // The entrypoint runs before the server and reads some of these itself,
    // so it counts as a reader. Exempting them instead would let a variable
    // nothing reads at all slip through under the same excuse.
    // The launcher and the entrypoint both run before the server and read
    // some of these themselves, so they count as readers. Exempting the names
    // instead would let a variable nothing reads at all through on the same
    // excuse.
    const shell = entrypointSrc
      + readFileSync(new URL('../docker/up.sh', import.meta.url), 'utf8');
    for (const name of set) {
      if (composeOnly.has(name)) continue;
      assert.ok(allSource.includes(`'${name}'`) || shell.includes(name),
        `${name} is named for the container but nothing under src/, the entrypoint or up.sh reads it`);
    }
  });
});

describe('the shell is only open inside the box', () => {
  test('the image declares itself contained', () => {
    assert.match(dockerfile, /RIFF_CONTAINED=1/);
  });

  test('and the runtime still demands a container marker as well', () => {
    // The variable alone must never be enough — a mistyped export on someone's
    // laptop would otherwise hand an agent a terminal.
    const perms = readFileSync('src/runtime/permissions.ts', 'utf8');
    assert.match(perms, /RIFF_CONTAINED/);
    assert.match(perms, /dockerenv|containerenv/);
  });
});

describe('what the factory can reach', () => {
  test('the console is carried out by a forwarder, not by the factory', () => {
    // A container on an internal network cannot publish a port — no gateway
    // means no ingress either, and Docker publishes nothing without saying so.
    assert.ok(!/ports:/.test(factoryBlock), 'the factory must not try to publish a port');
    const ingress = service('ingress');
    assert.match(ingress, /ports:\s*\['127\.0\.0\.1:/, 'ingress publishes on loopback only');
    assert.match(ingress, /networks:\s*\[walled, outside\]/);
    // It must stay a forwarder: no build context, no token, nothing to run.
    assert.ok(!ingress.includes('CLAUDE_CODE_OAUTH_TOKEN'), 'ingress must never see the token');
    assert.ok(!ingress.includes('build:'), 'ingress runs a stock image, not ours');
  });

  test('its network has no route off the machine', () => {
    assert.match(compose, /walled:\s*\n\s*internal:\s*true/);
    // The factory is on the walled network only; the proxy bridges out.
    assert.match(factoryBlock, /networks:\s*\[walled\]/);
    assert.ok(!factoryBlock.includes('outside'),
      'the factory must not be attached to the outside network');
  });

  test('the allowlist is anchored, so a lookalike host cannot pass', () => {
    // "github.com" unanchored also matches "github.com.evil.example".
    const compile = readFileSync('docker/proxy/compile-allowlist.sh', 'utf8');
    assert.match(compile, /\^%s\$/);
  });

  test('nothing is denied by default being off', () => {
    const conf = readFileSync('docker/proxy/tinyproxy.conf', 'utf8');
    assert.match(conf, /FilterDefaultDeny\s+Yes/);
  });

  test('the proxy writes nothing at start, so it can run read-only', () => {
    // It used to compile its own filter on every boot, which crash-looped
    // against a read-only filesystem — eight restarts before anyone noticed,
    // and a factory with no way out at all.
    const entry = readFileSync('docker/proxy/entrypoint.sh', 'utf8');
    assert.ok(!/>\s*\/etc|>>\s*\/etc|:\s*>\s*\/etc/.test(entry),
      'the proxy entrypoint must not write into /etc at run time');
    // The filter is baked in instead.
    assert.match(readFileSync('docker/proxy/Dockerfile', 'utf8'), /RUN[\s\S]*compile-allowlist\.sh/);
    const conf = readFileSync('docker/proxy/tinyproxy.conf', 'utf8');
    assert.match(conf, /LogFile\s+"\/dev\/stdout"/, 'logging to a file needs a writable disk');
  });

  test('the filesystem is read-only apart from the volume and scratch', () => {
    assert.match(factoryBlock, /read_only:\s*true/);
    assert.match(factoryBlock, /cap_drop:\s*\[ALL\]/);
    assert.match(factoryBlock, /no-new-privileges:true/);
  });
});

describe('the example env file describes this container, not an imagined one', () => {
  // A .env.example naming variables nothing reads is worse than none at all:
  // someone sets one, nothing happens, and they go looking for the bug in
  // their own setup.
  const example = readFileSync('docker/.env.example', 'utf8');
  const upsh = readFileSync('docker/up.sh', 'utf8');
  /** Stands in for a token. Long enough that a length check means something. */
  const SENTINEL = 'sentinel-not-a-real-token-000000';

  test('every variable it names is one compose actually reads', () => {
    const named = [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!);
    assert.ok(named.length > 3, 'the example should document something');
    for (const v of named) {
      if (v === 'CLAUDE_CODE_OAUTH_TOKEN') continue;   // required, checked below
      // Read by compose, or by the launcher that runs before it.
      assert.ok(compose.includes(v) || upsh.includes(v),
        `${v} is in docker/.env.example but neither compose nor up.sh reads it`);
    }
  });

  test('the token is present and empty, so a copy of it cannot carry a secret', () => {
    assert.match(example, /^CLAUDE_CODE_OAUTH_TOKEN=\s*$/m);
    assert.ok(compose.includes('CLAUDE_CODE_OAUTH_TOKEN'), 'compose must require the token');
  });

  /**
   * Run the launcher for real, with a sentinel standing in for the token and a
   * stub standing in for docker.
   *
   * Reading the script and grepping it for `echo $token` was the first attempt
   * and it flagged the line that TRIMS the token, which pipes into `tr` and
   * prints nothing. Guessing at intent from a regex is the wrong tool: run it,
   * and look at what actually came out.
   */
  const launch = (args: string[] = ['up'], credentialsCmd: string | null = null):
  { out: string; curl: string; argv: string; env: string; asked: boolean } => {
    const dir = mkdtempSync(join(tmpdir(), 'riff-launch-'));
    // A stub `docker` that records how it was called, so the test can prove
    // the token was passed by environment and never as an argument.
    writeFileSync(join(dir, 'docker'),
      `#!/bin/sh\nprintf '%s\\n' "$*" > ${dir}/argv\nenv > ${dir}/env\n`, { mode: 0o755 });
    // And a stub `curl`, because the launcher asks a running server to pause
    // its companies before recreating the container. Unstubbed, this suite
    // would reach 127.0.0.1:4173 and pause the operator's real work — the same
    // hole that once delivered a live credential to a running container.
    // It answers a listing once with one company running, then with none, so
    // the drain both acts and terminates.
    writeFileSync(join(dir, 'curl'),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> ${dir}/curl.log\n`
      + `case "$*" in\n`
      + `  *"-X POST"*) exit 0 ;;\n`
      + `esac\n`
      + `if [ -f ${dir}/asked ]; then\n`
      + `  printf '{"companies":[{"slug":"testco","running":false,"awake":[]}]}'\n`
      + `else\n`
      + `  : > ${dir}/asked\n`
      + `  printf '{"companies":[{"slug":"testco","running":true,"awake":[]}]}'\n`
      + `fi\n`, { mode: 0o755 });
    // The stub vault announces itself, so a test can tell whether the password
    // manager was asked to open at all.
    const r = spawnSync('sh', ['docker/up.sh', ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env['PATH'] ?? ''}`,
        RIFF_TOKEN_CMD: `sh -c 'echo VAULT-OPENED >&2; printf %s ${SENTINEL}'`,
        CLAUDE_CODE_OAUTH_TOKEN: '',
        RIFF_ENV: '',
        // Explicitly off, or these reach past the fixture into the operator's
        // own docker/.env and resolve their real credential — which is how
        // this suite once delivered a live record to a running container.
        ...(credentialsCmd != null ? { RIFF_CREDENTIALS_CMD: credentialsCmd } : { RIFF_CREDENTIALS_CMD: '' }),
      },
    });
    assert.equal(r.status, 0, `up.sh ${args.join(' ')} failed: ${r.stderr}`);
    return {
      out: r.stdout,
      curl: existsSync(join(dir, 'curl.log')) ? readFileSync(join(dir, 'curl.log'), 'utf8') : '',
      argv: existsSync(join(dir, 'argv')) ? readFileSync(join(dir, 'argv'), 'utf8') : '',
      env: existsSync(join(dir, 'env')) ? readFileSync(join(dir, 'env'), 'utf8') : '',
      // The stub vault announces itself on stderr when it is opened.
      asked: r.stderr.includes('VAULT-OPENED'),
    };
  };

  test('the launcher resolves the token without ever printing it', () => {
    const { out } = launch();
    assert.ok(!out.includes(SENTINEL), `the token appeared in the output:\n${out}`);
    // The length is what makes "the vault gave me something" distinguishable
    // from "the vault gave me an error message", with nothing on screen.
    assert.match(out, new RegExp(`\\(${SENTINEL.length} characters\\)`));
  });

  test('the token reaches docker by environment, never as an argument', () => {
    // An argument is visible in `ps` to every process on the machine.
    const { argv, env } = launch();
    assert.ok(!argv.includes(SENTINEL), `the token was passed on the command line: ${argv}`);
    assert.match(env, new RegExp(`^CLAUDE_CODE_OAUTH_TOKEN=${SENTINEL}$`, 'm'));
  });

  test('a rebuild pauses what is working before it recreates the container', () => {
    // Compose sends SIGTERM and waits ten seconds; a shift runs for minutes,
    // so recreating under one killed it and the ledger recorded "Claude Code
    // process aborted by user" for work that was going fine.
    const { curl, out } = launch(['up', '--build', '-d']);
    assert.match(curl, /-X POST[^\n]*companies\/testco\/running/,
      `the running company should have been paused first:\n${curl}`);
    assert.match(curl, /"running":false/);
    assert.match(out, /pausing testco/);
  });

  test('reading logs does not pause anybody', () => {
    // Draining is for recreating the container. A subcommand that only reads
    // has no business stopping work.
    assert.equal(launch(['logs']).curl, '');
    assert.equal(launch(['ps']).curl, '');
  });

  test('the launcher never reaches a server on the operator\'s own port by accident', () => {
    // Every request the drain makes has to go through $PORT, so a test can
    // point it somewhere harmless. A hardcoded 4173 would make this suite
    // pause the operator's real companies.
    const src = readFileSync('docker/up.sh', 'utf8');
    const drain = src.slice(src.indexOf('drain() {'), src.indexOf('run_compose "$@"'));
    assert.ok(drain.includes('${PORT:-4173}'), 'the port must come from the environment');
    assert.ok(!/127\.0\.0\.1:4173/.test(drain.replace('${PORT:-4173}', '')),
      'no hardcoded port in the drain');
  });

  test('only the subcommands that start something open the password manager', () => {
    // Unlocking a vault to read `logs`, or to `down` a stack already running,
    // teaches you to approve the prompt without reading it — which is the
    // habit the vault exists to prevent.
    for (const quiet of [['logs'], ['down'], ['ps'], ['config'], ['--profile', 'x', 'ps']]) {
      assert.equal(launch(quiet).asked, false, `${quiet.join(' ')} should not need the token`);
    }
    for (const loud of [['up'], ['up', '--build'], ['restart'], ['run', 'x', 'sh']]) {
      assert.equal(launch(loud).asked, true, `${loud.join(' ')} starts something and needs a real token`);
    }
  });

  /**
   * A bare token can spend the subscription and cannot read what is left of
   * it — the CLI has no subscription record to ask about, so every rate-limit
   * window comes back empty and the throttle has nothing to govern on. A
   * whole night's run was paced off token counts nobody is billed for before
   * anyone noticed, because "no reading" and "plenty of room" looked the same.
   */
  const RECORD = '{"claudeAiOauth":{"accessToken":"sentinel-record-token","subscriptionType":"max"}}';
  const withRecord = (args: string[] = ['up']) =>
    launch(args, `sh -c 'echo VAULT-OPENED >&2; printf %s ${RECORD}'`);

  test('a credentials record is preferred, and never printed', () => {
    const { out } = withRecord();
    assert.ok(!out.includes('sentinel-record-token'), `the record appeared in the output:\n${out}`);
    // A length, not the record: enough to tell "the vault gave me something"
    // from "the vault gave me an error message", with nothing on screen. The
    // exact count is the shell's business, not this test's.
    assert.match(out, /credentials record resolved \(\d+ characters\)/);
  });

  test('the record never reaches docker as an argument', () => {
    const { argv } = withRecord();
    assert.ok(!argv.includes('sentinel-record-token'), `the record was passed on the command line: ${argv}`);
  });

  test('check says plainly which mode you are in', () => {
    assert.match(withRecord(['check']).out, /credentials record is available/);
    assert.match(launch(['check']).out, /plan will NOT be readable/);
  });

  test('something that is not a credentials record is refused, not shipped', () => {
    // Refused before compose is reached, so no docker stub is needed here.
    const r = spawnSync('sh', ['docker/up.sh', 'up'], {
      cwd: new URL('..', import.meta.url).pathname,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: '', RIFF_ENV: '',
             RIFF_CREDENTIALS_CMD: "sh -c 'printf %s not-a-record'" },
    });
    assert.equal(r.status, 1, 'a bad record must stop the launch');
    assert.match(r.stderr, /without a\n?\s*claudeAiOauth record/);
  });

  /**
   * The record lives on a tmpfs, so ANY restart loses it — `docker restart`,
   * a Docker Desktop reboot, a crash and respawn. An entrypoint that gave up
   * on a deadline turned that into a crash loop which took the API down with
   * it, so the launcher could not even be asked to deliver a new one.
   */
  test('the entrypoint waits for a record instead of giving up on it', () => {
    const wait = entrypointSrc.slice(entrypointSrc.indexOf('RIFF_WAIT_FOR_CREDENTIALS'));
    const loop = wait.slice(0, wait.indexOf('exec "$@"'));
    assert.ok(!/\bexit 1\b/.test(loop),
      'the credentials wait must not exit — that is a restart loop, not a diagnosis');
    assert.match(loop, /up\.sh creds/, 'it must say how to recover');
  });

  test('creds re-delivers to a running factory and starts nothing', () => {
    const { out, argv } = withRecord(['creds']);
    assert.match(out, /credentials delivered/);
    assert.ok(!/\bup\b/.test(argv.split('\n')[0] ?? ''), `creds must not start anything: ${argv}`);
  });

  test('creds with nothing configured says so rather than starting', () => {
    const r = spawnSync('sh', ['docker/up.sh', 'creds'], {
      cwd: new URL('..', import.meta.url).pathname,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: '', RIFF_ENV: '',
             RIFF_CREDENTIALS_CMD: '' },
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /nothing configured to fetch a credentials record/);
  });

  test('check proves the wiring and starts nothing', () => {
    // Worth having before an overnight run: everything a start does, right up
    // to the point of starting anything.
    const { out, asked, argv } = launch(['check']);
    assert.equal(asked, true, 'check must actually resolve the token');
    assert.match(out, new RegExp(`a bare token is available \\(${SENTINEL.length} characters\\)`));
    assert.ok(!out.includes(SENTINEL), 'check must not print the token');
    assert.equal(argv, '', 'check must not invoke docker at all');
  });

  test('the launcher writes nothing to disk', () => {
    // A redirect or a tee added here later would undo the whole point of
    // resolving from a password manager, and it would still appear to work.
    const before = readdirSync('docker').sort();
    launch();
    assert.deepEqual(readdirSync('docker').sort(), before, 'up.sh created a file');
    const body = upsh.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    assert.ok(!/\btee\b/.test(body), 'up.sh must not tee the token anywhere');
  });

  test('docker/.env itself is ignored, and stays ignored', () => {
    const ignored = readFileSync('.gitignore', 'utf8');
    assert.match(ignored, /^docker\/\.env$/m);
  });
});

describe('the egress wall lets research through without letting anything out', () => {
  const dir = new URL('../docker/proxy/', import.meta.url).pathname;
  const compile = (extra?: string): string[] => {
    const box = mkdtempSync(join(tmpdir(), 'riff-wall-'));
    const etc = join(box, 'etc', 'tinyproxy');
    mkdirSync(etc, { recursive: true });
    copyFileSync(join(dir, 'allowlist.conf'), join(etc, 'allowlist.conf'));
    // Deliberately no trailing newline: `while read` drops that line without
    // the `|| [ -n "$line" ]` guard, and the last host vanishes silently.
    if (extra !== undefined) writeFileSync(join(etc, 'allowlist.local.conf'), extra);
    const script = readFileSync(join(dir, 'compile-allowlist.sh'), 'utf8')
      .replaceAll('/etc/tinyproxy', etc);
    writeFileSync(join(box, 'c.sh'), script);
    execFileSync('sh', [join(box, 'c.sh')]);
    const out = readFileSync(join(etc, 'filter.re'), 'utf8').split('\n').filter(Boolean);
    rmSync(box, { recursive: true, force: true });
    return out;
  };

  test('every host is anchored, so no lookalike domain gets through', () => {
    const rules = compile();
    // "github.com" unanchored also matches "github.com.evil.example".
    for (const r of rules) {
      assert.match(r, /^\^.+\$$/, `${r} is not anchored`);
      assert.ok(!/(?<!\\)\./.test(r.slice(1, -1)), `${r} has an unescaped dot`);
    }
  });

  test('staff can reach documentation, because training data has a cutoff', () => {
    const rules = compile();
    for (const host of ['docs.anthropic.com', 'pkg.go.dev', 'docs.aws.amazon.com', 'docs.rs']) {
      assert.ok(rules.includes(`^${host.replaceAll('.', '\\.')}$`), `${host} is walled off`);
    }
  });

  test('the token still has nowhere to go', () => {
    // The wall is the whole anti-exfiltration argument: widening it for
    // research must not have opened a general-purpose destination.
    const rules = compile().join('\n');
    for (const bad of ['pastebin.com', 'transfer.sh', 'discord.com', 'requestbin.com']) {
      assert.ok(!rules.includes(bad), `${bad} should not be reachable`);
    }
  });

  test("an operator's own hosts are added without editing the repo", () => {
    const rules = compile('example.internal\nno-trailing-newline.example');
    assert.ok(rules.includes('^example\\.internal$'));
    assert.ok(rules.includes('^no-trailing-newline\\.example$'),
      'a file with no trailing newline must not lose its last host');
  });

  test('an installation that writes no local file behaves exactly as before', () => {
    assert.deepEqual(compile(), compile(''));
  });
});

describe('the session store is somewhere the factory can actually write', () => {
  const compose = readFileSync(new URL('../docker/compose.yaml', import.meta.url), 'utf8');

  test('every tmpfs is owned by the user the factory runs as', () => {
    // A tmpfs mounts root-owned. The factory runs as labs (10001), so an
    // unowned /home/labs is silently unwritable — the CLI keeps no
    // transcripts, every resume fails, and every shift starts cold. That ran
    // for 33 shifts looking healthy the whole time.
    const lines = (compose.match(/^\s+- \/[^\n]*size=\d+m[^\n]*$/gm) ?? []);
    assert.ok(lines.length >= 3, `expected the tmpfs list, found ${lines.length}`);
    for (const l of lines) {
      assert.match(l, /uid=10001/, `tmpfs mounts root-owned: ${l.trim()}`);
      assert.match(l, /gid=10001/, `tmpfs mounts root-owned: ${l.trim()}`);
    }
  });

  test("the CLI's home is one of them", () => {
    // If HOME is not a writable mount, persistSession is a no-op.
    assert.match(compose, /\/home\/labs:size=\d+m,uid=10001/);
  });
});
