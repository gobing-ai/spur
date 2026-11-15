import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar } from '@gobing-ai/spur-config';

// Drives the real scripts/install.sh against a file:// "release" (SPUR_RELEASE_URL), so the
// checksum and atomic-replace contracts are exercised without the network (task 0971).
const INSTALL_SH = join(import.meta.dir, '../install.sh');
const ASSET = `spur-${process.platform}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`;
const FAKE_BIN = '#!/bin/sh\necho fake-spur "$@"\n';
const HOST_PATH = getEnvVar('PATH') ?? '/usr/bin:/bin';

let root = '';
let release = '';
let bin = '';
let target = '';

const sha256 = (s: string) => new Bun.CryptoHasher('sha256').update(s).digest('hex');
const writeSums = (content: string) => writeFileSync(join(release, 'SHA256SUMS'), content);
const leftovers = () => readdirSync(bin).filter((f) => f.startsWith('.spur-install.'));

function install(extraEnv: Record<string, string> = {}) {
    const res = Bun.spawnSync(['sh', INSTALL_SH], {
        env: {
            PATH: HOST_PATH,
            HOME: root,
            SPUR_INSTALL: bin,
            SPUR_RELEASE_URL: `file://${release}`,
            ...extraEnv,
        },
    });
    return { code: res.exitCode, stdout: res.stdout.toString(), stderr: res.stderr.toString() };
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'install-sh-'));
    release = join(root, 'release');
    bin = join(root, 'bin');
    target = join(bin, 'spur');
    mkdirSync(release);
    mkdirSync(bin);
    writeFileSync(join(release, ASSET), FAKE_BIN);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('scripts/install.sh checksum verification (task 0971)', () => {
    test('happy path: verified binary is installed executable with no temp leftovers', () => {
        writeSums(`${sha256(FAKE_BIN)}  ${ASSET}\n`);
        const { code, stderr } = install();
        expect(code, stderr).toBe(0);
        expect(readFileSync(target, 'utf8')).toBe(FAKE_BIN);
        expect(statSync(target).mode & 0o111).not.toBe(0);
        expect(leftovers()).toEqual([]);
    });

    test('AC2: checksum mismatch fails and leaves the existing install untouched', () => {
        writeFileSync(target, 'OLD');
        writeSums(`${'0'.repeat(64)}  ${ASSET}\n`);
        const { code, stderr } = install();
        expect(code).not.toBe(0);
        expect(stderr).toContain(`checksum mismatch for ${ASSET}`);
        expect(readFileSync(target, 'utf8')).toBe('OLD');
        expect(leftovers()).toEqual([]);
    });

    test('AC3: a failed download never destroys a working install', () => {
        writeFileSync(target, 'OLD');
        writeSums(`${sha256(FAKE_BIN)}  ${ASSET}\n`);
        rmSync(join(release, ASSET));
        const { code, stderr } = install();
        expect(code).not.toBe(0);
        expect(stderr).toContain('download failed');
        expect(readFileSync(target, 'utf8')).toBe('OLD');
        expect(leftovers()).toEqual([]);
    });

    test('AC3: an interrupted transfer (partial bytes, then curl error) never replaces the install', () => {
        // A missing file:// source makes curl fail before it opens `-o`, so it cannot tell a
        // temp-file download from a direct-to-target one; a partial write then failure can.
        writeFileSync(target, 'OLD');
        writeSums(`${sha256(FAKE_BIN)}  ${ASSET}\n`);
        const shim = join(root, 'shim');
        mkdirSync(shim);
        writeFileSync(
            join(shim, 'curl'),
            '#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = -o ] && printf PARTIAL > "$2"; shift; done\nexit 56\n',
            { mode: 0o755 },
        );
        const { code, stderr } = install({ PATH: `${shim}:${HOST_PATH}` });
        expect(code).not.toBe(0);
        expect(stderr).toContain('download failed');
        expect(readFileSync(target, 'utf8')).toBe('OLD');
        expect(leftovers()).toEqual([]);
    });

    test('R4: missing SHA256SUMS fails naming the URL; SPUR_SKIP_VERIFY=1 is the only bypass', () => {
        writeFileSync(target, 'OLD');
        const denied = install();
        expect(denied.code).not.toBe(0);
        expect(denied.stderr).toContain(`file://${release}/SHA256SUMS`);
        expect(readFileSync(target, 'utf8')).toBe('OLD');

        const skipped = install({ SPUR_SKIP_VERIFY: '1' });
        expect(skipped.code, skipped.stderr).toBe(0);
        expect(skipped.stderr).toContain(`WARNING — installing ${ASSET} WITHOUT checksum verification`);
        expect(readFileSync(target, 'utf8')).toBe(FAKE_BIN);
    });

    test('R3: SHA256SUMS without an entry for the asset fails loudly', () => {
        writeSums(`${sha256(FAKE_BIN)}  spur-other-os\n`);
        const { code, stderr } = install();
        expect(code).not.toBe(0);
        expect(stderr).toContain(`no SHA256SUMS entry for ${ASSET}`);
        expect(existsSync(target)).toBe(false);
        expect(leftovers()).toEqual([]);
    });
});

function shim(dir: string, name: string, body: string): void {
    writeFileSync(join(dir, name), body, { mode: 0o755 });
}

