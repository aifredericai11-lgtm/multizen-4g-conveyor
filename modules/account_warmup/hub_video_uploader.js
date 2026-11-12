'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const WARMUP_VIDEOS_DIR = path.resolve(__dirname, '../../VIDEOS_AQUECIMENTO_PERFIL_PTBR');

function listActiveWarmupVideos() {
  try {
    if (!fs.existsSync(WARMUP_VIDEOS_DIR)) {
      fs.mkdirSync(WARMUP_VIDEOS_DIR, { recursive: true });
      return [];
    }
    const entries = fs.readdirSync(WARMUP_VIDEOS_DIR);
    return entries
      .filter(f => /\.(mp4|mov)$/i.test(f) && !f.startsWith('_tmp_'))
      .map(filename => {
        const fullPath = path.join(WARMUP_VIDEOS_DIR, filename);
        const stat = fs.statSync(fullPath);
        return {
          filename,
          path: fullPath,
          size_bytes: stat.size,
          updated_at: stat.mtime.toISOString()
        };
      });
  } catch (_) {
    return [];
  }
}

function autoEditOperatorWarmupVideo(inputPath, outputPath) {
  const vf = 'hflip,eq=saturation=1.05:brightness=0.01,vignette=PI/6,crop=iw*0.97:ih*0.97,scale=1080:1920:flags=lanczos';
  try {
    execFileSync('ffmpeg', [
      '-y', '-i', inputPath,
      '-vf', vf,
      '-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-map_metadata', '-1',
      '-brand', 'qt',
      '-metadata', 'comment=LvAppName=CapCut',
      '-movflags', '+faststart',
      outputPath
    ], { stdio: 'ignore', timeout: 120000, windowsHide: true });
    return { ok: true, encoder: 'h264_nvenc', path: outputPath };
  } catch (_) {
    execFileSync('ffmpeg', [
      '-y', '-i', inputPath,
      '-vf', vf,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
      '-c:a', 'aac', '-b:a', '128k',
      '-map_metadata', '-1',
      '-brand', 'qt',
      '-metadata', 'comment=LvAppName=CapCut',
      '-movflags', '+faststart',
      outputPath
    ], { stdio: 'ignore', timeout: 180000, windowsHide: true });
    return { ok: true, encoder: 'libx264', path: outputPath };
  }
}

module.exports = {
  WARMUP_VIDEOS_DIR,
  listActiveWarmupVideos,
  autoEditOperatorWarmupVideo
};
