/// <reference types="vite/client" />
import React, { useState, useRef, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { Upload, Settings, Download, Play, Loader2, Video, MousePointer2, RefreshCw, Eraser, SquareDashed, Sparkles, Edit3, Crop, Lock, Unlock, Grid, FlipHorizontal, CheckSquare, Trash2, X, Check, Scissors, Pause } from 'lucide-react';
import FrameEditor from './components/FrameEditor';

// Import local FFmpeg core files to avoid CDN CORS/CORP issues
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [gifUrl, setGifUrl] = useState<string>('');
  const [isGif, setIsGif] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState('');
  
  // Settings
  const [targetColor, setTargetColor] = useState('#000000');
  const [similarity, setSimilarity] = useState(30); // 0-100
  const [blend, setBlend] = useState(10); // 0-100
  const [colorFloodMode, setColorFloodMode] = useState<'contiguous' | 'global'>('global');
  const [colorPickPosition, setColorPickPosition] = useState<{x: number, y: number} | null>(null);
  const [fps, setFps] = useState(12); // 1-30
  const [outputWidth, setOutputWidth] = useState(480);
  const [outputHeight, setOutputHeight] = useState(480);
  const [resampleMethod, setResampleMethod] = useState('neighbor');
  const [crop, setCrop] = useState<{x: number, y: number, w: number, h: number} | null>(null);
  const [originalDimensions, setOriginalDimensions] = useState<{w: number, h: number} | null>(null);
  const [cropDragging, setCropDragging] = useState<'nw' | 'ne' | 'sw' | 'se' | 'move' | null>(null);
  const [cropStart, setCropStart] = useState<{x: number, y: number, cropX: number, cropY: number, cropW: number, cropH: number} | null>(null);
  const [aiThreshold, setAiThreshold] = useState(0); // 0-100
  const [flipHorizontal, setFlipHorizontal] = useState(false);

  // Video Trim (in seconds)
  const [videoDuration, setVideoDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [trimDragging, setTrimDragging] = useState<'start' | 'end' | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const trimTrackRef = useRef<HTMLDivElement | null>(null);

  // Interaction Mode
  const [interactionMode, setInteractionMode] = useState<'color' | 'watermark' | 'ai' | 'crop'>('color');
  const [watermarkRect, setWatermarkRect] = useState<{x: number, y: number, w: number, h: number} | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState<{x: number, y: number} | null>(null);

  // Frame Editing
  const [frames, setFrames] = useState<{filename: string, url: string}[]>([]);
  const [selectedFrame, setSelectedFrame] = useState<{filename: string, url: string} | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedFilenames, setSelectedFilenames] = useState<Set<string>>(new Set());
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [isDraggingFrames, setIsDraggingFrames] = useState(false);
  const dragMovingRef = useRef<Set<string>>(new Set());
  const framesGridRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef<number | null>(null);
  const pointerYRef = useRef<number>(0);
  const dragOverCleanupRef = useRef<(() => void) | null>(null);
  const [isRebuilding, setIsRebuilding] = useState(false);

  // Sprite Sheet (output)
  const [spriteSheetUrl, setSpriteSheetUrl] = useState<string>('');
  const [spriteCols, setSpriteCols] = useState<number>(0);
  const [spriteRows, setSpriteRows] = useState<number>(0);
  const [isGeneratingSprite, setIsGeneratingSprite] = useState(false);

  // Sprite Sheet (input)
  const [isSpriteSheet, setIsSpriteSheet] = useState(false);
  const [spriteInputCols, setSpriteInputCols] = useState(4);
  const [spriteInputRows, setSpriteInputRows] = useState(4);

  const ffmpegRef = useRef(new FFmpeg());
  const mediaRef = useRef<HTMLVideoElement & HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logParserRef = useRef<((msg: string) => void) | null>(null);

  useEffect(() => {
    if (frames.length > 0) {
      const cols = Math.ceil(Math.sqrt(frames.length));
      const rows = Math.ceil(frames.length / cols);
      setSpriteCols(cols);
      setSpriteRows(rows);
      setSpriteSheetUrl('');
    }
  }, [frames.length]);

  const generateSpriteSheet = async () => {
    if (frames.length === 0) return;
    setIsGeneratingSprite(true);
    try {
      // Load first frame to get dimensions
      const firstFrameImg = new Image();
      firstFrameImg.src = frames[0].url;
      await new Promise(r => firstFrameImg.onload = r);
      
      const frameW = firstFrameImg.width;
      const frameH = firstFrameImg.height;
      
      const canvas = document.createElement('canvas');
      canvas.width = spriteCols * frameW;
      canvas.height = spriteRows * frameH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("No 2d context");
      
      // Load all images
      const images = await Promise.all(frames.map(frame => {
        return new Promise<HTMLImageElement>((resolve) => {
          const img = new Image();
          img.src = frame.url;
          img.onload = () => resolve(img);
        });
      }));
      
      // Draw images
      images.forEach((img, idx) => {
        const col = idx % spriteCols;
        const row = Math.floor(idx / spriteCols);
        ctx.drawImage(img, col * frameW, row * frameH);
      });
      
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (blob) {
        const url = URL.createObjectURL(blob);
        setSpriteSheetUrl(url);
      }
    } catch (err) {
      console.error("Error generating sprite sheet:", err);
      alert("Error generating sprite sheet");
    } finally {
      setIsGeneratingSprite(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const ffmpeg = ffmpegRef.current;
        ffmpeg.on('log', ({ message }) => {
          console.log(message);
          if (logParserRef.current) logParserRef.current(message);
        });
        ffmpeg.on('progress', ({ progress }) => setProgress(Math.round(progress * 100)));
        
        // Load FFmpeg using local URLs
        await ffmpeg.load({
          coreURL,
          wasmURL,
        });
        setLoaded(true);
      } catch (error) {
        console.error("Error loading FFmpeg:", error);
      }
    };
    load();
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isImage = file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp';
    if (file.type.startsWith('video/') || file.type === 'image/gif' || isImage) {
      const isGifFile = file.type === 'image/gif';
      setVideoFile(file);
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setGifUrl('');
      setWatermarkRect(null);
      setFrames([]);
      setSelectedFrame(null);
      setIsGif(isGifFile);
      setIsSpriteSheet(isImage);
      setOriginalDimensions(null);
      setCrop(null);
      setFlipHorizontal(false);
      setVideoDuration(0);
      setTrimStart(0);
      setTrimEnd(0);

      if (isGifFile) {
        setGifUrl(url);
        setIsProcessing(true);
        setProcessingStatus('Analyzing GIF...');
        
        try {
          const ffmpeg = ffmpegRef.current;
          await clearFfmpegFrames();
          await ffmpeg.writeFile('input.gif', await fetchFile(file));
          
          let detectedFps = 12;
          let detectedWidth = 480;
          let detectedHeight = 480;
          
          logParserRef.current = (message: string) => {
            // Match FPS from stream info line only (e.g. "25 fps," with trailing comma)
            // to avoid matching progress lines like "frame=  103 fps=25"
            const fpsMatch = message.match(/(\d+(?:\.\d+)?)\s+fps,/);
            if (fpsMatch) detectedFps = Math.round(parseFloat(fpsMatch[1]));
            
            const resMatch = message.match(/Video:.*?,.*?,\s*(\d+)x(\d+)/);
            if (resMatch) {
              detectedWidth = parseInt(resMatch[1], 10);
              detectedHeight = parseInt(resMatch[2], 10);
            }
          };
          
          await ffmpeg.exec(['-i', 'input.gif', '-f', 'null', '-']);
          logParserRef.current = null;
          
          setFps(detectedFps || 12);
          const w = detectedWidth || 480;
          const h = detectedHeight || 480;
          setOriginalDimensions({ w, h });
          setCrop({ x: 0, y: 0, w, h });
          setOutputWidth(w);
          setOutputHeight(h);
          
          setProcessingStatus('Extracting frames...');
          await ffmpeg.exec([
            '-i', 'input.gif',
            'frame_%04d.png'
          ]);
          
          const files = await ffmpeg.listDir('/');
          const frameFiles = files
            .filter(f => typeof f.name === 'string' && f.name.startsWith('frame_') && f.name.endsWith('.png'))
            .sort((a, b) => a.name.localeCompare(b.name));
            
          const newFrames = [];
          for (const f of frameFiles) {
            const data = await ffmpeg.readFile(f.name);
            const blob = new Blob([data as BlobPart], { type: 'image/png' });
            newFrames.push({ filename: f.name, url: URL.createObjectURL(blob) });
          }
          setFrames(newFrames);
        } catch (err) {
          console.error("Error processing GIF:", err);
        } finally {
          setIsProcessing(false);
          setProcessingStatus('');
        }
      }
    }
  };

  const clearFfmpegFrames = async () => {
    try {
      const ffmpeg = ffmpegRef.current;
      const files = await ffmpeg.listDir('/');
      for (const file of files) {
        if (typeof file.name === 'string' && file.name.startsWith('frame_') && file.name.endsWith('.png')) {
          await ffmpeg.deleteFile(file.name);
        }
      }
    } catch (e) {
      console.warn("Error clearing ffmpeg frames", e);
    }
  };

  const handleMediaLoad = () => {
    const media = mediaRef.current;
    if (!media) return;
    const w = isGif ? (media as HTMLImageElement).naturalWidth : (media as HTMLVideoElement).videoWidth;
    const h = isGif ? (media as HTMLImageElement).naturalHeight : (media as HTMLVideoElement).videoHeight;
    
    if (!originalDimensions) {
      setOriginalDimensions({ w, h });
      setCrop({ x: 0, y: 0, w, h });
      setOutputWidth(w);
      setOutputHeight(h);
    }

    // Capture duration for trimming (video only)
    if (!isGif) {
      const dur = (media as HTMLVideoElement).duration;
      if (isFinite(dur) && dur > 0 && videoDuration === 0) {
        setVideoDuration(dur);
        setTrimStart(0);
        setTrimEnd(dur);
      }
    }
  };

  const formatTime = (sec: number) => {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.round((sec - Math.floor(sec)) * 1000);
    return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  };

  const timeFromClientX = (clientX: number) => {
    const track = trimTrackRef.current;
    if (!track || videoDuration <= 0) return 0;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    return ratio * videoDuration;
  };

  const handleTrimPointerDown = (which: 'start' | 'end') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTrimDragging(which);
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* noop */ }
    // Pause preview while scrubbing
    const media = mediaRef.current;
    if (media && !isGif) { try { media.pause(); } catch { /* noop */ } }
  };

  const handleTrimPointerMove = (e: React.PointerEvent) => {
    if (!trimDragging) return;
    const t = timeFromClientX(e.clientX);
    const media = mediaRef.current;
    if (trimDragging === 'start') {
      const nt = Math.max(0, Math.min(t, trimEnd - 0.05));
      setTrimStart(nt);
      if (media && !isGif) { try { media.currentTime = nt; } catch { /* noop */ } }
    } else {
      const nt = Math.min(videoDuration, Math.max(t, trimStart + 0.05));
      setTrimEnd(nt);
      if (media && !isGif) { try { media.currentTime = nt; } catch { /* noop */ } }
    }
  };

  const handleTrimPointerUp = () => {
    if (!trimDragging) return;
    setTrimDragging(null);
    // Resume preview from the selected start
    const media = mediaRef.current;
    if (media && !isGif) {
      try {
        media.currentTime = trimStart;
        media.play();
      } catch { /* noop */ }
    }
  };

  // Loop playback within the trimmed segment and keep the playhead in sync
  const handleTimeUpdate = () => {
    const media = mediaRef.current;
    if (!media || isGif) return;
    const t = media.currentTime;
    if (videoDuration > 0 && trimEnd > trimStart && (t >= trimEnd || t < trimStart - 0.05)) {
      try { media.currentTime = trimStart; } catch { /* noop */ }
      setCurrentTime(trimStart);
      return;
    }
    setCurrentTime(t);
  };

  const togglePlayPause = () => {
    const media = mediaRef.current;
    if (!media || isGif) return;
    if (media.paused) {
      // If the playhead is outside the segment, jump to start before playing
      if (media.currentTime >= trimEnd || media.currentTime < trimStart) {
        try { media.currentTime = trimStart; } catch { /* noop */ }
      }
      media.play();
    } else {
      media.pause();
    }
  };

  const rgbToHex = (r: number, g: number, b: number) => {
    return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1).toUpperCase();
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (cropDragging) return; // Let the crop handle take care of it
    const media = mediaRef.current;
    if (!media || !originalDimensions) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = originalDimensions.w / rect.width;
    const scaleY = originalDimensions.h / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    if (interactionMode === 'color') {
      const canvas = canvasRef.current;
      if (!canvas) return;

      canvas.width = originalDimensions.w;
      canvas.height = originalDimensions.h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(media, 0, 0, canvas.width, canvas.height);
      const pixel = ctx.getImageData(x, y, 1, 1).data;
      const hex = rgbToHex(pixel[0], pixel[1], pixel[2]);
      setTargetColor(hex);
      setColorPickPosition({ x: Math.round(x), y: Math.round(y) });
    } else if (interactionMode === 'watermark') {
      setStartPos({ x, y });
      setIsDrawing(true);
      setWatermarkRect({ x, y, w: 0, h: 0 });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!originalDimensions) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = originalDimensions.w / rect.width;
    const scaleY = originalDimensions.h / rect.height;

    if (cropDragging && cropStart) {
      const dx = (e.clientX - cropStart.x) * scaleX;
      const dy = (e.clientY - cropStart.y) * scaleY;
      
      let newX = cropStart.cropX;
      let newY = cropStart.cropY;
      let newW = cropStart.cropW;
      let newH = cropStart.cropH;
      
      if (cropDragging === 'move') {
        newX = Math.max(0, Math.min(cropStart.cropX + dx, originalDimensions.w - newW));
        newY = Math.max(0, Math.min(cropStart.cropY + dy, originalDimensions.h - newH));
      } else {
        if (cropDragging.includes('w')) {
          newX = Math.max(0, Math.min(cropStart.cropX + dx, cropStart.cropX + cropStart.cropW - 10));
          newW = cropStart.cropX + cropStart.cropW - newX;
        }
        if (cropDragging.includes('e')) {
          newW = Math.max(10, Math.min(cropStart.cropW + dx, originalDimensions.w - cropStart.cropX));
        }
        if (cropDragging.includes('n')) {
          newY = Math.max(0, Math.min(cropStart.cropY + dy, cropStart.cropY + cropStart.cropH - 10));
          newH = cropStart.cropY + cropStart.cropH - newY;
        }
        if (cropDragging.includes('s')) {
          newH = Math.max(10, Math.min(cropStart.cropH + dy, originalDimensions.h - cropStart.cropY));
        }
      }
      
      setCrop({ x: Math.round(newX), y: Math.round(newY), w: Math.round(newW), h: Math.round(newH) });
      setOutputHeight(Math.max(1, Math.round(outputWidth * (newH / newW))));
      return;
    }

    if (interactionMode === 'watermark' && isDrawing && startPos) {
      const currentX = Math.max(0, Math.min((e.clientX - rect.left) * scaleX, originalDimensions.w));
      const currentY = Math.max(0, Math.min((e.clientY - rect.top) * scaleY, originalDimensions.h));
      
      setWatermarkRect({
        x: Math.min(startPos.x, currentX),
        y: Math.min(startPos.y, currentY),
        w: Math.abs(currentX - startPos.x),
        h: Math.abs(currentY - startPos.y)
      });
    }
  };

  const handlePointerUp = () => {
    if (cropDragging) {
      setCropDragging(null);
      setCropStart(null);
      return;
    }
    if (interactionMode === 'watermark' && isDrawing) {
      setIsDrawing(false);
      // If the rect is too small, just clear it
      if (watermarkRect && (watermarkRect.w < 5 || watermarkRect.h < 5)) {
        setWatermarkRect(null);
      }
    }
  };

  const handleCropPointerDown = (e: React.PointerEvent, type: 'nw' | 'ne' | 'sw' | 'se' | 'move') => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setCropDragging(type);
    if (crop) {
      setCropStart({
        x: e.clientX,
        y: e.clientY,
        cropX: crop.x,
        cropY: crop.y,
        cropW: crop.w,
        cropH: crop.h
      });
    }
  };

  const handleCropPointerUp = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setCropDragging(null);
    setCropStart(null);
  };

  const handleCropInputChange = (dimension: 'w' | 'h', value: number) => {
    if (!crop || !originalDimensions) return;
    const val = Math.max(10, value || 0);
    let newCrop = { ...crop };
    if (dimension === 'w') {
      newCrop.w = Math.min(val, originalDimensions.w - crop.x);
    } else {
      newCrop.h = Math.min(val, originalDimensions.h - crop.y);
    }
    setCrop(newCrop);
    setOutputHeight(Math.max(1, Math.round(outputWidth * (newCrop.h / newCrop.w))));
  };

  const handleOutputInputChange = (dimension: 'w' | 'h', value: number) => {
    if (!crop) return;
    const val = Math.max(1, value || 0);
    if (dimension === 'w') {
      setOutputWidth(val);
      setOutputHeight(Math.max(1, Math.round(val * (crop.h / crop.w))));
    } else {
      setOutputHeight(val);
      setOutputWidth(Math.max(1, Math.round(val * (crop.w / crop.h))));
    }
  };

  const convertToGif = async () => {
    if (!videoFile) return;
    setIsProcessing(true);
    setProgress(0);
    setProcessingStatus('Starting...');
    setGifUrl('');
    setFrames([]);
    setSelectedFrame(null);
    
    try {
      const ffmpeg = ffmpegRef.current;
      await clearFfmpegFrames();
      const inputFile = isGif ? 'input.gif' : 'input.mp4';
      await ffmpeg.writeFile(inputFile, await fetchFile(videoFile));

      // Trim: seek to start (fast input seek) and limit duration (output option)
      const useTrim = !isGif && videoDuration > 0 && trimEnd > trimStart &&
        (trimStart > 0.001 || trimEnd < videoDuration - 0.001);
      const trimSeekArgs = useTrim ? ['-ss', trimStart.toFixed(3)] : [];
      const trimDurationArgs = useTrim ? ['-t', (trimEnd - trimStart).toFixed(3)] : [];

      if (interactionMode === 'ai') {
        setProcessingStatus('Loading AI model (may take a while the first time)...');
        
        // Dynamically import transformers to save bundle size
        const { pipeline, env } = await import('@huggingface/transformers');
        env.allowLocalModels = false;
        
        // Load ModNet model for background removal
        const segmenter = await pipeline('background-removal', 'Xenova/modnet', {
          revision: 'main'
        });

        let extractVf = '';
        if (crop) {
          extractVf += `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},`;
        }
        if (flipHorizontal) {
          extractVf += `hflip,`;
        }
        extractVf += `scale=${outputWidth}:${outputHeight}:flags=${resampleMethod},fps=${fps}`;

        setProcessingStatus('Extracting frames from media...');
        // Extract frames
        await ffmpeg.exec([
          ...trimSeekArgs,
          '-i', inputFile,
          ...trimDurationArgs,
          '-vf', extractVf,
          '-pix_fmt', 'rgba',
          'frame_%04d.png'
        ]);

        const files = await ffmpeg.listDir('/');
        const frameFiles = files
          .filter(f => typeof f.name === 'string' && f.name.startsWith('frame_') && f.name.endsWith('.png'))
          .sort((a, b) => a.name.localeCompare(b.name));

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("No 2d context");

        for (let i = 0; i < frameFiles.length; i++) {
          setProcessingStatus(`Processing frame ${i + 1} of ${frameFiles.length}...`);
          setProgress(Math.round((i / frameFiles.length) * 100));

          const file = frameFiles[i];
          const data = await ffmpeg.readFile(file.name);
          const blob = new Blob([data as BlobPart], { type: 'image/png' });
          const imgUrl = URL.createObjectURL(blob);

          const img = new Image();
          img.src = imgUrl;
          await new Promise(r => img.onload = r);

          // Run background removal
          const output = await segmenter(imgUrl);
          
          // Apply AI edge cleanup if threshold > 0
          if (aiThreshold > 0) {
            const thresholdValue = (aiThreshold / 100) * 255;
            for (let j = 3; j < output.data.length; j += 4) {
              if (output.data[j] < thresholdValue) {
                output.data[j] = 0; // Make fully transparent
              }
            }
          }

          // The background-removal pipeline returns a RawImage with the alpha channel already applied
          const outBlob = await output.toBlob('image/png');

          // Save back to FFmpeg
          if (outBlob) {
            const outBuffer = await outBlob.arrayBuffer();
            await ffmpeg.writeFile(file.name, new Uint8Array(outBuffer));
          }

          URL.revokeObjectURL(imgUrl);
        }

        // Read all frames to state for editing
        const updatedFiles = await ffmpeg.listDir('/');
        const updatedFrameFiles = updatedFiles
          .filter(f => typeof f.name === 'string' && f.name.startsWith('frame_') && f.name.endsWith('.png'))
          .sort((a, b) => a.name.localeCompare(b.name));
          
        const newFrames = [];
        for (const file of updatedFrameFiles) {
          const data = await ffmpeg.readFile(file.name);
          const blob = new Blob([data as BlobPart], { type: 'image/png' });
          const url = URL.createObjectURL(blob);
          newFrames.push({ filename: file.name, url });
        }
        setFrames(newFrames);

        const paletteFilter = resampleMethod === 'neighbor'
          ? 'split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128:dither=none'
          : 'split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128';

        setProcessingStatus('Generating final GIF...');
        await ffmpeg.exec([
          '-framerate', fps.toString(),
          '-i', 'frame_%04d.png',
          '-vf', paletteFilter,
          '-c:v', 'gif',
          '-gifflags', '-offsetting',
          '-y',
          'output.gif'
        ]);

      } else {
        setProcessingStatus('Applying filters and extracting frames...');
        let vf = '';
        
        // If a watermark area is selected, draw a box of the target color over it
        // so the colorkey filter will make it transparent.
        if (watermarkRect && watermarkRect.w > 0 && watermarkRect.h > 0) {
          const actualX = Math.round(watermarkRect.x);
          const actualY = Math.round(watermarkRect.y);
          const actualW = Math.max(1, Math.round(watermarkRect.w));
          const actualH = Math.max(1, Math.round(watermarkRect.h));

          const boxColor = targetColor.replace('#', '0x');
          vf += `drawbox=x=${actualX}:y=${actualY}:w=${actualW}:h=${actualH}:color=${boxColor}:t=fill,`;
          
          // Always apply colorkey for watermark to remove the box
          const colorHex = targetColor.replace('#', '0x');
          const sim = Math.max(0.01, similarity / 100).toFixed(2);
          const blnd = (blend / 100).toFixed(2);
          vf += `colorkey=${colorHex}:${sim}:${blnd},`;
        } else if (colorFloodMode === 'global' && similarity > 0 && (targetColor !== '#000000' || interactionMode === 'color')) {
          const colorHex = targetColor.replace('#', '0x');
          const sim = (similarity / 100).toFixed(2);
          const blnd = (blend / 100).toFixed(2);
          vf += `colorkey=${colorHex}:${sim}:${blnd},`;
        }

        if (crop) {
          vf += `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},`;
        }

        if (flipHorizontal) {
          vf += `hflip,`;
        }

        vf += `scale=${outputWidth}:${outputHeight}:flags=${resampleMethod},fps=${fps}`;

        const execArgs = [
          ...trimSeekArgs,
          '-i', inputFile,
          ...trimDurationArgs,
          '-an', // Ignorar stream de audio
          '-sn', // Ignorar subtítulos
          '-vf', vf,
          '-pix_fmt', 'rgba',
          'frame_%04d.png'
        ];
        
        await ffmpeg.exec(execArgs);

        // Read all frames to state for editing
        const updatedFiles = await ffmpeg.listDir('/');
        const updatedFrameFiles = updatedFiles
          .filter(f => typeof f.name === 'string' && f.name.startsWith('frame_') && f.name.endsWith('.png'))
          .sort((a, b) => a.name.localeCompare(b.name));

        // Apply contiguous flood fill if mode is contiguous and a color was picked
        if (colorFloodMode === 'contiguous' && colorPickPosition && similarity > 0 && originalDimensions) {
          const floodCanvas = document.createElement('canvas');
          const floodCtx = floodCanvas.getContext('2d');
          if (floodCtx) {
            const seedX = Math.round(colorPickPosition.x * (outputWidth / originalDimensions.w));
            const seedY = Math.round(colorPickPosition.y * (outputHeight / originalDimensions.h));

            const tr = parseInt(targetColor.slice(1, 3), 16);
            const tg = parseInt(targetColor.slice(3, 5), 16);
            const tb = parseInt(targetColor.slice(5, 7), 16);
            const maxDistSq = 195075;
            const thresholdSq = maxDistSq * Math.pow(similarity / 100, 2);

            for (let i = 0; i < updatedFrameFiles.length; i++) {
              setProcessingStatus(`Applying contiguous flood fill on frame ${i + 1} of ${updatedFrameFiles.length}...`);
              setProgress(Math.round((i / updatedFrameFiles.length) * 100));

              const file = updatedFrameFiles[i];
              const rawData = await ffmpeg.readFile(file.name);
              const blob = new Blob([rawData as BlobPart], { type: 'image/png' });
              const imgUrl = URL.createObjectURL(blob);
              const img = new Image();
              img.src = imgUrl;
              await new Promise(r => img.onload = r);

              floodCanvas.width = img.width;
              floodCanvas.height = img.height;
              floodCtx.clearRect(0, 0, img.width, img.height);
              floodCtx.drawImage(img, 0, 0);
              URL.revokeObjectURL(imgUrl);

              const imgData = floodCtx.getImageData(0, 0, img.width, img.height);
              const px = imgData.data;
              const w = img.width;
              const h = img.height;

              const sx = Math.min(Math.max(seedX, 0), w - 1);
              const sy = Math.min(Math.max(seedY, 0), h - 1);
              const seedIdx = (sy * w + sx) * 4;
              if (px[seedIdx + 3] !== 0) {
                const colorMatch = (r: number, g: number, b: number, a: number) => {
                  if (a === 0) return false;
                  const distSq = (r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2;
                  return distSq <= thresholdSq;
                };

                const visited = new Uint8Array(w * h);
                const queue = [sx, sy];
                visited[sy * w + sx] = 1;

                while (queue.length > 0) {
                  const cy = queue.pop()!;
                  const cx = queue.pop()!;
                  const idx = (cy * w + cx) * 4;
                  px[idx + 3] = 0;

                  const neighbors = [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]];
                  for (const [nx, ny] of neighbors) {
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                      const nIdx = ny * w + nx;
                      if (!visited[nIdx]) {
                        visited[nIdx] = 1;
                        const pIdx = nIdx * 4;
                        if (colorMatch(px[pIdx], px[pIdx+1], px[pIdx+2], px[pIdx+3])) {
                          queue.push(nx, ny);
                        }
                      }
                    }
                  }
                }

                floodCtx.putImageData(imgData, 0, 0);

                const outBlob = await new Promise<Blob | null>(resolve => floodCanvas.toBlob(resolve, 'image/png'));
                if (outBlob) {
                  const outBuffer = await outBlob.arrayBuffer();
                  await ffmpeg.writeFile(file.name, new Uint8Array(outBuffer));
                }
              }
            }
          }
        }
          
        const newFrames = [];
        for (let i = 0; i < updatedFrameFiles.length; i++) {
          setProcessingStatus(`Loading frame ${i + 1} of ${updatedFrameFiles.length}...`);
          setProgress(Math.round((i / updatedFrameFiles.length) * 100));
          const file = updatedFrameFiles[i];
          const data = await ffmpeg.readFile(file.name);
          const blob = new Blob([data as BlobPart], { type: 'image/png' });
          const url = URL.createObjectURL(blob);
          newFrames.push({ filename: file.name, url });
        }
        setFrames(newFrames);

        const paletteFilter = resampleMethod === 'neighbor'
          ? 'split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128:dither=none'
          : 'split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128';

        setProcessingStatus('Generating final GIF...');
        await ffmpeg.exec([
          '-framerate', fps.toString(),
          '-i', 'frame_%04d.png',
          '-vf', paletteFilter,
          '-c:v', 'gif',
          '-gifflags', '-offsetting',
          '-y',
          'output.gif'
        ]);
      }

      const data = await ffmpeg.readFile('output.gif');
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'image/gif' }));
      setGifUrl(url);
    } catch (err) {
      console.error(err);
      alert("There was an error processing the video. Check the console for more details.");
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const rebuildGif = async (currentFrames: {filename: string, url: string}[]) => {
    if (currentFrames.length === 0) {
      setGifUrl('');
      return;
    }
    
    setIsRebuilding(true);
    setProcessingStatus('Rebuilding GIF...');
    try {
      const ffmpeg = ffmpegRef.current;
      
      // Copy frames to a sequential temp list to avoid broken sequences if frames were deleted
      for (let i = 0; i < currentFrames.length; i++) {
        const frame = currentFrames[i];
        const tempName = `temp_frame_${String(i + 1).padStart(4, '0')}.png`;
        const data = await ffmpeg.readFile(frame.filename);
        await ffmpeg.writeFile(tempName, data);
      }

      const paletteFilter = resampleMethod === 'neighbor'
        ? 'split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128:dither=none'
        : 'split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128';

      await ffmpeg.exec([
        '-framerate', fps.toString(),
        '-i', 'temp_frame_%04d.png',
        '-vf', paletteFilter,
        '-c:v', 'gif',
        '-gifflags', '-offsetting',
        '-y',
        'output.gif'
      ]);

      const data = await ffmpeg.readFile('output.gif');
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'image/gif' }));
      setGifUrl(url);
      
      // Cleanup temp files
      for (let i = 0; i < currentFrames.length; i++) {
        const tempName = `temp_frame_${String(i + 1).padStart(4, '0')}.png`;
        await ffmpeg.deleteFile(tempName);
      }
    } catch (err) {
      console.error(err);
      alert("Error rebuilding the GIF.");
    } finally {
      setIsRebuilding(false);
      setProcessingStatus('');
    }
  };

  const handleUpdateFrame = async (filename: string, newUrl: string, newBlob: Blob) => {
    // Update state
    const newFrames = frames.map(f => f.filename === filename ? { ...f, url: newUrl } : f);
    setFrames(newFrames);
    
    // Update in FFmpeg FS
    const ffmpeg = ffmpegRef.current;
    const outBuffer = await newBlob.arrayBuffer();
    await ffmpeg.writeFile(filename, new Uint8Array(outBuffer));
    
    // Rebuild GIF
    await rebuildGif(newFrames);
  };

  const handleUpdateMultipleFrames = async (updates: {filename: string, newUrl: string, newBlob: Blob}[]) => {
    // Update state
    let newFrames = [...frames];
    for (const update of updates) {
      newFrames = newFrames.map(f => f.filename === update.filename ? { ...f, url: update.newUrl } : f);
    }
    setFrames(newFrames);
    
    // Update in FFmpeg FS
    const ffmpeg = ffmpegRef.current;
    for (const update of updates) {
      const outBuffer = await update.newBlob.arrayBuffer();
      await ffmpeg.writeFile(update.filename, new Uint8Array(outBuffer));
    }
    
    // Rebuild GIF
    await rebuildGif(newFrames);
  };

  const handleDeleteFrame = async (filename: string) => {
    const newFrames = frames.filter(f => f.filename !== filename);
    setFrames(newFrames);
    
    // Remove from virtual file system if possible
    const ffmpeg = ffmpegRef.current;
    if (ffmpeg) {
      try {
        await ffmpeg.deleteFile(filename);
      } catch (e) {
        console.warn(`Could not delete ${filename} from virtual FS`, e);
      }
    }
    
    // Rebuild GIF
    await rebuildGif(newFrames);
  };

  const handleDeleteMultipleFrames = async (filenames: string[]) => {
    if (filenames.length === 0) return;
    const toDelete = new Set(filenames);
    const newFrames = frames.filter(f => !toDelete.has(f.filename));
    setFrames(newFrames);

    // If the currently open frame was deleted, close the editor
    if (selectedFrame && toDelete.has(selectedFrame.filename)) {
      setSelectedFrame(null);
    }

    // Remove from virtual file system if possible
    const ffmpeg = ffmpegRef.current;
    if (ffmpeg) {
      for (const filename of filenames) {
        try {
          await ffmpeg.deleteFile(filename);
        } catch (e) {
          console.warn(`Could not delete ${filename} from virtual FS`, e);
        }
      }
    }

    // Rebuild GIF once for the whole batch
    await rebuildGif(newFrames);
  };

  const toggleFrameSelection = (filename: string) => {
    setSelectedFilenames(prev => {
      const next = new Set(prev);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      return next;
    });
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedFilenames(new Set());
  };

  const handleFrameDragStart = (e: React.DragEvent, frame: {filename: string, url: string}) => {
    // Drag the whole selection if the grabbed frame is part of it, otherwise just this frame
    const moving = selectedFilenames.has(frame.filename) && selectedFilenames.size > 0
      ? new Set(selectedFilenames)
      : new Set([frame.filename]);
    dragMovingRef.current = moving;
    setIsDraggingFrames(true);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', frame.filename); } catch { /* noop */ }
    pointerYRef.current = e.clientY;
    startAutoScroll();
  };

  // Auto-scroll the frames panel while dragging near its top/bottom edge
  const startAutoScroll = () => {
    if (autoScrollRef.current !== null) return;
    const EDGE = 56; // px sensitivity zone at each edge
    const MAX_SPEED = 16; // px per frame at full intensity
    const onWindowDragOver = (ev: DragEvent) => { pointerYRef.current = ev.clientY; };
    window.addEventListener('dragover', onWindowDragOver);
    dragOverCleanupRef.current = () => window.removeEventListener('dragover', onWindowDragOver);

    const step = () => {
      const el = framesGridRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const y = pointerYRef.current;
        if (y < rect.top + EDGE) {
          const intensity = Math.min((rect.top + EDGE - y) / EDGE, 2);
          el.scrollTop -= MAX_SPEED * intensity;
        } else if (y > rect.bottom - EDGE) {
          const intensity = Math.min((y - (rect.bottom - EDGE)) / EDGE, 2);
          el.scrollTop += MAX_SPEED * intensity;
        }
      }
      autoScrollRef.current = requestAnimationFrame(step);
    };
    autoScrollRef.current = requestAnimationFrame(step);
  };

  const stopAutoScroll = () => {
    if (autoScrollRef.current !== null) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }
    if (dragOverCleanupRef.current) {
      dragOverCleanupRef.current();
      dragOverCleanupRef.current = null;
    }
  };

  const handleFrameDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    pointerYRef.current = e.clientY;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const insertAfter = e.clientX > rect.left + rect.width / 2;
    setDropIndex(insertAfter ? idx + 1 : idx);
  };

  const clearDragState = () => {
    stopAutoScroll();
    setIsDraggingFrames(false);
    setDropIndex(null);
    dragMovingRef.current = new Set();
  };

  const handleFrameDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const target = dropIndex;
    const movingSet = new Set(dragMovingRef.current);
    clearDragState();
    if (target === null || movingSet.size === 0) return;

    const moving = frames.filter(f => movingSet.has(f.filename));
    const remaining = frames.filter(f => !movingSet.has(f.filename));
    // How many non-moving frames sit before the target gap in the original order
    const insertAt = frames.slice(0, target).filter(f => !movingSet.has(f.filename)).length;
    const result = [...remaining.slice(0, insertAt), ...moving, ...remaining.slice(insertAt)];

    // Skip if order didn't actually change
    if (result.length === frames.length && result.every((f, i) => f.filename === frames[i].filename)) return;

    setFrames(result);
    await rebuildGif(result);
  };

  const reset = () => {
    setVideoFile(null);
    setVideoUrl('');
    setGifUrl('');
    setProgress(0);
    setWatermarkRect(null);
    setFrames([]);
    setSelectedFrame(null);
    setIsSpriteSheet(false);
    setVideoDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
  };

  const convertSpriteSheetToGif = async () => {
    if (!videoFile || !isSpriteSheet) return;
    setIsProcessing(true);
    setProgress(0);
    setProcessingStatus('Splitting sprite sheet into frames...');
    setGifUrl('');
    setFrames([]);
    setSelectedFrame(null);

    try {
      // Load image
      const img = new Image();
      img.src = videoUrl;
      await new Promise(r => img.onload = r);

      const frameW = Math.floor(img.naturalWidth / spriteInputCols);
      const frameH = Math.floor(img.naturalHeight / spriteInputRows);
      setOutputWidth(frameW);
      setOutputHeight(frameH);

      const canvas = document.createElement('canvas');
      canvas.width = frameW;
      canvas.height = frameH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No 2d context');

      const ffmpeg = ffmpegRef.current;
      await clearFfmpegFrames();

      const newFrames: {filename: string, url: string}[] = [];
      let frameIndex = 1;
      const totalFrames = spriteInputRows * spriteInputCols;

      for (let row = 0; row < spriteInputRows; row++) {
        for (let col = 0; col < spriteInputCols; col++) {
          setProgress(Math.round((frameIndex / totalFrames) * 50));
          setProcessingStatus(`Extracting frame ${frameIndex} of ${totalFrames}...`);

          ctx.clearRect(0, 0, frameW, frameH);
          ctx.drawImage(img, col * frameW, row * frameH, frameW, frameH, 0, 0, frameW, frameH);

          const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
          if (blob) {
            const filename = `frame_${String(frameIndex).padStart(4, '0')}.png`;
            const buffer = await blob.arrayBuffer();
            await ffmpeg.writeFile(filename, new Uint8Array(buffer));
            const url = URL.createObjectURL(blob);
            newFrames.push({ filename, url });
          }
          frameIndex++;
        }
      }
      setFrames(newFrames);

      setProcessingStatus('Generating GIF...');
      const paletteFilter = resampleMethod === 'neighbor'
        ? 'split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128:dither=none'
        : 'split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128';

      await ffmpeg.exec([
        '-framerate', fps.toString(),
        '-i', 'frame_%04d.png',
        '-vf', paletteFilter,
        '-c:v', 'gif',
        '-gifflags', '-offsetting',
        '-y',
        'output.gif'
      ]);

      const data = await ffmpeg.readFile('output.gif');
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'image/gif' }));
      setGifUrl(url);
    } catch (err) {
      console.error(err);
      alert('Error converting sprite sheet to GIF.');
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 p-6 md:p-12 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="border-b border-neutral-800 pb-6">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <svg width="40" height="25" viewBox="0 0 145 92" xmlns="http://www.w3.org/2000/svg" overflow="hidden">
              <path d="M46.1 0C58.83 0 70.35 5.15 78.69 13.47L83.22 20.18 145 20.18 132.06 71.82 83.22 71.82 78.69 78.53C70.35 86.85 58.83 92 46.1 92 20.64 92 0 71.41 0 46 0 20.59 20.64 0 46.1 0Z" fill="#FFFFFF" fillRule="evenodd"/>
            </svg>
            Video to Transparent GIF
          </h1>
          <p className="text-neutral-400 mt-2">Convert MP4 videos to GIFs with transparent backgrounds. Remove colors and watermarks easily.</p>
        </header>

        {!loaded ? (
          <div className="flex flex-col items-center justify-center p-24 bg-neutral-900 rounded-2xl border border-neutral-800">
            <Loader2 className="w-10 h-10 animate-spin text-blue-500 mb-4" />
            <span className="text-lg font-medium">Loading video processing engine...</span>
            <span className="text-sm text-neutral-500 mt-2">This may take a few seconds the first time.</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left Column: Upload & Preview */}
            <div className="space-y-6">
              <div className="bg-neutral-900 p-6 rounded-2xl border border-neutral-800">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold flex items-center">
                    <Video className="w-5 h-5 mr-2 text-blue-400" />
                    1. Upload Video
                  </h2>
                  {videoUrl && (
                    <button onClick={reset} className="text-sm text-neutral-400 hover:text-white flex items-center transition-colors">
                      <RefreshCw className="w-4 h-4 mr-1.5" /> Change video
                    </button>
                  )}
                </div>
                
                {!videoUrl ? (
                  <label
                    className="flex flex-col items-center justify-center w-full h-64 border-2 border-neutral-700 border-dashed rounded-xl cursor-pointer hover:bg-neutral-800/50 transition-colors"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files?.[0];
                      if (file && (file.type.startsWith('video/') || file.type === 'image/gif' || file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp')) {
                        const input = e.currentTarget.querySelector('input[type="file"]') as HTMLInputElement;
                        if (input) {
                          const dt = new DataTransfer();
                          dt.items.add(file);
                          input.files = dt.files;
                          input.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                      }
                    }}
                  >
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <Upload className="w-10 h-10 text-neutral-400 mb-3" />
                      <p className="mb-2 text-sm text-neutral-400"><span className="font-semibold text-neutral-200">Click to upload</span> or drag and drop</p>
                      <p className="text-xs text-neutral-500">MP4, WebM, MOV, GIF, PNG, JPG (Sprite Sheet)</p>
                    </div>
                    <input type="file" className="hidden" accept="video/*,image/gif,image/png,image/jpeg,image/webp" onChange={handleFileChange} />
                  </label>
                ) : isSpriteSheet ? (
                  <div className="space-y-4">
                    <div className="rounded-xl overflow-hidden border border-neutral-800 bg-black">
                      <img
                        src={videoUrl}
                        alt="Sprite Sheet"
                        className="w-full h-auto block"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex bg-neutral-950 p-1 rounded-lg border border-neutral-800 w-fit">
                      <button
                        onClick={() => setInteractionMode('color')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center ${interactionMode === 'color' ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white'}`}
                      >
                        <MousePointer2 className="w-4 h-4 mr-1.5" />
                        Pick Color
                      </button>
                      <button
                        onClick={() => setInteractionMode('watermark')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center ${interactionMode === 'watermark' ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white'}`}
                      >
                        <SquareDashed className="w-4 h-4 mr-1.5" />
                        Mark Area
                      </button>
                      <button
                        onClick={() => setInteractionMode('ai')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center ${interactionMode === 'ai' ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white'}`}
                      >
                        <Sparkles className="w-4 h-4 mr-1.5" />
                        Auto AI
                      </button>
                      <button
                        onClick={() => setInteractionMode('crop')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center ${interactionMode === 'crop' ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white'}`}
                      >
                        <Crop className="w-4 h-4 mr-1.5" />
                        Crop
                      </button>
                    </div>

                    <div 
                      className={`relative rounded-xl overflow-hidden border border-neutral-800 bg-black select-none touch-none ${interactionMode === 'color' ? 'cursor-crosshair' : 'cursor-crosshair'}`}
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerLeave={handlePointerUp}
                    >
                      {isGif ? (
                        <img
                          ref={mediaRef}
                          src={videoUrl}
                          alt="Source GIF"
                          onLoad={handleMediaLoad}
                          className="w-full h-auto block pointer-events-none"
                          crossOrigin="anonymous"
                        />
                      ) : (
                        <video 
                          ref={mediaRef}
                          src={videoUrl} 
                          onLoadedMetadata={handleMediaLoad}
                          onTimeUpdate={handleTimeUpdate}
                          onPlay={() => setIsPlaying(true)}
                          onPause={() => setIsPlaying(false)}
                          autoPlay
                          muted
                          playsInline
                          className="w-full h-auto block pointer-events-none"
                          crossOrigin="anonymous"
                        />
                      )}
                      
                      {/* Watermark Selection Rectangle */}
                      {watermarkRect && originalDimensions && (
                        <div 
                          className="absolute border-2 border-red-500 bg-red-500/20 pointer-events-none"
                          style={{
                            left: `${(watermarkRect.x / originalDimensions.w) * 100}%`,
                            top: `${(watermarkRect.y / originalDimensions.h) * 100}%`,
                            width: `${(watermarkRect.w / originalDimensions.w) * 100}%`,
                            height: `${(watermarkRect.h / originalDimensions.h) * 100}%`
                          }}
                        />
                      )}

                      {/* Crop Overlay */}
                      {crop && originalDimensions && (
                        <div className="absolute inset-0 pointer-events-none">
                          <div className="absolute top-0 left-0 right-0 bg-black/50" style={{ height: `${(crop.y / originalDimensions.h) * 100}%` }} />
                          <div className="absolute bottom-0 left-0 right-0 bg-black/50" style={{ height: `${((originalDimensions.h - crop.y - crop.h) / originalDimensions.h) * 100}%` }} />
                          <div className="absolute bg-black/50" style={{ top: `${(crop.y / originalDimensions.h) * 100}%`, bottom: `${((originalDimensions.h - crop.y - crop.h) / originalDimensions.h) * 100}%`, left: 0, width: `${(crop.x / originalDimensions.w) * 100}%` }} />
                          <div className="absolute bg-black/50" style={{ top: `${(crop.y / originalDimensions.h) * 100}%`, bottom: `${((originalDimensions.h - crop.y - crop.h) / originalDimensions.h) * 100}%`, right: 0, width: `${((originalDimensions.w - crop.x - crop.w) / originalDimensions.w) * 100}%` }} />
                          
                          {interactionMode === 'crop' && (
                            <div 
                              className="absolute border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)] pointer-events-auto cursor-move"
                              style={{
                                left: `${(crop.x / originalDimensions.w) * 100}%`,
                                top: `${(crop.y / originalDimensions.h) * 100}%`,
                                width: `${(crop.w / originalDimensions.w) * 100}%`,
                                height: `${(crop.h / originalDimensions.h) * 100}%`
                              }}
                              onPointerDown={(e) => handleCropPointerDown(e, 'move')}
                              onPointerUp={handleCropPointerUp}
                            >
                              <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border border-black cursor-nwse-resize" onPointerDown={(e) => handleCropPointerDown(e, 'nw')} onPointerUp={handleCropPointerUp} />
                              <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border border-black cursor-nesw-resize" onPointerDown={(e) => handleCropPointerDown(e, 'ne')} onPointerUp={handleCropPointerUp} />
                              <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border border-black cursor-nesw-resize" onPointerDown={(e) => handleCropPointerDown(e, 'sw')} onPointerUp={handleCropPointerUp} />
                              <div className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border border-black cursor-nwse-resize" onPointerDown={(e) => handleCropPointerDown(e, 'se')} onPointerUp={handleCropPointerUp} />
                            </div>
                          )}
                        </div>
                      )}

                      <div className="absolute top-4 left-4 bg-black/70 backdrop-blur-md text-xs px-3 py-1.5 rounded-full flex items-center border border-white/10 opacity-0 hover:opacity-100 transition-opacity pointer-events-none">
                        {interactionMode === 'color' 
                          ? 'Click on the color to remove' 
                          : interactionMode === 'watermark'
                          ? 'Drag to mark the area to remove'
                          : interactionMode === 'crop'
                          ? 'Drag corners to crop'
                          : 'AI will automatically detect the main character'}
                      </div>
                    </div>

                    {interactionMode === 'watermark' && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-neutral-400">
                          {watermarkRect ? 'Area selected.' : 'Drag over the video to select the watermark.'}
                        </span>
                        {watermarkRect && (
                          <button 
                            onClick={() => setWatermarkRect(null)}
                            className="text-red-400 hover:text-red-300 flex items-center"
                          >
                            <Eraser className="w-4 h-4 mr-1" /> Clear area
                          </button>
                        )}
                      </div>
                    )}

                    {/* Trim Selector (video only) */}
                    {!isGif && videoDuration > 0 && (
                      <div className="bg-neutral-950 rounded-xl border border-neutral-800 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-neutral-300 flex items-center">
                            <Scissors className="w-4 h-4 mr-2 text-blue-400" />
                            Trim segment
                          </span>
                          <span className="text-xs text-neutral-500 font-mono">
                            {formatTime(currentTime)} · Selection: {formatTime(Math.max(0, trimEnd - trimStart))}
                          </span>
                        </div>

                        {/* Play/pause + Dual-handle timeline */}
                        <div className="flex items-center gap-3">
                          <button
                            onClick={togglePlayPause}
                            className="shrink-0 w-9 h-9 flex items-center justify-center bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                            title={isPlaying ? 'Pause' : 'Play'}
                            aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
                          >
                            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                          </button>
                          <div
                            ref={trimTrackRef}
                            className="relative flex-1 h-9 rounded-lg bg-neutral-800 select-none touch-none"
                            onPointerMove={handleTrimPointerMove}
                            onPointerUp={handleTrimPointerUp}
                            onPointerLeave={handleTrimPointerUp}
                          >
                            {/* Dimmed outside regions */}
                            <div className="absolute top-0 bottom-0 left-0 bg-black/50 rounded-l-lg" style={{ width: `${(trimStart / videoDuration) * 100}%` }} />
                            <div className="absolute top-0 bottom-0 right-0 bg-black/50 rounded-r-lg" style={{ width: `${((videoDuration - trimEnd) / videoDuration) * 100}%` }} />
                            {/* Selected region */}
                            <div
                              className="absolute top-0 bottom-0 bg-blue-500/20 border-y-2 border-blue-500"
                              style={{ left: `${(trimStart / videoDuration) * 100}%`, right: `${((videoDuration - trimEnd) / videoDuration) * 100}%` }}
                            />
                            {/* Playhead */}
                            <div
                              className="absolute top-[-3px] bottom-[-3px] w-0.5 bg-white shadow-[0_0_4px_rgba(255,255,255,0.9)] pointer-events-none z-20"
                              style={{ left: `${(currentTime / videoDuration) * 100}%` }}
                            >
                              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rounded-full" />
                            </div>
                            {/* Start handle */}
                            <div
                              onPointerDown={handleTrimPointerDown('start')}
                              className="absolute top-0 bottom-0 w-3 -ml-1.5 flex items-center justify-center bg-blue-500 rounded cursor-ew-resize touch-none hover:bg-blue-400 z-10"
                              style={{ left: `${(trimStart / videoDuration) * 100}%` }}
                              title="Start"
                            >
                              <div className="w-0.5 h-4 bg-white/80 rounded-full" />
                              {trimDragging === 'start' && (
                                <div className="absolute -top-6 px-1.5 py-0.5 bg-blue-500 text-white text-[10px] rounded whitespace-nowrap">{formatTime(trimStart)}</div>
                              )}
                            </div>
                            {/* End handle */}
                            <div
                              onPointerDown={handleTrimPointerDown('end')}
                              className="absolute top-0 bottom-0 w-3 -ml-1.5 flex items-center justify-center bg-blue-500 rounded cursor-ew-resize touch-none hover:bg-blue-400 z-10"
                              style={{ left: `${(trimEnd / videoDuration) * 100}%` }}
                              title="End"
                            >
                              <div className="w-0.5 h-4 bg-white/80 rounded-full" />
                              {trimDragging === 'end' && (
                                <div className="absolute -top-6 px-1.5 py-0.5 bg-blue-500 text-white text-[10px] rounded whitespace-nowrap">{formatTime(trimEnd)}</div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Precise numeric inputs */}
                        <div className="flex flex-wrap items-end gap-3">
                          <div>
                            <label className="block text-[11px] font-medium text-neutral-400 mb-1">Start (s)</label>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={0}
                                max={trimEnd - 0.05}
                                step={0.001}
                                value={Number(trimStart.toFixed(3))}
                                onChange={(e) => {
                                  const v = Math.max(0, Math.min(parseFloat(e.target.value) || 0, trimEnd - 0.05));
                                  setTrimStart(v);
                                  const media = mediaRef.current;
                                  if (media && !isGif) { try { media.currentTime = v; } catch { /* noop */ } }
                                }}
                                className="w-28 bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-blue-500"
                              />
                              <button
                                onClick={() => {
                                  const media = mediaRef.current;
                                  if (media && !isGif) setTrimStart(Math.max(0, Math.min(media.currentTime, trimEnd - 0.05)));
                                }}
                                className="px-2 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[11px] rounded-lg transition-colors whitespace-nowrap"
                                title="Set start to current preview time"
                              >Set ⇤</button>
                            </div>
                            <span className="text-[10px] text-neutral-500">{formatTime(trimStart)}</span>
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-neutral-400 mb-1">End (s)</label>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={trimStart + 0.05}
                                max={videoDuration}
                                step={0.001}
                                value={Number(trimEnd.toFixed(3))}
                                onChange={(e) => {
                                  const v = Math.min(videoDuration, Math.max(parseFloat(e.target.value) || 0, trimStart + 0.05));
                                  setTrimEnd(v);
                                  const media = mediaRef.current;
                                  if (media && !isGif) { try { media.currentTime = v; } catch { /* noop */ } }
                                }}
                                className="w-28 bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-blue-500"
                              />
                              <button
                                onClick={() => {
                                  const media = mediaRef.current;
                                  if (media && !isGif) setTrimEnd(Math.min(videoDuration, Math.max(media.currentTime, trimStart + 0.05)));
                                }}
                                className="px-2 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[11px] rounded-lg transition-colors whitespace-nowrap"
                                title="Set end to current preview time"
                              >Set ⇥</button>
                            </div>
                            <span className="text-[10px] text-neutral-500">{formatTime(trimEnd)}</span>
                          </div>
                          <button
                            onClick={() => { setTrimStart(0); setTrimEnd(videoDuration); }}
                            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs rounded-lg transition-colors"
                          >
                            Reset to full
                          </button>
                        </div>
                        <p className="text-[11px] text-neutral-500">
                          Total duration {formatTime(videoDuration)}. Drag the blue handles or type exact times. Only the selected segment will be converted.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Settings Panel Moved Here */}
              {!isSpriteSheet ? (
              <div className="bg-neutral-900 p-6 rounded-2xl border border-neutral-800">
                <h2 className="text-xl font-semibold mb-6 flex items-center">
                  <Settings className="w-5 h-5 mr-2 text-blue-400" />
                  2. Configure Transparency
                </h2>
                
                <div className="space-y-6">
                  {interactionMode !== 'ai' ? (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-neutral-300 mb-2">Color to remove</label>
                        <div className="flex items-center space-x-4">
                          <input 
                            type="color" 
                            value={targetColor} 
                            onChange={(e) => setTargetColor(e.target.value)}
                            className="w-12 h-12 rounded cursor-pointer bg-transparent border-0 p-0"
                          />
                          <div className="flex-1 px-4 py-3 bg-neutral-950 rounded-lg border border-neutral-800 font-mono text-sm flex items-center">
                            <div className="w-4 h-4 rounded-full mr-3 border border-neutral-700" style={{ backgroundColor: targetColor }}></div>
                            {targetColor.toUpperCase()}
                          </div>
                        </div>
                        <p className="text-xs text-neutral-500 mt-2">Default is black (#000000). You can change it here or by clicking on the video.</p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-neutral-300 mb-2">Flood Mode</label>
                        <div className="flex bg-neutral-950 rounded-lg overflow-hidden border border-neutral-800">
                          <button
                            onClick={() => setColorFloodMode('contiguous')}
                            className={`flex-1 text-sm py-2 transition-colors ${colorFloodMode === 'contiguous' ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white'}`}
                          >Contiguous</button>
                          <button
                            onClick={() => setColorFloodMode('global')}
                            className={`flex-1 text-sm py-2 transition-colors ${colorFloodMode === 'global' ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white'}`}
                          >Global</button>
                        </div>
                        <p className="text-xs text-neutral-500 mt-1">
                          {colorFloodMode === 'contiguous' 
                            ? 'Removes only contiguous pixels of the selected color from the clicked position.' 
                            : 'Removes all pixels of the selected color across the entire image.'}
                        </p>
                      </div>

                      <div>
                        <div className="flex justify-between mb-2">
                          <label className="text-sm font-medium text-neutral-300">Margin (Tolerance)</label>
                          <span className="text-sm text-neutral-400">{similarity}%</span>
                        </div>
                        <input 
                          type="range" 
                          min="0" max="100" 
                          value={similarity} 
                          onChange={(e) => setSimilarity(Number(e.target.value))}
                          className="w-full accent-blue-500"
                        />
                        <p className="text-xs text-neutral-500 mt-1">Set to 0 to disable color removal. Increase if edges of the original color remain.</p>
                      </div>

                      {colorFloodMode === 'global' && (
                      <div>
                        <div className="flex justify-between mb-2">
                          <label className="text-sm font-medium text-neutral-300">Smoothing (Blend)</label>
                          <span className="text-sm text-neutral-400">{blend}%</span>
                        </div>
                        <input 
                          type="range" 
                          min="0" max="100" 
                          value={blend} 
                          onChange={(e) => setBlend(Number(e.target.value))}
                          className="w-full accent-blue-500"
                        />
                      </div>
                      )}
                    </>
                  ) : (
                    <div className="space-y-6">
                      <div className="bg-blue-500/10 border border-blue-500/20 p-5 rounded-xl">
                        <h3 className="text-blue-400 font-medium mb-2 flex items-center">
                          <Sparkles className="w-5 h-5 mr-2" />
                          AI Detection Activated
                        </h3>
                        <p className="text-sm text-neutral-300 leading-relaxed">
                          The advanced <strong>ModNet</strong> model will analyze each frame to cut out the main character with high precision.
                        </p>
                        <p className="text-xs text-neutral-500 mt-3 bg-black/20 p-3 rounded-lg">
                          ⚠️ This process requires downloading the model the first time (~116MB) and may take a while depending on video duration and resolution.
                        </p>
                      </div>

                      <div>
                        <div className="flex justify-between mb-2">
                          <label className="text-sm font-medium text-neutral-300">Edge Cleanup (Threshold)</label>
                          <span className="text-sm text-neutral-400">{aiThreshold}%</span>
                        </div>
                        <input 
                          type="range" 
                          min="0" max="100" 
                          value={aiThreshold} 
                          onChange={(e) => setAiThreshold(Number(e.target.value))}
                          className="w-full accent-blue-500"
                        />
                        <p className="text-xs text-neutral-500 mt-1">Increase this value if semi-transparent artifacts or "noise" remain in some frames.</p>
                      </div>
                    </div>
                  )}

                  <div className="pt-4 border-t border-neutral-800 mt-4">
                    <h3 className="text-sm font-medium text-neutral-300 mb-3">Dimensions</h3>
                    
                    <div className="space-y-4">
                      {/* Crop Fields */}
                      <div>
                        <label className="block text-xs text-neutral-500 mb-1">Crop Area (Source)</label>
                        <div className="flex items-center space-x-2">
                          <div className="flex-1 flex items-center bg-neutral-950 border border-neutral-800 rounded-lg px-2">
                            <span className="text-xs text-neutral-500 w-4">W</span>
                            <input 
                              type="number" 
                              value={crop?.w || 0} 
                              onChange={(e) => handleCropInputChange('w', parseInt(e.target.value))}
                              className="w-full px-2 py-2 bg-transparent text-sm focus:outline-none"
                            />
                          </div>
                          <div className="flex-1 flex items-center bg-neutral-950 border border-neutral-800 rounded-lg px-2">
                            <span className="text-xs text-neutral-500 w-4">H</span>
                            <input 
                              type="number" 
                              value={crop?.h || 0} 
                              onChange={(e) => handleCropInputChange('h', parseInt(e.target.value))}
                              className="w-full px-2 py-2 bg-transparent text-sm focus:outline-none"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Output Fields */}
                      <div>
                        <label className="block text-xs text-neutral-500 mb-1">Output GIF (Destination)</label>
                        <div className="flex items-center space-x-2">
                          <div className="flex-1 flex items-center bg-neutral-950 border border-neutral-800 rounded-lg px-2">
                            <span className="text-xs text-neutral-500 w-4">W</span>
                            <input 
                              type="number" 
                              value={outputWidth} 
                              onChange={(e) => handleOutputInputChange('w', parseInt(e.target.value))}
                              className="w-full px-2 py-2 bg-transparent text-sm focus:outline-none"
                            />
                          </div>
                          <div className="flex-1 flex items-center bg-neutral-950 border border-neutral-800 rounded-lg px-2">
                            <span className="text-xs text-neutral-500 w-4">H</span>
                            <input 
                              type="number" 
                              value={outputHeight} 
                              onChange={(e) => handleOutputInputChange('h', parseInt(e.target.value))}
                              className="w-full px-2 py-2 bg-transparent text-sm focus:outline-none"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Flip Horizontal */}
                      <div>
                        <label className="block text-xs text-neutral-500 mb-1">Orientation</label>
                        <button
                          onClick={() => setFlipHorizontal(!flipHorizontal)}
                          className={`w-full flex items-center justify-center px-3 py-2 rounded-lg text-sm transition-colors border ${flipHorizontal ? 'bg-blue-600/20 border-blue-500 text-blue-400' : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white'}`}
                        >
                          <FlipHorizontal className="w-4 h-4 mr-2" />
                          {flipHorizontal ? 'Flipped Horizontally' : 'Flip Horizontally'}
                        </button>
                      </div>
                      
                      {/* Resample Method */}
                      <div>
                        <label className="block text-xs text-neutral-500 mb-1">Resample Algorithm</label>
                        <select 
                          value={resampleMethod}
                          onChange={(e) => setResampleMethod(e.target.value)}
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                        >
                          <option value="neighbor">Nearest Neighbor (Pixel Art)</option>
                          <option value="lanczos">Lanczos (High Quality)</option>
                          <option value="bicubic">Bicubic (Smooth)</option>
                          <option value="bilinear">Bilinear (Fast)</option>
                        </select>
                      </div>
                      
                      {/* FPS */}
                      <div>
                        <label className="block text-xs text-neutral-500 mb-1">Framerate</label>
                        <div className="flex items-center bg-neutral-950 border border-neutral-800 rounded-lg px-2">
                          <span className="text-xs text-neutral-500 w-8">FPS</span>
                          <input 
                            type="number" 
                            value={fps} 
                            onChange={(e) => setFps(Number(e.target.value))}
                            className="w-full px-2 py-2 bg-transparent text-sm focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              ) : null}

              {isSpriteSheet && videoUrl && (
                <div className="bg-neutral-900 p-6 rounded-2xl border border-neutral-800">
                  <h3 className="text-sm font-semibold text-neutral-200 mb-3 flex items-center">
                    <Grid className="w-4 h-4 mr-1.5 text-purple-400" />
                    Sprite Sheet Layout
                  </h3>
                  <div className="flex gap-4 mb-4">
                    <div>
                      <label className="block text-xs text-neutral-500 mb-1">Columns</label>
                      <input
                        type="number"
                        min="1"
                        value={spriteInputCols}
                        onChange={(e) => setSpriteInputCols(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-20 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-neutral-500 mb-1">Rows</label>
                      <input
                        type="number"
                        min="1"
                        value={spriteInputRows}
                        onChange={(e) => setSpriteInputRows(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-20 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-neutral-500 mb-1">FPS</label>
                      <input
                        type="number"
                        min="1"
                        value={fps}
                        onChange={(e) => setFps(Math.max(1, Number(e.target.value)))}
                        className="w-20 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-neutral-500">
                    Total frames: {spriteInputCols * spriteInputRows}
                  </p>
                </div>
              )}

              <button 
                onClick={isSpriteSheet ? convertSpriteSheetToGif : convertToGif}
                disabled={!videoUrl || isProcessing}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white font-medium py-3 px-4 rounded-xl transition-colors flex items-center justify-center"
              >
                {isProcessing ? (
                  <div className="flex flex-col items-center">
                    <div className="flex items-center">
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                      Processing... {progress}%
                    </div>
                    {processingStatus && (
                      <span className="text-xs text-blue-200 mt-1 font-normal opacity-80">{processingStatus}</span>
                    )}
                  </div>
                ) : (
                  <>
                    <Play className="w-5 h-5 mr-2" />
                    {isSpriteSheet ? 'Convert Sprite Sheet to GIF' : 'Convert to GIF'}
                  </>
                )}
              </button>
            </div>

            {/* Right Column: Result */}
            <div className="space-y-6">
              {/* Result Section */}
              {gifUrl && (
                <div className="bg-neutral-900 p-6 rounded-2xl border border-neutral-800 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <h2 className="text-xl font-semibold mb-4 flex items-center">
                    <Download className="w-5 h-5 mr-2 text-green-400" />
                    3. Result
                  </h2>
                  <div className="rounded-xl overflow-hidden border border-neutral-800 bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYNgvwEAIYIRLgM7//2H4PwxjE0A2jGwYvIExGkZjw2hsGIZhGIZhGAYAL+4/wQvP9/QAAAAASUVORK5CYII=')] bg-repeat">
                    <img src={gifUrl} alt="Transparent GIF" className="w-full h-auto" />
                  </div>
                  <a 
                    href={gifUrl} 
                    download="transparent.gif"
                    className="w-full mt-4 bg-green-600 hover:bg-green-500 text-white font-medium py-3 px-4 rounded-xl transition-colors flex items-center justify-center"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    Download GIF
                  </a>
                </div>
              )}

              {/* Frames Editor Section */}
              {frames.length > 0 && (
                <div className="bg-neutral-900 p-6 rounded-2xl border border-neutral-800 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold flex items-center">
                      <Edit3 className="w-5 h-5 mr-2 text-purple-400" />
                      4. Edit Frames
                    </h2>
                    <div className="flex items-center gap-2">
                      {isRebuilding && <Loader2 className="w-4 h-4 animate-spin text-purple-400" />}
                      {!selectionMode ? (
                        <button
                          onClick={() => setSelectionMode(true)}
                          className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                          title="Select multiple frames to delete"
                        >
                          <CheckSquare className="w-4 h-4" />
                          Select
                        </button>
                      ) : (
                        <button
                          onClick={exitSelectionMode}
                          className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                        >
                          <X className="w-4 h-4" />
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                  {!selectionMode ? (
                    <p className="text-sm text-neutral-400 mb-4">Select a frame to apply edge cleanup or AI inpainting.</p>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                      <p className="text-sm text-neutral-400">
                        {selectedFilenames.size > 0
                          ? `${selectedFilenames.size} frame${selectedFilenames.size > 1 ? 's' : ''} selected · drag to reorder`
                          : 'Tap frames to select · drag any frame to reorder.'}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            if (selectedFilenames.size === frames.length) {
                              setSelectedFilenames(new Set());
                            } else {
                              setSelectedFilenames(new Set(frames.map(f => f.filename)));
                            }
                          }}
                          className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          {selectedFilenames.size === frames.length ? 'Deselect all' : 'Select all'}
                        </button>
                        <button
                          onClick={async () => {
                            const toDelete = Array.from(selectedFilenames);
                            exitSelectionMode();
                            await handleDeleteMultipleFrames(toDelete);
                          }}
                          disabled={selectedFilenames.size === 0 || isRebuilding}
                          className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete {selectedFilenames.size > 0 ? `(${selectedFilenames.size})` : ''}
                        </button>
                      </div>
                    </div>
                  )}
                  
                  <div ref={framesGridRef} className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2 max-h-64 overflow-y-auto p-2 bg-neutral-950 rounded-xl border border-neutral-800">
                    {frames.map((frame, idx) => {
                      const isSelected = selectedFilenames.has(frame.filename);
                      const isMoving = isDraggingFrames && dragMovingRef.current.has(frame.filename);
                      const isLast = idx === frames.length - 1;
                      return (
                        <div
                          key={frame.filename}
                          className="relative"
                          draggable={selectionMode}
                          onDragStart={(e) => handleFrameDragStart(e, frame)}
                          onDragOver={(e) => handleFrameDragOver(e, idx)}
                          onDrop={handleFrameDrop}
                          onDragEnd={clearDragState}
                        >
                          {/* Insertion indicator */}
                          {isDraggingFrames && dropIndex === idx && (
                            <div className="absolute -left-1.5 top-0 bottom-0 w-1 bg-blue-500 rounded-full z-20 shadow-[0_0_6px_rgba(59,130,246,0.9)]" />
                          )}
                          {isDraggingFrames && isLast && dropIndex === idx + 1 && (
                            <div className="absolute -right-1.5 top-0 bottom-0 w-1 bg-blue-500 rounded-full z-20 shadow-[0_0_6px_rgba(59,130,246,0.9)]" />
                          )}
                          <button
                            onClick={() => {
                              if (selectionMode) {
                                toggleFrameSelection(frame.filename);
                              } else {
                                setSelectedFrame(frame);
                              }
                            }}
                            className={`relative w-full aspect-square rounded-lg overflow-hidden border-2 transition-all bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYNgvwEAIYIRLgM7//2H4PwxjE0A2jGwYvIExGkZjw2hsGIZhGIZhGAYAL+4/wQvP9/QAAAAASUVORK5CYII=')] bg-repeat ${
                              isSelected ? 'border-purple-500 ring-2 ring-purple-500' : 'border-transparent hover:border-purple-500'
                            } ${selectionMode ? 'cursor-grab active:cursor-grabbing' : ''} ${isMoving ? 'opacity-40' : ''}`}
                          >
                            <img draggable={false} src={frame.url} alt={`Frame ${idx}`} className={`w-full h-full object-contain transition-opacity ${selectionMode && !isSelected ? 'opacity-60' : ''}`} />
                            {selectionMode && (
                              <div className={`absolute top-1 right-1 w-5 h-5 rounded-md flex items-center justify-center border-2 transition-colors ${
                                isSelected ? 'bg-purple-500 border-purple-500' : 'bg-black/50 border-white/70'
                              }`}>
                                {isSelected && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                              </div>
                            )}
                            <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[10px] text-center py-0.5">
                              {idx + 1}
                            </div>
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Sprite Sheet Generator */}
                  <div className="mt-6 pt-6 border-t border-neutral-800">
                    <h3 className="text-lg font-medium text-white mb-4">Sprite Sheet Generator</h3>
                    <div className="flex flex-wrap items-end gap-4 mb-4">
                      <div>
                        <label className="block text-xs font-medium text-neutral-400 mb-1">Columns</label>
                        <input
                          type="number"
                          min="1"
                          value={spriteCols}
                          onChange={(e) => {
                            const cols = Math.max(1, parseInt(e.target.value) || 1);
                            setSpriteCols(cols);
                            setSpriteRows(Math.ceil(frames.length / cols));
                          }}
                          className="w-20 bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-neutral-400 mb-1">Rows</label>
                        <input
                          type="number"
                          min="1"
                          value={spriteRows}
                          onChange={(e) => {
                            const rows = Math.max(1, parseInt(e.target.value) || 1);
                            setSpriteRows(rows);
                            setSpriteCols(Math.ceil(frames.length / rows));
                          }}
                          className="w-20 bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <button
                        onClick={generateSpriteSheet}
                        disabled={isGeneratingSprite || frames.length === 0}
                        className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                        {isGeneratingSprite ? <Loader2 className="w-4 h-4 animate-spin" /> : <Grid className="w-4 h-4" />}
                        Generate Sprite Sheet
                      </button>
                    </div>

                    {spriteSheetUrl && (
                      <div className="space-y-4">
                        <div className="bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYNgvwEAIYIRLgM7//2H4PwxjE0A2jGwYvIExGkZjw2hsGIZhGIZhGAYAL+4/wQvP9/QAAAAASUVORK5CYII=')] bg-repeat rounded-xl border border-neutral-800 overflow-hidden flex justify-center p-2">
                          <img src={spriteSheetUrl} alt="Sprite Sheet" className="max-w-full h-auto object-contain" />
                        </div>
                        <a
                          href={spriteSheetUrl}
                          download="spritesheet.png"
                          className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          <Download className="w-4 h-4" />
                          Download Sprite Sheet
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Fullscreen Frame Editor Modal */}
        {selectedFrame && (
          <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 md:p-12 animate-in fade-in duration-200">
            <div className="w-full h-full max-w-6xl">
              <FrameEditor 
                frame={selectedFrame} 
                frames={frames}
                onUpdateFrame={handleUpdateFrame}
                onUpdateMultipleFrames={handleUpdateMultipleFrames}
                onSelectFrame={setSelectedFrame}
                onClose={() => setSelectedFrame(null)}
                onDeleteFrame={handleDeleteFrame}
                ffmpeg={ffmpegRef.current}
              />
            </div>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
}
