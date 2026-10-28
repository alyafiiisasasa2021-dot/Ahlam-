export class VideoRecorderService {
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private animId: number | null = null;
  private isRecording = false;

  public async startRecording(
    avatarImgUrl: string,
    avatarName: string,
    subtitlesText: string,
    options: {
      width?: number;
      height?: number;
      durationSeconds?: number;
      onComplete?: (videoBlob: Blob, videoUrl: string) => void;
      onProgress?: (secondsRemaining: number) => void;
    } = {}
  ): Promise<void> {
    this.stop();
    this.recordedChunks = [];

    const width = options.width || 720;
    const height = options.height || 1280; // Default 9:16 vertical TikTok format
    const duration = options.durationSeconds || 12;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Cannot get 2d context');

    this.canvas = canvas;
    this.ctx = ctx;
    this.isRecording = true;

    // Load Avatar Image
    const avatarImg = new Image();
    avatarImg.crossOrigin = 'anonymous';
    avatarImg.src = avatarImgUrl;
    await new Promise((resolve) => {
      avatarImg.onload = resolve;
      avatarImg.onerror = resolve;
    });

    const stream = canvas.captureStream(30);

    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }

    const recorder = new MediaRecorder(stream, { mimeType });
    this.mediaRecorder = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.recordedChunks.push(event.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(this.recordedChunks, { type: mimeType });
      const videoUrl = URL.createObjectURL(blob);
      options.onComplete?.(blob, videoUrl);
    };

    recorder.start(100);

    // Animation Render Loop
    let startTime = performance.now();
    let frame = 0;

    const render = () => {
      if (!this.isRecording) return;
      frame++;
      const elapsed = (performance.now() - startTime) / 1000;
      const remaining = Math.max(0, Math.ceil(duration - elapsed));
      options.onProgress?.(remaining);

      if (elapsed >= duration) {
        this.stop();
        return;
      }

      // 1. Background Fill with subtle studio gradient
      const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      bgGrad.addColorStop(0, '#0a0d14');
      bgGrad.addColorStop(0.5, '#111827');
      bgGrad.addColorStop(1, '#05070a');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // 2. Avatar Drawing with lifelike subtle sway
      const breathing = Math.sin(frame * 0.05) * 8;
      const sway = Math.cos(frame * 0.03) * 6;

      ctx.save();
      // Draw centered photo
      const imgAspect = (avatarImg.naturalWidth || 1) / (avatarImg.naturalHeight || 1);
      const targetW = width * 1.05;
      const targetH = targetW / imgAspect;
      const x = (width - targetW) / 2 + sway;
      const y = (height - targetH) / 2 + breathing;

      ctx.drawImage(avatarImg, x, y, targetW, targetH);

      // Cinematic Vignette & Bottom Gradient
      const vignette = ctx.createLinearGradient(0, height * 0.5, 0, height);
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vignette.addColorStop(0.7, 'rgba(0, 0, 0, 0.7)');
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.95)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);

      // Top Studio Badge
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.beginPath();
      ctx.roundRect(width - 240, 40, 200, 50, 25);
      ctx.fill();

      // Red LIVE dot
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(width - 210, 65, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px Cairo, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`بث مباشر • ${avatarName}`, width - 60, 72);

      // Animated mouth simulation during video recording
      const mouthOpenness = Math.abs(Math.sin(frame * 0.25));
      const mouthW = 40;
      const mouthH = 6 + mouthOpenness * 18;
      ctx.fillStyle = '#3f1318';
      ctx.beginPath();
      ctx.ellipse(width / 2 + sway, height * 0.53 + breathing, mouthW / 2, mouthH / 2, 0, 0, Math.PI * 2);
      ctx.fill();

      // 3. Subtitles & Karaoke Text at bottom
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.beginPath();
      ctx.roundRect(40, height - 280, width - 80, 180, 24);
      ctx.fill();

      // Subtitle header
      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 18px Cairo, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`🎙️ ${avatarName} يتحدث:`, width - 70, height - 240);

      // Subtitle body text wrapped
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 24px Cairo, sans-serif';
      ctx.direction = 'rtl';
      const cleanSub = subtitlesText.length > 120 ? subtitlesText.slice(0, 120) + '...' : subtitlesText;
      wrapText(ctx, cleanSub, width - 70, height - 195, width - 140, 36);

      // TikTok Watermark / Branding
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = '16px Cairo, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✨ تم الإنشاء عبر استوديو الشخصية الافتراضية الذكية', width / 2, height - 50);

      ctx.restore();

      this.animId = requestAnimationFrame(render);
    };

    this.animId = requestAnimationFrame(render);
  }

  public stop(): void {
    this.isRecording = false;
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch (e) {
        // ignore
      }
    }
  }

  public downloadVideo(url: string, filename = 'avatar_video.webm') {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(' ');
  let line = '';

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;
    if (testWidth > maxWidth && n > 0) {
      ctx.fillText(line, x, y);
      line = words[n] + ' ';
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, y);
}

export const videoRecorder = new VideoRecorderService();
