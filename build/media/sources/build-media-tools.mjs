import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Build only our required LGPL media functionality. No Homebrew dependencies,
// GPL/nonfree codecs, shared third-party libraries or global tool installation.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'work', 'vendor-source');
const output = path.join(root, 'build', 'media');
const sources = [
  { name: 'ffmpeg', version: '6.1.1', archive: 'ffmpeg-6.1.1.tar.xz', directory: 'ffmpeg-6.1.1', url: 'https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz', sha256: '8684f4b00f94b85461884c3719382f1261f0d9eb3d59640a1f4ac0873616f968' },
  { name: 'zimg', version: '3.0.6', archive: 'zimg-3.0.6.tar.gz', directory: 'zimg-release-3.0.6', url: 'https://github.com/sekrit-twc/zimg/archive/refs/tags/release-3.0.6.tar.gz', sha256: 'be89390f13a5c9b2388ce0f44a5e89364a20c1c57ce46d382b1fcc3967057577' },
  { name: 'snappy', version: '1.2.1', archive: 'snappy-1.2.1.tar.gz', directory: 'snappy-1.2.1', url: 'https://github.com/google/snappy/archive/refs/tags/1.2.1.tar.gz', sha256: '736aeb64d86566d2236ddffa2865ee5d7a82d26c9016b36218fcc27ea4f09f86' },
  { name: 'pkgconf', version: '2.5.1', archive: 'pkgconf-2.5.1.tar.xz', directory: 'pkgconf-2.5.1', url: 'https://distfiles.ariadne.space/pkgconf/pkgconf-2.5.1.tar.xz', sha256: 'cd05c9589b9f86ecf044c10a2269822bc9eb001eced2582cfffd658b0a50c243' },
];
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This build recipe targets native Apple Silicon macOS.');
await fs.mkdir(vendor, { recursive: true });
await fs.mkdir(output, { recursive: true });
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'form-field-media-'));
const prefix = path.join(temporary, 'prefix');
const jobs = String(Math.min(8, os.availableParallelism()));
const environment = { ...process.env, MACOSX_DEPLOYMENT_TARGET: '14.0' };
const logs = path.join(vendor, 'build-logs');
await fs.mkdir(logs, { recursive: true });

