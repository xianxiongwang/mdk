import degit from 'degit';

/**
 * Converts a GitHub "tree" URL into a degit source spec.
 *
 * `https://github.com/<owner>/<repo>/tree/<ref>/<path...>`
 *   → `<owner>/<repo>/<path...>#<ref>`
 *
 * Note: refs containing slashes are not supported by this parser (single-segment
 * refs like `main` or `v1.2.3` only). That is sufficient for our pinned URLs.
 */
export function toDegitSrc(treeUrl: string): string {
  const match = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+?)\/?$/.exec(treeUrl);
  if (!match) {
    throw new Error(`Not a GitHub tree URL: ${treeUrl}`);
  }
  const [, owner, repo, ref, path] = match;
  return `${owner}/${repo}/${path}#${ref}`;
}

/**
 * Downloads a single subdirectory of a GitHub repo into `dest` using the same
 * "download tarball, extract one subtree" technique as `create-next-app`.
 *
 * Requires network access to resolve the ref's commit hash (via `git ls-remote`).
 * `cache` is intentionally left off: with it enabled degit only reads a local
 * `map.json` and never resolves the hash online, so a cold cache always fails.
 * With it off, degit still reuses a previously downloaded `<hash>.tar.gz` under
 * `~/.degit`, so repeat runs of the same commit skip the download.
 */
export async function fetchTemplate(treeUrl: string, dest: string, force = false): Promise<void> {
  const emitter = degit(toDegitSrc(treeUrl), { cache: false, force, verbose: false });
  await emitter.clone(dest);
}
