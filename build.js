const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

async function buildTarget(target) {
  const outDir = path.join(DIST, target);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`\n🔨 Building for \x1b[36m${target.toUpperCase()}\x1b[0m -> dist/${target}`);

  // 1. Bundle TypeScript files
  await esbuild.build({
    entryPoints: {
      background: path.join(SRC, 'background/background.ts'),
      content: path.join(SRC, 'content/content.ts'),
      popup: path.join(SRC, 'popup/popup.ts'),
      history: path.join(SRC, 'history/history.ts'),
    },
    bundle: true,
    outdir: outDir,
    format: 'iife',
    platform: 'browser',
    target: ['chrome100', 'firefox100'],
    sourcemap: process.env.NODE_ENV === 'development',
    minify: process.env.NODE_ENV === 'production',
  });

  // 2. Copy static files
  fs.copyFileSync(path.join(SRC, 'popup/popup.html'), path.join(outDir, 'popup.html'));
  fs.copyFileSync(path.join(SRC, 'popup/popup.css'), path.join(outDir, 'popup.css'));
  fs.copyFileSync(path.join(SRC, 'history/history.html'), path.join(outDir, 'history.html'));
  fs.copyFileSync(path.join(SRC, 'history/history.css'), path.join(outDir, 'history.css'));

  // Copy icons
  const iconDestDir = path.join(outDir, 'icons');
  fs.mkdirSync(iconDestDir, { recursive: true });
  const iconSrcDir = path.join(ROOT, 'icons');
  if (fs.existsSync(iconSrcDir)) {
    for (const iconFile of fs.readdirSync(iconSrcDir)) {
      if (iconFile.endsWith('.png')) {
        fs.copyFileSync(path.join(iconSrcDir, iconFile), path.join(iconDestDir, iconFile));
      }
    }
  }

  // 3. Generate Manifest
  const manifest = {
    manifest_version: 3,
    name: 'Whisper Live Subtitles',
    version: '1.0.0',
    description: 'Real-time subtitles for HTML5 video elements powered by whisper-cli live transcription',
    permissions: ['storage', 'activeTab'],
    host_permissions: ['http://localhost/*', 'http://127.0.0.1/*', '<all_urls>'],
    action: {
      default_popup: 'popup.html',
      default_icon: {
        '16': 'icons/icon16.png',
        '48': 'icons/icon48.png',
        '128': 'icons/icon128.png',
      },
    },
    icons: {
      '16': 'icons/icon16.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png',
    },
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['content.js'],
        all_frames: true,
        run_at: 'document_idle',
      },
    ],
  };

  if (target === 'firefox') {
    manifest.browser_specific_settings = {
      gecko: {
        id: 'whisper-sub-injector@local',
        strict_min_version: '109.0',
      },
    };
    manifest.background = {
      scripts: ['background.js'],
    };
  } else {
    // Chrome MV3
    manifest.background = {
      service_worker: 'background.js',
    };
  }

  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  console.log(`✅ ${target.toUpperCase()} build ready in dist/${target}/`);
}

async function run() {
  const targets = process.argv.slice(2);
  const selectedTargets = targets.length > 0 ? targets : ['chrome', 'firefox'];

  fs.rmSync(DIST, { recursive: true, force: true });

  for (const target of selectedTargets) {
    if (target !== 'chrome' && target !== 'firefox') {
      console.error(`Unknown target: ${target}. Must be 'chrome' or 'firefox'`);
      process.exit(1);
    }
    await buildTarget(target);
  }

  console.log('\n🎉 Dual build finished successfully!\n');
}

run().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
