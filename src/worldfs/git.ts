import { execFileSync } from 'node:child_process';
import { realpathSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The world's own git repo.
 *
 * The point of this file: commits are authored AS the staff member who made
 * the change. `git log` in world/ is therefore a complete, attributed,
 * diffable record of what everyone did while you were away — which is a
 * better answer to "what happened?" than any query I could write.
 *
 * execFile with an argv array throughout; nothing reaches a shell, so a staff
 * member naming a file `; rm -rf ~` is inert.
 */
export class WorldGit {
  #dir: string;

  constructor(dir: string) { this.#dir = dir; }

  #git(args: string[]): string {
    return execFileSync('git', ['-C', this.#dir, ...args], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      // Capture stderr rather than inheriting it. Several calls here are
      // probes whose failure is expected and handled — notably the
      // "is this already a repo?" check on a directory that is not one yet.
      // Inheriting would print `fatal: not a git repository` on every first
      // run and make a healthy bootstrap look broken.
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  }

  init(): void {
    // `rev-parse --git-dir` WALKS UP. When world/ sits inside another repo it
    // reports the ancestor's git dir, so "am I a repo?" answers yes for a
    // directory that has never been initialised — and every subsequent commit
    // lands in the parent repo instead. Compare the toplevel to our own path.
    try {
      const top = this.#git(['rev-parse', '--show-toplevel']);
      if (realpathSync(top) === realpathSync(this.#dir)) return;
    } catch {
      // Not inside any repo. Fall through and initialise.
    }
    this.#git(['init', '-q', '-b', 'main']);
    this.#git(['config', 'user.name', 'Helmsted']);
    this.#git(['config', 'user.email', 'helmsted@localhost']);
    this.#ignoreDroppings();
  }

  /**
   * The world's git log is the company's record of what it did, and every
   * artifact count is drawn from it. Finder writes .DS_Store into any folder
   * someone opens, and `git add -A` picks them up — so the operator browsing
   * the world in a file manager silently authors commits in the staff's name
   * and inflates the created-artifact count they are measured on.
   */
  #ignoreDroppings(): void {
    const path = join(this.#dir, '.gitignore');
    if (existsSync(path)) return;
    writeFileSync(path, ['.DS_Store', 'Thumbs.db', 'desktop.ini', ''].join('\n'), 'utf8');
    // Committed here rather than left in the tree: an uncommitted file is
    // swept up by whoever commits next, and infrastructure must not land in a
    // staff member's name or count toward what they made.
    this.#git(['add', '.gitignore']);
    this.#git([
      '-c', 'user.name=Helmsted', '-c', 'user.email=helmsted@localhost',
      'commit', '-q', '-m', 'Ignore what the operating system drops here',
    ]);
  }

  isDirty(): boolean {
    return this.#git(['status', '--porcelain']).length > 0;
  }

  /**
   * Commit whatever the staff member just changed, in their name.
   * Returns the sha, or null when there was nothing to record.
   */
  commitAs(actor: { id: string; name: string }, message: string): string | null {
    this.#git(['add', '-A']);
    const staged = this.#git(['diff', '--cached', '--name-only']);
    if (!staged) return null;

    this.#git([
      '-c', `user.name=${actor.name}`,
      '-c', `user.email=${actor.id}@inn.local`,
      'commit', '-q', '-m', message,
    ]);
    return this.#git(['rev-parse', 'HEAD']);
  }

  /** "What did they do while I was gone?" — e.g. since('3.days'). */
  since(when: string): Array<{ sha: string; author: string; at: string; subject: string }> {
    const out = this.#git(['log', `--since=${when}`, '--pretty=format:%h%x00%an%x00%aI%x00%s']);
    if (!out) return [];
    return out.split('\n').map((line) => {
      const [sha = '', author = '', at = '', subject = ''] = line.split('\0');
      return { sha, author, at, subject };
    });
  }

  /** Per-author change counts — the honest version of "who did the work". */
  contributionsSince(when: string): Array<{ author: string; commits: number }> {
    const out = this.#git(['shortlog', '-sn', '--all', `--since=${when}`]);
    if (!out) return [];
    return out.split('\n').map((l) => {
      const m = /^\s*(\d+)\s+(.*)$/.exec(l);
      return { author: m?.[2] ?? l.trim(), commits: Number(m?.[1] ?? 0) };
    });
  }

  diffOf(sha: string): string {
    return this.#git(['show', '--stat', '--pretty=format:%an %s', sha]);
  }
}