async function run(stage, command, args, cwd = temporary, env = environment) {
  console.log(`Media build: ${stage}`);
  const logfile = path.join(logs, `${stage}.log`);
  await new Promise((resolve, reject) => {
    const log = createWriteStream(logfile);
    const child = spawn(command, args, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    child.on('error', error => { log.end(); reject(error); });
    child.on('close', code => { log.end(() => code === 0 ? resolve() : reject(new Error(`${stage} failed (${code}); see ${logfile}`))); });
  });
}

for (const source of sources) {
  const filename = path.join(vendor, source.archive);
  try { await fs.access(filename); }
  catch { await run(`download-${source.name}`, 'curl', ['-fLsS', '--retry', '2', '-o', filename, source.url]); }
  const actual = crypto.createHash('sha256').update(await fs.readFile(filename)).digest('hex');
  if (actual !== source.sha256) throw new Error(`Checksum mismatch for ${source.archive}.`);
  await run(`extract-${source.name}`, 'tar', ['-xf', filename, '-C', temporary]);
}

const source = name => sources.find(entry => entry.name === name);
const pkgSource = path.join(temporary, source('pkgconf').directory);
await run('configure-pkgconf', './configure', [`--prefix=${prefix}`, '--disable-shared', '--enable-static', '--disable-dependency-tracking'], pkgSource);
await run('compile-pkgconf', 'make', [`-j${jobs}`], pkgSource);
await run('install-pkgconf', 'make', ['install'], pkgSource);

// The official zimg tag does not contain generated Autotools scripts. Build
// its unmodified core + ARM/NEON sources using this small explicit CMake recipe.
const zimgSource = path.join(temporary, source('zimg').directory);
const zimgRecipe = path.join(temporary, 'zimg-build-recipe');
await fs.mkdir(zimgRecipe);
const cmake = `cmake_minimum_required(VERSION 3.16)
project(form_field_zimg LANGUAGES CXX)
file(GLOB_RECURSE ZIMG_SOURCES CONFIGURE_DEPENDS "\${ZIMG_SOURCE}/src/zimg/*.cpp")
list(FILTER ZIMG_SOURCES EXCLUDE REGEX "/x86/")
add_library(zimg STATIC \${ZIMG_SOURCES})
target_include_directories(zimg PRIVATE "\${ZIMG_SOURCE}/src/zimg")
target_compile_features(zimg PRIVATE cxx_std_14)
target_compile_definitions(zimg PRIVATE ZIMG_ARM NDEBUG)
target_compile_options(zimg PRIVATE -O2 -fvisibility=hidden)
set_target_properties(zimg PROPERTIES POSITION_INDEPENDENT_CODE ON)
install(TARGETS zimg ARCHIVE DESTINATION lib)
install(FILES "\${ZIMG_SOURCE}/src/zimg/api/zimg.h" "\${ZIMG_SOURCE}/src/zimg/api/zimg++.hpp" DESTINATION include)
`;
await fs.writeFile(path.join(zimgRecipe, 'CMakeLists.txt'), cmake);
await run('configure-zimg', 'cmake', ['-S', zimgRecipe, '-B', path.join(temporary, 'zimg-build'), `-DZIMG_SOURCE=${zimgSource}`, `-DCMAKE_INSTALL_PREFIX=${prefix}`, '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0']);
await run('compile-zimg', 'cmake', ['--build', path.join(temporary, 'zimg-build'), '--parallel', jobs]);
await run('install-zimg', 'cmake', ['--install', path.join(temporary, 'zimg-build')]);
await fs.mkdir(path.join(prefix, 'lib', 'pkgconfig'), { recursive: true });
await fs.writeFile(path.join(prefix, 'lib', 'pkgconfig', 'zimg.pc'), `prefix=${prefix}\nlibdir=\${prefix}/lib\nincludedir=\${prefix}/include\nName: zimg\nDescription: zimg image scaling and colour processing\nVersion: 3.0.6\nLibs: -L\${libdir} -lzimg\nLibs.private: -lc++\nCflags: -I\${includedir}\n`);

// Snappy (BSD-3-Clause) is the compressor required by the HAP encoder, the
// GPU-decoded codec used by projection and VJ playback software.
const snappySource = path.join(temporary, source('snappy').directory);
await run('configure-snappy', 'cmake', ['-S', snappySource, '-B', path.join(temporary, 'snappy-build'), `-DCMAKE_INSTALL_PREFIX=${prefix}`, '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0', '-DBUILD_SHARED_LIBS=OFF', '-DSNAPPY_BUILD_TESTS=OFF', '-DSNAPPY_BUILD_BENCHMARKS=OFF', '-DSNAPPY_INSTALL=ON', '-DCMAKE_POLICY_VERSION_MINIMUM=3.5']);
await run('compile-snappy', 'cmake', ['--build', path.join(temporary, 'snappy-build'), '--parallel', jobs]);
await run('install-snappy', 'cmake', ['--install', path.join(temporary, 'snappy-build')]);
// FFmpeg's configure probes Snappy with -lstdc++, which current macOS SDKs no
// longer ship. Satisfy that name with an empty archive; libc++ is linked via zimg.
await fs.writeFile(path.join(temporary, 'stdcxx-stub.c'), 'void form_field_stdcxx_stub(void) {}\n');
await run('compile-stdcxx-stub', 'cc', ['-c', '-mmacosx-version-min=14.0', '-o', path.join(temporary, 'stdcxx-stub.o'), path.join(temporary, 'stdcxx-stub.c')]);
await run('archive-stdcxx-stub', 'ar', ['rcs', path.join(prefix, 'lib', 'libstdc++.a'), path.join(temporary, 'stdcxx-stub.o')]);

const ffmpegSource = path.join(temporary, source('ffmpeg').directory);
const configure = [
  `--prefix=${prefix}`, '--disable-everything', '--disable-autodetect', '--disable-network',
  '--disable-gpl', '--disable-nonfree', '--disable-shared', '--enable-static', '--disable-doc', '--disable-debug', '--disable-ffplay',
  '--enable-ffmpeg', '--enable-ffprobe', '--enable-pthreads', '--enable-zlib', '--enable-libzimg', '--enable-libsnappy',
  `--pkg-config=${path.join(prefix, 'bin', 'pkgconf')}`, '--pkg-config-flags=--static --keep-system-cflags --keep-system-libs',
  '--enable-protocol=file,pipe', '--enable-indev=lavfi',
  '--enable-demuxer=image2,exr_pipe,png_pipe,mov,rawvideo',
  '--enable-muxer=image2,mov,rawvideo,null,framemd5',
  '--enable-decoder=exr,hap,png,prores,rawvideo,wrapped_avframe',
  '--enable-encoder=exr,hap,png,prores_ks,rawvideo,wrapped_avframe',
  '--enable-parser=png',
  '--enable-filter=alphaextract,color,geq,nullsrc,format,scale,zscale,null,buffer,buffersink',
  `--extra-cflags=-I${path.join(prefix, 'include')}`, `--extra-ldflags=-L${path.join(prefix, 'lib')} -Wl,-dead_strip`, '--extra-libs=-lc++',
];
const ffmpegEnv = { ...environment, PKG_CONFIG_PATH: path.join(prefix, 'lib', 'pkgconfig') };
await run('configure-ffmpeg', './configure', configure, ffmpegSource, ffmpegEnv);
await run('compile-ffmpeg', 'make', [`-j${jobs}`], ffmpegSource, ffmpegEnv);
await run('install-ffmpeg', 'make', ['install'], ffmpegSource, ffmpegEnv);
for (const name of ['ffmpeg', 'ffprobe']) { await fs.copyFile(path.join(prefix, 'bin', name), path.join(output, name)); await fs.chmod(path.join(output, name), 0o755); }

const licensing = spawnSync(path.join(output, 'ffmpeg'), ['-L'], { encoding: 'utf8' });
const licenseReport = licensing.stdout + licensing.stderr;
if (licensing.status !== 0 || !/Lesser General Public License/.test(licenseReport) || /--enable-(gpl|nonfree)|not redistributable/.test(licenseReport)) throw new Error('Built FFmpeg did not pass the LGPL configuration audit.');
for (const binary of ['ffmpeg', 'ffprobe']) {
  const libraries = spawnSync('otool', ['-L', path.join(output, binary)], { encoding: 'utf8' });
  const nonSystem = libraries.stdout.split('\n').slice(1).map(line => line.trim().split(' ')[0]).filter(Boolean).filter(filename => !filename.startsWith('/usr/lib/') && !filename.startsWith('/System/Library/'));
  if (libraries.status !== 0 || nonSystem.length) throw new Error(`Non-system dynamic dependency in ${binary}: ${nonSystem.join(', ')}`);
  await fs.writeFile(path.join(output, `${binary}-dependencies.txt`), libraries.stdout);
}

await fs.mkdir(path.join(output, 'licenses'), { recursive: true });
await fs.mkdir(path.join(output, 'sources'), { recursive: true });
await fs.copyFile(path.join(ffmpegSource, 'COPYING.LGPLv2.1'), path.join(output, 'licenses', 'FFmpeg-LGPL-2.1.txt'));
await fs.copyFile(path.join(ffmpegSource, 'LICENSE.md'), path.join(output, 'licenses', 'FFmpeg-LICENSE.md'));
await fs.copyFile(path.join(zimgSource, 'COPYING'), path.join(output, 'licenses', 'zimg-COPYING.txt'));
await fs.copyFile(path.join(snappySource, 'COPYING'), path.join(output, 'licenses', 'snappy-COPYING.txt'));
await fs.copyFile(fileURLToPath(import.meta.url), path.join(output, 'sources', 'build-media-tools.mjs'));
await fs.writeFile(path.join(output, 'sources', 'zimg-CMakeLists.txt'), cmake);
for (const source of sources) await fs.copyFile(path.join(vendor, source.archive), path.join(output, 'sources', source.archive));
await fs.writeFile(path.join(output, 'ffmpeg-license-report.txt'), licenseReport);
const hashes = {};
for (const name of ['ffmpeg', 'ffprobe']) hashes[name] = crypto.createHash('sha256').update(await fs.readFile(path.join(output, name))).digest('hex');
await fs.writeFile(path.join(output, 'build-manifest.json'), JSON.stringify({ builtAt: new Date().toISOString(), platform: process.platform, architecture: process.arch, minimumMacOS: '14.0', sources, configure, binaries: hashes, buildRoot: temporary, notes: 'Unmodified upstream source, custom ARM CMake build recipe for static zimg, static Snappy for HAP encoding. pkgconf is a build tool only. Only Apple system libraries remain dynamically linked.' }, null, 2));
await fs.writeFile(path.join(output, 'README.txt'), 'Form & Field media tools\n\nFFmpeg 6.1.1 is built from the included official source under LGPL 2.1-or-later, with no GPL or nonfree components. zimg 3.0.6 and Snappy 1.2.1 (used for HAP encoding) are statically linked under their included permissive licenses. pkgconf is used only during compilation.\n\nComplete source archives, the build recipe, checksums, configuration and licenses are included. Rebuild on Apple Silicon macOS with Node.js, Xcode command-line tools and CMake: node scripts/build-media-tools.mjs from the project checkout. No globally installed FFmpeg or third-party shared libraries are required at runtime.\n');
console.log(`LGPL media tools ready: ${output}`);