describe('scripts/install.sh optional zg and a2a dependencies (1340)', () => {
    test('existing zg and a2a are never reinstalled', () => {
        const fake = join(root, 'fake');
        mkdirSync(fake);
        shim(fake, 'zg', '#!/bin/sh\nexit 0\n');
        shim(fake, 'a2a', '#!/bin/sh\nexit 0\n');
        shim(fake, 'brew', '#!/bin/sh\necho brew >> "$HOME/package-calls"\nexit 1\n');
        shim(fake, 'npm', '#!/bin/sh\necho npm >> "$HOME/package-calls"\nexit 1\n');
        shim(fake, 'curl', '#!/bin/sh\nexec /usr/bin/curl "$@"\n');
        writeSums(`${sha256(FAKE_BIN)}  ${ASSET}\n`);
        const { code, stderr } = install({ PATH: `${fake}:/usr/bin:/bin` });
        expect(code, stderr).toBe(0);
        expect(existsSync(join(root, 'package-calls'))).toBe(false);
    });

    test('missing CLIs use Homebrew for both dependencies', () => {
        const fake = join(root, 'fake');
        mkdirSync(fake);
        shim(
            fake,
            'brew',
            `#!/bin/sh
printf '%s\n' "$*" >> "$HOME/brew-calls"
if [ "$1" = tap ]; then exit 0; fi
if [ "$1" != install ]; then exit 1; fi
shift
for name do
  case "$name" in
    zvec-grep) printf '#!/bin/sh\nexit 0\n' > "$SPUR_INSTALL/zg" ;;
    a2a) printf '#!/bin/sh\nexit 0\n' > "$SPUR_INSTALL/a2a" ;;
    *) exit 1 ;;
  esac
  chmod +x "$SPUR_INSTALL/$name"
done
`,
        );
        shim(fake, 'npm', '#!/bin/sh\necho npm >> "$HOME/package-calls"\nexit 1\n');
        shim(fake, 'curl', '#!/bin/sh\nexec /usr/bin/curl "$@"\n');
        writeSums(`${sha256(FAKE_BIN)}  ${ASSET}\n`);
        const { code, stderr } = install({ PATH: `${fake}:/usr/bin:/bin` });
        expect(code, stderr).toBe(0);
        expect(readFileSync(join(root, 'brew-calls'), 'utf8')).toContain('install a2a');
        expect(readFileSync(join(root, 'brew-calls'), 'utf8')).toContain('install zvec-grep');
        expect(readFileSync(join(root, 'brew-calls'), 'utf8')).toContain('tap a2aproject/a2a-cli');
        expect(existsSync(join(root, 'package-calls'))).toBe(false);
    });

    test('npm installs zg and the official a2a installer handles a2a when brew is absent', () => {
        const fake = join(root, 'fake');
        mkdirSync(fake);
        shim(
            fake,
            'npm',
            `#!/bin/sh
printf '%s\n' "$*" > "$HOME/npm-calls"
printf '#!/bin/sh\nexit 0\n' > "$SPUR_INSTALL/zg"
chmod +x "$SPUR_INSTALL/zg"
`,
        );
        shim(
            fake,
            'curl',
            `#!/bin/sh
if [ "$1" = 'https://raw.githubusercontent.com/a2aproject/a2a-cli/main/install.sh' ]; then
  cat > "$2" <<'EOF'
#!/bin/sh
printf '#!/bin/sh\nexit 0\n' > "$A2A_INSTALL_DIR/a2a"
chmod +x "$A2A_INSTALL_DIR/a2a"
EOF
  exit 0
fi
exec /usr/bin/curl "$@"
`,
        );
        writeSums(`${sha256(FAKE_BIN)}  ${ASSET}\n`);
        const { code, stderr } = install({ PATH: `${fake}:/usr/bin:/bin` });
        expect(code, stderr).toBe(0);
        expect(readFileSync(join(root, 'npm-calls'), 'utf8')).toContain('--allow-scripts=@zvec/zvec-grep');
        expect(existsSync(join(bin, 'zg'))).toBe(true);
        expect(existsSync(join(bin, 'a2a'))).toBe(true);
    });

    test('dependency failures warn with manual remedies and never abort Spur', () => {
        const fake = join(root, 'fake');
        mkdirSync(fake);
        shim(
            fake,
            'curl',
            `#!/bin/sh
case "$*" in
  *a2a-cli/main/install.sh*) exit 1 ;;
esac
exec /usr/bin/curl "$@"
`,
        );
        writeSums(`${sha256(FAKE_BIN)}  ${ASSET}\n`);
        const { code, stderr } = install({ PATH: `${fake}:/usr/bin:/bin` });
        expect(code, stderr).toBe(0);
        expect(stderr).toContain('brew install zvec-grep');
        expect(stderr).toContain('npm install -g @zvec/zvec-grep --allow-scripts=@zvec/zvec-grep');
        expect(stderr).toContain(
            'curl -fsSL https://raw.githubusercontent.com/a2aproject/a2a-cli/main/install.sh | bash',
        );
    });

    test('each dependency has an independent opt-out', () => {
        const fake = join(root, 'fake');
        mkdirSync(fake);
        shim(fake, 'brew', '#!/bin/sh\necho brew >> "$HOME/package-calls"\nexit 1\n');
        shim(fake, 'npm', '#!/bin/sh\necho npm >> "$HOME/package-calls"\nexit 1\n');
        shim(fake, 'curl', '#!/bin/sh\nexec /usr/bin/curl "$@"\n');
        writeSums(`${sha256(FAKE_BIN)}  ${ASSET}\n`);
        const { code, stdout, stderr } = install({
            PATH: `${fake}:/usr/bin:/bin`,
            SPUR_INSTALL_ZG: '0',
            SPUR_INSTALL_A2A: '0',
        });
        expect(code, stderr).toBe(0);
        expect(stdout).toContain('SPUR_INSTALL_ZG=0');
        expect(stdout).toContain('SPUR_INSTALL_A2A=0');
        expect(existsSync(join(root, 'package-calls'))).toBe(false);
    });
});
