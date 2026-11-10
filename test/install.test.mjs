// Pins install.sh against a temp HOME, a file:// clone of this repo and an npm
// stub first on PATH that logs its calls, so the real HOME and npm prefix are
// never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });

function setup(t, extra = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "loft-install-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const home = join(tmp, "home"), src = join(tmp, "src"), bin = join(tmp, "bin"), log = join(tmp, "npm.log");
  mkdirSync(home); mkdirSync(bin);
  assert.equal(git(tmp, "clone", "--quiet", ROOT, src).status, 0);
  writeFileSync(join(bin, "npm"), `#!/bin/sh\necho "$PWD $*" >> "${log}"\n`);
  chmodSync(join(bin, "npm"), 0o755);
  const env = { ...process.env, HOME: home, LOFT_REPO: `file://${src}`, PATH: `${bin}:${process.env.PATH}` };
  delete env.LOFT_DIR;
  Object.assign(env, typeof extra === "function" ? extra(home) : extra);
  const install = () => spawnSync("bash", [join(ROOT, "install.sh")], { env, encoding: "utf8" });
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
  return { home, src, install, calls, dir: env.LOFT_DIR || join(home, ".loft") };
}

test("I1: install clones into ~/.loft, then runs npm link there", (t) => {
  const { install, calls, dir } = setup(t);
  const r = install();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Cloning loft to .*\.loft/);
  assert.ok(existsSync(join(dir, ".git")) && existsSync(join(dir, "loft.mjs")));
  assert.deepEqual(calls(), [`${dir} link --silent`]);
  assert.match(r.stdout, /loft installed at .*\.loft/);
});

test("I1: a second run pulls instead of re-cloning, and links again", (t) => {
  const { install, calls, dir, src } = setup(t);
  assert.equal(install().status, 0);
  writeFileSync(join(src, "pulled.txt"), "new\n");
  git(src, "add", "pulled.txt");
  assert.equal(git(src, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "x").status, 0);
  const r = install();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /already at .* pulling latest/);
  assert.doesNotMatch(r.stdout, /Cloning/);
  assert.ok(existsSync(join(dir, "pulled.txt")));
  assert.deepEqual(calls(), [`${dir} link --silent`, `${dir} link --silent`]);
});

test("I1: LOFT_DIR moves the install", (t) => {
  const { install, calls, dir, home } = setup(t, (home) => ({ LOFT_DIR: join(home, "elsewhere") }));
  const r = install();
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(dir, "loft.mjs")));
  assert.ok(!existsSync(join(home, ".loft")));
  assert.deepEqual(calls(), [`${dir} link --silent`]);
});

test("I1: a node older than engines.node stops before linking, with the fix", (t) => {
  const { install, calls, home } = setup(t);
  const fake = join(home, "..", "bin", "node");
  writeFileSync(fake, `#!/bin/sh\nexec "${process.execPath}" -e 'Object.defineProperty(process.versions,"node",{value:"20.0.0"});eval(process.argv[1])' "$2"\n`);
  chmodSync(fake, 0o755);
  const r = install();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /node 20\.0\.0 < 22\.16\. Upgrade Node/);
  assert.deepEqual(calls(), []);
});
