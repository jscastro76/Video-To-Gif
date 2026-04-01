/// <reference types="vite/client" />
import React, { useState, useRef, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { Upload, Settings, Download, Play, Loader2, Video, MousePointer2, RefreshCw, Eraser, SquareDashed, Sparkles } from 'lucide-react';

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

  // Interaction Mode
  const [interactionMode, setInteractionMode] = useState<'color' | 'watermark' | 'ai'>('color');
  const [watermarkRect, setWatermarkRect] = useState<{x: number, y: number, w: number, h: number} | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState<{x: number, y: number} | null>(null);

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
    setProcessingStatus('Iniciando...');
    
    try {
      const ffmpeg = ffmpegRef.current;
      await ffmpeg.writeFile('input.mp4', await fetchFile(videoFile));

      if (interactionMode === 'ai') {
        setProcessingStatus('Cargando modelo de IA (puede tardar la primera vez)...');
        
        // Dynamically import transformers to save bundle size
        const { pipeline, env } = await import('@huggingface/transformers');
        env.allowLocalModels = false;
        
        // Load ModNet model for background removal
        const segmenter = await pipeline('background-removal', 'Xenova/modnet', {
          revision: 'main'
        });

        setProcessingStatus('Extrayendo fotogramas del video...');
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
          setProcessingStatus(`Procesando fotograma ${i + 1} de ${frameFiles.length}...`);
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
          
          // The background-removal pipeline returns a RawImage with the alpha channel already applied
          const outBlob = await output.toBlob('image/png');

          // Save back to FFmpeg
          if (outBlob) {
            const outBuffer = await outBlob.arrayBuffer();
            await ffmpeg.writeFile(file.name, new Uint8Array(outBuffer));
          }

          URL.revokeObjectURL(imgUrl);
        }

        setProcessingStatus('Generando GIF final...');
        await ffmpeg.exec([
          '-framerate', fps.toString(),
          '-i', 'frame_%04d.png',
          '-vf', 'split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128',
          '-c:v', 'gif',
          'output.gif'
        ]);

      } else {
        setProcessingStatus('Aplicando filtros...');
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

        vf += `fps=${fps},scale=${scale}:-1:flags=lanczos,colorkey=${colorHex}:${sim}:${blnd},split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128`;

        await ffmpeg.exec([
          '-i', 'input.mp4',
          '-an', // Ignorar stream de audio
          '-sn', // Ignorar subtítulos
          '-vf', vf,
          '-c:v', 'gif',
          'output.gif'
        ]);
      }

      const data = await ffmpeg.readFile('output.gif');
      const url = URL.createObjectURL(new Blob([(data as Uint8Array).buffer], { type: 'image/gif' }));
      setGifUrl(url);
    } catch (err) {
      console.error(err);
      alert("Hubo un error al procesar el video. Revisa la consola para más detalles.");
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const reset = () => {
    setVideoFile(null);
    setVideoUrl('');
    setGifUrl('');
    setProgress(0);
    setWatermarkRect(null);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 p-6 md:p-12 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="border-b border-neutral-800 pb-6">
          <h1 className="text-3xl font-bold tracking-tight">Video a GIF Transparente</h1>
          <p className="text-neutral-400 mt-2">Convierte videos MP4 en GIFs con fondo transparente. Elimina colores y marcas de agua fácilmente.</p>
        </header>

        {!loaded ? (
          <div className="flex flex-col items-center justify-center p-24 bg-neutral-900 rounded-2xl border border-neutral-800">
            <Loader2 className="w-10 h-10 animate-spin text-blue-500 mb-4" />
            <span className="text-lg font-medium">Cargando motor de procesamiento de video...</span>
            <span className="text-sm text-neutral-500 mt-2">Esto puede tardar unos segundos la primera vez.</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left Column: Upload & Preview */}
            <div className="space-y-6">
              <div className="bg-neutral-900 p-6 rounded-2xl border border-neutral-800">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold flex items-center">
                    <Video className="w-5 h-5 mr-2 text-blue-400" />
                    1. Sube tu Video
                  </h2>
                  {videoUrl && (
                    <button onClick={reset} className="text-sm text-neutral-400 hover:text-white flex items-center transition-colors">
                      <RefreshCw className="w-4 h-4 mr-1.5" /> Cambiar video
                    </button>
                  )}
                </div>
                
                {!videoUrl ? (
                  <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-neutral-700 border-dashed rounded-xl cursor-pointer hover:bg-neutral-800/50 transition-colors">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <Upload className="w-10 h-10 text-neutral-400 mb-3" />
                      <p className="mb-2 text-sm text-neutral-400"><span className="font-semibold text-neutral-200">Haz clic para subir</span> o arrastra un archivo</p>
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
                        Elegir Color
                      </button>
                      <button
                        onClick={() => setInteractionMode('watermark')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center ${interactionMode === 'watermark' ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white'}`}
                      >
                        <SquareDashed className="w-4 h-4 mr-1.5" />
                        Marcar Zona
                      </button>
                      <button
                        onClick={() => setInteractionMode('ai')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center ${interactionMode === 'ai' ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white'}`}
                      >
                        <Sparkles className="w-4 h-4 mr-1.5" />
                        IA Automática
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
                          ? 'Haz clic en el color a eliminar' 
                          : interactionMode === 'watermark'
                          ? 'Arrastra para marcar la zona a eliminar'
                          : 'La IA detectará automáticamente al personaje principal'}
                      </div>
                    </div>

                    {interactionMode === 'watermark' && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-neutral-400">
                          {watermarkRect ? 'Zona seleccionada.' : 'Arrastra sobre el video para seleccionar la marca de agua.'}
                        </span>
                        {watermarkRect && (
                          <button 
                            onClick={() => setWatermarkRect(null)}
                            className="text-red-400 hover:text-red-300 flex items-center"
                          >
                            <Eraser className="w-4 h-4 mr-1" /> Borrar zona
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
                  2. Configurar Transparencia
                </h2>
                
                <div className="space-y-6">
                  {interactionMode !== 'ai' ? (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-neutral-300 mb-2">Color a eliminar</label>
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
                        <p className="text-xs text-neutral-500 mt-2">Por defecto es blanco (#FFFFFF). Puedes cambiarlo aquí o haciendo clic en el video.</p>
                      </div>

                      <div>
                        <div className="flex justify-between mb-2">
                          <label className="text-sm font-medium text-neutral-300">Margen (Tolerancia)</label>
                          <span className="text-sm text-neutral-400">{similarity}%</span>
                        </div>
                        <input 
                          type="range" 
                          min="1" max="100" 
                          value={similarity} 
                          onChange={(e) => setSimilarity(Number(e.target.value))}
                          className="w-full accent-blue-500"
                        />
                        <p className="text-xs text-neutral-500 mt-1">Aumenta si quedan bordes del color original.</p>
                      </div>

                      <div>
                        <div className="flex justify-between mb-2">
                          <label className="text-sm font-medium text-neutral-300">Suavizado (Blend)</label>
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
                    <div className="bg-blue-500/10 border border-blue-500/20 p-5 rounded-xl">
                      <h3 className="text-blue-400 font-medium mb-2 flex items-center">
                        <Sparkles className="w-5 h-5 mr-2" />
                        Detección por IA Activada
                      </h3>
                      <p className="text-sm text-neutral-300 leading-relaxed">
                        El modelo avanzado <strong>ModNet</strong> analizará cada fotograma para recortar al personaje principal con alta precisión.
                      </p>
                      <p className="text-xs text-neutral-500 mt-3 bg-black/20 p-3 rounded-lg">
                        ⚠️ Este proceso requiere descargar el modelo la primera vez (~116MB) y puede tardar un poco dependiendo de la duración del video y la resolución.
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4 pt-2 border-t border-neutral-800 mt-4">
                    <div className="mt-4">
                      <label className="block text-sm font-medium text-neutral-300 mb-2">Ancho (px)</label>
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
                        Procesando... {progress}%
                      </div>
                      {processingStatus && (
                        <span className="text-xs text-blue-200 mt-1 font-normal opacity-80">{processingStatus}</span>
                      )}
                    </div>
                  ) : (
                    <>
                      <Play className="w-5 h-5 mr-2" />
                      Convertir a GIF
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
                    3. Resultado
                  </h2>
                  <div className="rounded-xl overflow-hidden border border-neutral-800 bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYNgvwEAIYIRLgM7//2H4PwxjE0A2jGwYvIExGkZjw2hsGIZhGIZhGAYAL+4/wQvP9/QAAAAASUVORK5CYII=')] bg-repeat">
                    <img src={gifUrl} alt="GIF Transparente" className="w-full h-auto" />
                  </div>
                  <a 
                    href={gifUrl} 
                    download="transparente.gif"
                    className="w-full mt-4 bg-green-600 hover:bg-green-500 text-white font-medium py-3 px-4 rounded-xl transition-colors flex items-center justify-center"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    Descargar GIF
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
}
