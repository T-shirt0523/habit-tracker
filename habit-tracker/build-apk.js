/**
 * 自律打卡 · APK 构建脚本（不用 Gradle，直接走 SDK 原生编译链）
 *
 *   aapt2 compile → aapt2 link → javac → d8 → 塞入 classes.dex
 *   → zipalign → apksigner 签名
 *
 * 用法： node build-apk.js
 * 依赖： D:\android-toolchain 下的 JDK 17 + Android SDK(build-tools 34 / platform 34)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TOOL = 'D:\\android-toolchain';
const JAVA_HOME = path.join(TOOL, 'jdk');
const SDK = path.join(TOOL, 'sdk');
const BT = path.join(SDK, 'build-tools', '34.0.0');
const AJAR = path.join(SDK, 'platforms', 'android-34', 'android.jar');
const PROJ = __dirname;
const ANDROID = path.join(PROJ, 'android');
// 编译全程在 ASCII 目录下进行，规避 Windows 批处理对中文路径的编码损坏
const WORK = path.join(TOOL, 'build-habit');

const JAVA = path.join(JAVA_HOME, 'bin', 'java.exe');
const JAVAC = path.join(JAVA_HOME, 'bin', 'javac.exe');
const KEYTOOL = path.join(JAVA_HOME, 'bin', 'keytool.exe');
const AAPT2 = path.join(BT, 'aapt2.exe');
const ZIPALIGN = path.join(BT, 'zipalign.exe');
const D8_JAR = path.join(BT, 'lib', 'd8.jar');
const SIGNER_JAR = path.join(BT, 'lib', 'apksigner.jar');
const ENV = Object.assign({}, process.env, {
  JAVA_HOME,
  ANDROID_HOME: SDK,
  ANDROID_SDK_ROOT: SDK,
  PATH: path.join(JAVA_HOME, 'bin') + ';' + BT + ';' + process.env.PATH,
});

const APP_NAME = '自律打卡';
const OUT_APK = path.join(PROJ, APP_NAME + '-1.0.apk');
const KEYSTORE = path.join(WORK, 'habit.keystore');

function run(label, bin, args, opts) {
  process.stdout.write('  ' + label + ' ... ');
  try {
    const out = execFileSync(bin, args, Object.assign({ env: ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, opts || {}));
    console.log('OK');
    return out;
  } catch (e) {
    console.log('FAILED');
    console.log('    exit=' + e.status);
    if (e.stdout) console.log('    stdout: ' + String(e.stdout).trim().split('\n').slice(-12).join('\n    '));
    if (e.stderr) console.log('    stderr: ' + String(e.stderr).trim().split('\n').slice(-12).join('\n    '));
    throw new Error(label + ' failed');
  }
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

console.log('\n=== 0. 准备构建目录 (ASCII) ===');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
copyDir(ANDROID, WORK);
// Web 应用本体直接取自项目根的 index.html —— 单一真源，避免两份不同步
fs.mkdirSync(path.join(WORK, 'assets'), { recursive: true });
fs.copyFileSync(path.join(PROJ, 'index.html'), path.join(WORK, 'assets', 'index.html'));
console.log('  web 资源: index.html -> assets/ (' + fs.statSync(path.join(WORK, 'assets', 'index.html')).size + ' bytes)');

console.log('\n=== 1. aapt2 compile ===');
run('compile', AAPT2, ['compile', '--dir', 'res', '-o', 'res.zip'], { cwd: WORK });

console.log('\n=== 2. aapt2 link ===');
run('link', AAPT2, [
  'link', '-o', 'base.apk',
  '-I', AJAR,
  '--manifest', 'AndroidManifest.xml',
  '-A', 'assets',
  '--min-sdk-version', '26',
  '--target-sdk-version', '34',
  '--version-code', '1',
  '--version-name', '1.0',
  'res.zip',
], { cwd: WORK });

console.log('\n=== 3. javac ===');
run('javac', JAVAC, [
  '-encoding', 'UTF-8', '-source', '8', '-target', '8',
  '-classpath', AJAR,
  '-d', 'classes',
  path.join('java', 'com', 'wren', 'habitapp', 'MainActivity.java'),
], { cwd: WORK });

console.log('\n=== 4. d8 (dex) ===');
fs.mkdirSync(path.join(WORK, 'dex'), { recursive: true });   // d8 要求输出目录已存在
run('d8', JAVA, [
  '-cp', D8_JAR, 'com.android.tools.r8.D8',
  '--min-api', '26', '--lib', AJAR,
  '--output', 'dex',
  path.join('classes', 'com', 'wren', 'habitapp', 'MainActivity.class'),
], { cwd: WORK });
if (!fs.existsSync(path.join(WORK, 'dex', 'classes.dex'))) throw new Error('classes.dex 未生成');
console.log('  classes.dex = ' + fs.statSync(path.join(WORK, 'dex', 'classes.dex')).size + ' bytes');

console.log('\n=== 5. 把 classes.dex 塞进 apk ===');
{
  const apk = path.join(WORK, 'base.apk');
  const dex = path.join(WORK, 'dex', 'classes.dex');
  // CreateEntryFromFile 是扩展方法，PowerShell 不能直接点调用，必须走 ZipFileExtensions 静态类
  const ps = [
    "$ErrorActionPreference='Stop';",
    'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
    `$z=[System.IO.Compression.ZipFile]::Open('${apk}','Update');`,
    `[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z,'${dex}','classes.dex',[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null;`,
    '$n=$z.Entries.Count; $z.Dispose();',
    `'entries=' + $n`,
  ].join(' ');
  const out = run('embed dex', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', ps]);
  if (out && out.trim()) console.log('    ' + out.trim());
  // 硬校验：不信返回值，直接看字节里有没有 classes.dex
  const buf = fs.readFileSync(apk);
  if (!buf.includes(Buffer.from('classes.dex'))) throw new Error('classes.dex 未写入 APK（静默失败）');
  console.log('    classes.dex 已确认存在于 APK 中');
}

console.log('\n=== 6. zipalign ===');
run('zipalign', ZIPALIGN, ['-f', '-p', '4', 'base.apk', 'aligned.apk'], { cwd: WORK });

console.log('\n=== 7. 签名证书 ===');
if (!fs.existsSync(KEYSTORE)) {
  run('keytool', KEYTOOL, [
    '-genkeypair', '-v',
    '-keystore', KEYSTORE,
    '-alias', 'habit',
    '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10950',
    '-storepass', 'android', '-keypass', 'android',
    '-dname', 'CN=Wren, OU=HabitApp, O=Wren, L=Shenzhen, ST=Guangdong, C=CN',
  ]);
} else {
  console.log('  已存在，复用');
}

console.log('\n=== 8. apksigner 签名 ===');
const signArgs = [
  'sign', '--ks', KEYSTORE,
  '--ks-key-alias', 'habit',
  '--ks-pass', 'pass:android',
  '--key-pass', 'pass:android',
  '--v1-signing-enabled', 'true',
  '--v2-signing-enabled', 'true',
  '--out', 'signed.apk',
  'aligned.apk',
];
if (fs.existsSync(SIGNER_JAR)) {
  run('apksigner', JAVA, ['-jar', SIGNER_JAR].concat(signArgs), { cwd: WORK });
} else {
  run('apksigner.bat', path.join(BT, 'apksigner.bat'), signArgs, { cwd: WORK, shell: true });
}

console.log('\n=== 9. 校验签名 ===');
const v = run('verify', JAVA, ['-jar', SIGNER_JAR, 'verify', '--print-certs', 'signed.apk'], { cwd: WORK });
console.log(v.split('\n').filter(l => l.trim()).map(l => '    ' + l.trim()).join('\n'));

console.log('\n=== 10. 校验包内容 ===');
{
  const buf = fs.readFileSync(path.join(WORK, 'signed.apk'));
  const must = ['classes.dex', 'AndroidManifest.xml', 'resources.arsc', 'assets/index.html'];
  let allOk = true;
  for (const name of must) {
    const ok = buf.includes(Buffer.from(name));
    if (!ok) allOk = false;
    console.log('  ' + (ok ? '[OK]  ' : '[MISS]') + ' ' + name);
  }
  if (!allOk) throw new Error('APK 内容不完整');
}
console.log(run('dump badging', AAPT2, ['dump', 'badging', 'signed.apk'], { cwd: WORK })
  .split('\n').filter(l => /package:|sdkVersion|targetSdkVersion|application-label|launchable-activity|application-icon-160/.test(l))
  .map(l => '    ' + l.trim()).join('\n'));

console.log('\n=== 11. 输出 ===');
fs.copyFileSync(path.join(WORK, 'signed.apk'), OUT_APK);
console.log('  ' + OUT_APK);
console.log('  ' + (fs.statSync(OUT_APK).size / 1024).toFixed(1) + ' KB');
console.log('\n完成。\n');
