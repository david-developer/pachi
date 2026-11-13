import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import Module, { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseAllDocuments } from 'yaml';
const mobile = createRequire(new URL('../apps/mobile/package.json', import.meta.url));
const expo = createRequire(mobile.resolve('expo/package.json'));
const cli = createRequire(expo.resolve('@expo/cli/package.json'));
const fingerprint = createRequire(expo.resolve('@expo/fingerprint/package.json'));
const glob = cli('glob');
const scenario = process.argv[2] === '--toolchain-fixture' ? process.argv[3] : undefined;
const files = {
  'ios/A/AppDelegate.swift': '', 'ios/A/Info.plist': '', 'ios/A/A.entitlements': '',
  'ios/A.xcodeproj/project.pbxproj': '', 'ios/A.xcodeproj/xcshareddata/xcschemes/A.xcscheme': '',
  'ios/Podfile': '', 'app/index.tsx': '', 'app/[id].tsx': '', 'src/a.ts': '', 'src/types.d.ts': '',
  '.gitignore': '*.tmp\n', 'nested/.gitignore': 'ignored.txt\n', 'nested/ignored.txt': '',
  'nested/keep.txt': '', 'value.tmp': '', 'native/file.txt': 'synthetic',
  'node_modules/.gitignore': '*\n', 'node_modules/x/a.ts': '', '.hidden/.gitignore': '*\n',
  'package.json': JSON.stringify({ name: 'synthetic-fingerprint', version: '1.0.0' }),
};
if (scenario) {
  const root = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), 'pachi-toolchain-'));
  try {
    for (const [file, data] of Object.entries(files)) { await mkdir(dirname(join(directory, file)), { recursive: true }); await writeFile(join(directory, file), data); }
    await symlink('nested', join(directory, 'linked'));
    if (scenario === 'glob') {
      const options = { cwd: directory, ignore: ['node_modules/**'], nodir: true };
      assert.equal(glob.sync, glob.globSync);
      assert.deepEqual(glob.globSync('ios/*/AppDelegate.@(m|mm|swift)', options), ['ios/A/AppDelegate.swift']);
      assert.deepEqual(glob.globSync('ios/*/Info.plist', options), ['ios/A/Info.plist']);
      assert.deepEqual(glob.globSync('ios/*/*.entitlements', options), ['ios/A/A.entitlements']);
      assert.deepEqual(glob.globSync('ios/*.xcodeproj/xcshareddata/xcschemes/*.xcscheme', options), ['ios/A.xcodeproj/xcshareddata/xcschemes/A.xcscheme']);
      const expected = ['app/[id].tsx', 'app/index.tsx', 'src/a.ts', 'src/types.d.ts'];
      assert.deepEqual(glob.globSync('**/*.@(ts|tsx)', options).sort(), expected);
      const actualCli = cli('./build/src/utils/glob.js');
      assert.deepEqual((await actualCli.everyMatchAsync('**/*.@(ts|tsx)', options)).sort(), expected);
      const stream = []; for await (const value of glob.globStream('**/*.@(ts|tsx)', options)) stream.push(value);
      assert.deepEqual(stream.sort(), expected);
      const reason = new Error('Synthetic cancellation'); let reads = 0;
      const filesystem = { ...fs, readdir(...args) { reads++; return fs.readdir(...args); } };
      await assert.rejects(glob.glob('**/*', { cwd: directory, signal: AbortSignal.abort(reason), fs: filesystem }), /Synthetic cancellation/);
      assert.equal(reads, 0);
      const abort = new AbortController();
      const midway = { ...fs, readdir(...args) { reads++; abort.abort(reason); return fs.readdir(...args); } };
      await assert.rejects(glob.glob('**/*', { cwd: directory, signal: abort.signal, fs: midway }), /Synthetic cancellation/);
      await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(reads, 1);
      // Upstream glob 14.0.6 regression: ignore patterns must receive the same
      // bounded expansion limit as traversal patterns (GHSA-qxr8-q827-836c).
      const amplified = Array.from({ length: 14 }, (_, i) => `**/../x${i}/y${i}`).join('/');
      assert.throws(() => glob.globSync('*', { cwd: directory, ignore: [amplified] }), RangeError);
      await assert.rejects(glob.glob('*', { cwd: directory, ignore: [amplified] }), RangeError);
    } else if (scenario === 'estree') {
      const require = createRequire(new URL('../package.json', import.meta.url));
      const parser = require('@typescript-eslint/parser');
      const parserRequire = createRequire(require.resolve('@typescript-eslint/parser/package.json'));
      const estree = createRequire(parserRequire.resolve('@typescript-eslint/typescript-estree/package.json'));
      assert.equal(estree('minimatch/package.json').version, '11.0.8');
      await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true }, include: ['src/**/*.ts'] }));
      const code = 'export const synthetic: number = 1;';
      try {
        for (const [file, pattern] of [['config.ts', '*.ts'], ['.config.ts', '*.ts'], ['config.ts', '{config,other}.ts'], ['config.ts', '@(config|other).ts']]) {
          parser.clearCaches(); await writeFile(join(directory, file), code);
          const parsed = parser.parseForESLint(code, { filePath: join(directory, file), tsconfigRootDir: directory, projectService: { allowDefaultProject: [pattern] } });
          assert.equal(parsed.ast.type, 'Program');
          assert.equal(parsed.ast.body[0].type, 'ExportNamedDeclaration');
          assert.ok(parsed.services.program.getSourceFile(join(directory, file)));
        }
        parser.clearCaches();
        assert.throws(() => parser.parseForESLint(code, { filePath: join(directory, 'config.ts'), tsconfigRootDir: directory, projectService: { allowDefaultProject: ['other.ts'] } }), /not found by the project service/);
      } finally { parser.clearCaches(); }
    } else {
      assert.equal(scenario, 'fingerprint');
      const file = fingerprint.resolve('./build/ProjectWorkflow.js');
      const source = fs.readFileSync(file, 'utf8'); assert.doesNotMatch(source, /require\(["']glob["']\)/);
      // Expose the unchanged internal class only in this isolated test module.
      const internal = new Module(file); internal.filename = file; internal.paths = Module._nodeModulePaths(dirname(file));
      internal._compile(source + '\nexports.TestIgnore = Ignore;\n', file);
      const ignore = new internal.exports.TestIgnore(directory); await ignore.initIgnoreAsync();
      for (const [path, result] of [['value.tmp', true], ['nested/ignored.txt', true], ['nested/keep.txt', false], ['native/file.txt', false], ['node_modules/a.js', true], ['linked/keep.txt', false]]) assert.equal(ignore.ignores(path), result, path);
      process.chdir(directory);
      const { createFingerprintAsync } = fingerprint('./build/Fingerprint.js');
      const options = { platforms: [], silent: true, extraSources: [{ type: 'dir', filePath: 'native', reasons: ['synthetic-test'] }] };
      const first = await createFingerprintAsync(directory, options);
      assert.deepEqual(await createFingerprintAsync(directory, options), first);
      await writeFile(join(directory, 'native/file.txt'), 'changed synthetic');
      assert.notEqual((await createFingerprintAsync(directory, options)).hash, first.hash);
    }
  } finally { process.chdir(root); await rm(directory, { recursive: true, force: true }); }
} else {
  test('all affected glob parents use the reviewed version and fingerprint no longer declares glob', () => {
    const documents = parseAllDocuments(fs.readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')).map(d => d.toJSON());
    const packages = Object.assign({}, ...documents.map(d => d.packages ?? {}));
    assert.deepEqual(Object.keys(packages).filter(k => k.startsWith('glob@')).sort(), ['glob@14.0.6', 'glob@7.2.3']);
    const parents = new Set();
    for (const document of documents) for (const [name, value] of Object.entries(document.snapshots ?? {})) {
      if (value.dependencies?.glob === '14.0.6') parents.add(name.split('(')[0]);
      if (name.startsWith('@expo/fingerprint@')) assert.equal(value.dependencies?.glob, undefined);
    }
    assert.deepEqual([...parents].sort(), ['@expo/cli@55.0.11', '@expo/config-plugins@54.0.5', '@expo/config-plugins@55.0.11', '@expo/config@12.0.14', '@expo/config@55.0.21', '@expo/metro-config@55.0.8'].sort());
    assert.equal(cli('glob/package.json').version, '14.0.6');
  });
  for (const fixture of ['glob', 'fingerprint', 'estree']) test(`${fixture} preserves actual consumer behavior in a bounded synthetic child`, () => {
    const child = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url), '--toolchain-fixture', fixture], { encoding: 'utf8', timeout: 30_000, maxBuffer: 256 * 1024, env: { ...process.env, EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1' } });
    assert.ifError(child.error); assert.equal(child.signal, null, child.stderr); assert.equal(child.status, 0, child.stderr || child.stdout);
  });
  test('retained direct matchers preserve their APIs and are not represented as remediated', () => {
    const matcher = fingerprint('minimatch');
    assert.equal(fingerprint('minimatch/package.json').version, '10.2.6');
    assert.equal(typeof matcher.makeRe, 'function');
    assert.equal(matcher.makeRe('**/*.ts').test('src/a.ts'), true);
    const paths = fingerprint('./build/utils/Path.js');
    assert.equal(paths.isIgnoredPath('a/', ['a/?(b)']), true);
    assert.equal(paths.isIgnoredPath('a/', ['a/!(b)']), true);
  });
}
