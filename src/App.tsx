/// <reference types="vite/client" />
import React, { useState, useRef, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { Upload, Settings, Download, Play, Loader2, Video, MousePointer2, RefreshCw, Eraser, SquareDashed, Sparkles, Edit3 } from 'lucide-react';
import FrameEditor from './components/FrameEditor';

// Import local FFmpeg core files to avoid CDN CORS/CORP issues
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [gifUrl, setGifUrl] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState('');
  
  // Settings
  const [targetColor, setTargetColor] = useState('#FFFFFF');
  const [similarity, setSimilarity] = useState(30); // 0-100
  const [blend, setBlend] = useState(10); // 0-100
  const [fps, setFps] = useState(12); // 1-30
  const [scale, setScale] = useState(480); // width
  const [aiThreshold, setAiThreshold] = useState(0); // 0-100

  // Interaction Mode
  const [interactionMode, setInteractionMode] = useState<'color' | 'watermark' | 'ai'>('color');
  const [watermarkRect, setWatermarkRect] = useState<{x: number, y: number, w: number, h: number} | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState<{x: number, y: number} | null>(null);

  // Frame Editing
  const [frames, setFrames] = useState<{filename: string, url: string}[]>([]);
  const [selectedFrame, setSelectedFrame] = useState<{filename: string, url: string} | null>(null);
  const [isRebuilding, setIsRebuilding] = useState(false);

  const ffmpegRef = useRef(new FFmpeg());
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const ffmpeg = ffmpegRef.current;
        ffmpeg.on('log', ({ message }) => console.log(message));
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('video/')) {
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      setGifUrl('');
      setWatermarkRect(null);
      setFrames([]);
      setSelectedFrame(null);
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

  const rgbToHex = (r: number, g: number, b: number) => {
    return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1).toUpperCase();
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (interactionMode === 'color') {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const scaleX = video.videoWidth / rect.width;
      const scaleY = video.videoHeight / rect.height;

      const actualX = x * scaleX;
      const actualY = y * scaleY;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixel = ctx.getImageData(actualX, actualY, 1, 1).data;
      const hex = rgbToHex(pixel[0], pixel[1], pixel[2]);
      setTargetColor(hex);
    } else if (interactionMode === 'watermark') {
      setStartPos({ x, y });
      setIsDrawing(true);
      setWatermarkRect({ x, y, w: 0, h: 0 });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (interactionMode === 'watermark' && isDrawing && startPos) {
      const rect = e.currentTarget.getBoundingClientRect();
      const currentX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const currentY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
      
      setWatermarkRect({
        x: Math.min(startPos.x, currentX),
        y: Math.min(startPos.y, currentY),
        w: Math.abs(currentX - startPos.x),
        h: Math.abs(currentY - startPos.y)
      });
    }
  };

  const handlePointerUp = () => {
    if (interactionMode === 'watermark' && isDrawing) {
      setIsDrawing(false);
      // If the rect is too small, just clear it
      if (watermarkRect && (watermarkRect.w < 5 || watermarkRect.h < 5)) {
        setWatermarkRect(null);
      }
    }
  };

  const convertToGif = async () => {
    if (!videoFile) return;
    setIsProcessing(true);
    setProgress(0);
    setProcessingStatus('Starting...');
    
    try {
      const ffmpeg = ffmpegRef.current;
      await clearFfmpegFrames();
      await ffmpeg.writeFile('input.mp4', await fetchFile(videoFile));

      if (interactionMode === 'ai') {
        setProcessingStatus('Loading AI model (may take a while the first time)...');
        
        // Dynamically import transformers to save bundle size
        const { pipeline, env } = await import('@huggingface/transformers');
        env.allowLocalModels = false;
        
        // Load ModNet model for background removal
        const segmenter = await pipeline('background-removal', 'Xenova/modnet', {
          revision: 'main'
        });

        setProcessingStatus('Extracting frames from video...');
        // Extract frames
        await ffmpeg.exec([
          '-i', 'input.mp4',
          '-vf', `fps=${fps},scale=${scale}:-1`,
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
          const blob = new Blob([data], { type: 'image/png' });
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
          const blob = new Blob([data], { type: 'image/png' });
          const url = URL.createObjectURL(blob);
          newFrames.push({ filename: file.name, url });
        }
        setFrames(newFrames);

        setProcessingStatus('Generating final GIF...');
        await ffmpeg.exec([
          '-framerate', fps.toString(),
          '-i', 'frame_%04d.png',
          '-vf', 'split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128',
          '-c:v', 'gif',
          'output.gif'
        ]);

      } else {
        setProcessingStatus('Applying filters and extracting frames...');
        let vf = '';
        
        // If a watermark area is selected, draw a box of the target color over it
        // so the colorkey filter will make it transparent.
        if (watermarkRect && watermarkRect.w > 0 && watermarkRect.h > 0) {
          const video = videoRef.current;
          if (video) {
            // We need to get the actual DOM rect of the video element to calculate the scale
            const rect = video.getBoundingClientRect();
            const scaleX = video.videoWidth / rect.width;
            const scaleY = video.videoHeight / rect.height;

            const actualX = Math.round(watermarkRect.x * scaleX);
            const actualY = Math.round(watermarkRect.y * scaleY);
            const actualW = Math.max(1, Math.round(watermarkRect.w * scaleX));
            const actualH = Math.max(1, Math.round(watermarkRect.h * scaleY));

            const boxColor = targetColor.replace('#', '0x');
            vf += `drawbox=x=${actualX}:y=${actualY}:w=${actualW}:h=${actualH}:color=${boxColor}:t=fill,`;
          }
        }

        const colorHex = targetColor.replace('#', '0x');
        const sim = (similarity / 100).toFixed(2);
        const blnd = (blend / 100).toFixed(2);

        vf += `fps=${fps},scale=${scale}:-1:flags=lanczos,colorkey=${colorHex}:${sim}:${blnd}`;

        await ffmpeg.exec([
          '-i', 'input.mp4',
          '-an', // Ignorar stream de audio
          '-sn', // Ignorar subtítulos
          '-vf', vf,
          'frame_%04d.png'
        ]);

        // Read all frames to state for editing
        const updatedFiles = await ffmpeg.listDir('/');
        const updatedFrameFiles = updatedFiles
          .filter(f => typeof f.name === 'string' && f.name.startsWith('frame_') && f.name.endsWith('.png'))
          .sort((a, b) => a.name.localeCompare(b.name));
          
        const newFrames = [];
        for (let i = 0; i < updatedFrameFiles.length; i++) {
          setProcessingStatus(`Loading frame ${i + 1} of ${updatedFrameFiles.length}...`);
          setProgress(Math.round((i / updatedFrameFiles.length) * 100));
          const file = updatedFrameFiles[i];
          const data = await ffmpeg.readFile(file.name);
          const blob = new Blob([data], { type: 'image/png' });
          const url = URL.createObjectURL(blob);
          newFrames.push({ filename: file.name, url });
        }
        setFrames(newFrames);

        setProcessingStatus('Generating final GIF...');
        await ffmpeg.exec([
          '-framerate', fps.toString(),
          '-i', 'frame_%04d.png',
          '-vf', 'split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128',
          '-c:v', 'gif',
          'output.gif'
        ]);
      }

      const data = await ffmpeg.readFile('output.gif');
      const url = URL.createObjectURL(new Blob([(data as Uint8Array).buffer], { type: 'image/gif' }));
      setGifUrl(url);
    } catch (err) {
      console.error(err);
      alert("There was an error processing the video. Check the console for more details.");
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const rebuildGif = async () => {
    setIsRebuilding(true);
    setProcessingStatus('Rebuilding GIF...');
    try {
      const ffmpeg = ffmpegRef.current;
      await ffmpeg.exec([
        '-framerate', fps.toString(),
        '-i', 'frame_%04d.png',
        '-vf', 'split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128',
        '-c:v', 'gif',
        '-y',
        'output.gif'
      ]);

      const data = await ffmpeg.readFile('output.gif');
      const url = URL.createObjectURL(new Blob([(data as Uint8Array).buffer], { type: 'image/gif' }));
      setGifUrl(url);
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
    setFrames(prev => prev.map(f => f.filename === filename ? { ...f, url: newUrl } : f));
    
    // Update in FFmpeg FS
    const ffmpeg = ffmpegRef.current;
    const outBuffer = await newBlob.arrayBuffer();
    await ffmpeg.writeFile(filename, new Uint8Array(outBuffer));
    
    // Rebuild GIF
    await rebuildGif();
  };

  const reset = () => {
    setVideoFile(null);
    setVideoUrl('');
    setGifUrl('');
    setProgress(0);
    setWatermarkRect(null);
    setFrames([]);
    setSelectedFrame(null);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 p-6 md:p-12 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="border-b border-neutral-800 pb-6">
          <h1 className="text-3xl font-bold tracking-tight">Video to Transparent GIF</h1>
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
                  <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-neutral-700 border-dashed rounded-xl cursor-pointer hover:bg-neutral-800/50 transition-colors">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <Upload className="w-10 h-10 text-neutral-400 mb-3" />
                      <p className="mb-2 text-sm text-neutral-400"><span className="font-semibold text-neutral-200">Click to upload</span> or drag and drop</p>
                      <p className="text-xs text-neutral-500">MP4, WebM, MOV</p>
                    </div>
                    <input type="file" className="hidden" accept="video/*" onChange={handleFileChange} />
                  </label>
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
                    </div>

                    <div 
                      className={`relative rounded-xl overflow-hidden border border-neutral-800 bg-black select-none touch-none ${interactionMode === 'color' ? 'cursor-crosshair' : 'cursor-crosshair'}`}
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerLeave={handlePointerUp}
                    >
                      <video 
                        ref={videoRef}
                        src={videoUrl} 
                        autoPlay
                        loop
                        muted
                        playsInline
                        className="w-full h-auto block pointer-events-none"
                        crossOrigin="anonymous"
                      />
                      
                      {/* Watermark Selection Rectangle */}
                      {watermarkRect && (
                        <div 
                          className="absolute border-2 border-red-500 bg-red-500/20 pointer-events-none"
                          style={{
                            left: watermarkRect.x,
                            top: watermarkRect.y,
                            width: watermarkRect.w,
                            height: watermarkRect.h
                          }}
                        />
                      )}

                      <div className="absolute top-4 left-4 bg-black/70 backdrop-blur-md text-xs px-3 py-1.5 rounded-full flex items-center border border-white/10 opacity-0 hover:opacity-100 transition-opacity pointer-events-none">
                        {interactionMode === 'color' 
                          ? 'Click on the color to remove' 
                          : interactionMode === 'watermark'
                          ? 'Drag to mark the area to remove'
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
                  </div>
                )}
              </div>

              {/* Settings Panel Moved Here */}
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
                        <p className="text-xs text-neutral-500 mt-2">Default is white (#FFFFFF). You can change it here or by clicking on the video.</p>
                      </div>

                      <div>
                        <div className="flex justify-between mb-2">
                          <label className="text-sm font-medium text-neutral-300">Margin (Tolerance)</label>
                          <span className="text-sm text-neutral-400">{similarity}%</span>
                        </div>
                        <input 
                          type="range" 
                          min="1" max="100" 
                          value={similarity} 
                          onChange={(e) => setSimilarity(Number(e.target.value))}
                          className="w-full accent-blue-500"
                        />
                        <p className="text-xs text-neutral-500 mt-1">Increase if edges of the original color remain.</p>
                      </div>

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

                  <div className="grid grid-cols-2 gap-4 pt-2 border-t border-neutral-800 mt-4">
                    <div className="mt-4">
                      <label className="block text-sm font-medium text-neutral-300 mb-2">Width (px)</label>
                      <input 
                        type="number" 
                        value={scale} 
                        onChange={(e) => setScale(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="mt-4">
                      <label className="block text-sm font-medium text-neutral-300 mb-2">FPS</label>
                      <input 
                        type="number" 
                        value={fps} 
                        onChange={(e) => setFps(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>

                <button 
                  onClick={convertToGif}
                  disabled={!videoUrl || isProcessing}
                  className="w-full mt-8 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white font-medium py-3 px-4 rounded-xl transition-colors flex items-center justify-center"
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
                      Convert to GIF
                    </>
                  )}
                </button>
              </div>
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
                    {isRebuilding && <Loader2 className="w-4 h-4 animate-spin text-purple-400" />}
                  </div>
                  <p className="text-sm text-neutral-400 mb-4">Select a frame to apply edge cleanup or AI inpainting.</p>
                  
                  <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2 max-h-64 overflow-y-auto p-2 bg-neutral-950 rounded-xl border border-neutral-800">
                    {frames.map((frame, idx) => (
                      <button
                        key={frame.filename}
                        onClick={() => setSelectedFrame(frame)}
                        className="relative aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-purple-500 transition-colors bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYNgvwEAIYIRLgM7//2H4PwxjE0A2jGwYvIExGkZjw2hsGIZhGIZhGAYAL+4/wQvP9/QAAAAASUVORK5CYII=')] bg-repeat"
                      >
                        <img src={frame.url} alt={`Frame ${idx}`} className="w-full h-full object-contain" />
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[10px] text-center py-0.5">
                          {idx + 1}
                        </div>
                      </button>
                    ))}
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
                onSelectFrame={setSelectedFrame}
                onClose={() => setSelectedFrame(null)}
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
