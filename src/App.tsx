/// <reference types="vite/client" />
import React, { useState, useRef, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { Upload, Settings, Download, Play, Loader2, Video, MousePointer2, RefreshCw } from 'lucide-react';

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
  const [targetColor, setTargetColor] = useState('#00FF00');
  const [similarity, setSimilarity] = useState(30); // 0-100
  const [blend, setBlend] = useState(10); // 0-100
  const [fps, setFps] = useState(12); // 1-30
  const [scale, setScale] = useState(480); // width

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
    }
  };

  const rgbToHex = (r: number, g: number, b: number) => {
    return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).padStart(6, '0').toUpperCase();
  };

  const handleVideoClick = (e: React.MouseEvent<HTMLVideoElement>) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const rect = video.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

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
  };

  const convertToGif = async () => {
    if (!videoFile) return;
    setIsProcessing(true);
    setProgress(0);
    try {
      const ffmpeg = ffmpegRef.current;
      await ffmpeg.writeFile('input.mp4', await fetchFile(videoFile));

      const colorHex = targetColor.replace('#', '0x');
      const sim = (similarity / 100).toFixed(2);
      const blnd = (blend / 100).toFixed(2);

      const vf = `fps=${fps},scale=${scale}:-1:flags=lanczos,colorkey=${colorHex}:${sim}:${blnd},split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128`;

      await ffmpeg.exec([
        '-i', 'input.mp4',
        '-vf', vf,
        '-c:v', 'gif',
        'output.gif'
      ]);

      const data = await ffmpeg.readFile('output.gif');
      const url = URL.createObjectURL(new Blob([(data as Uint8Array).buffer], { type: 'image/gif' }));
      setGifUrl(url);
    } catch (err) {
      console.error(err);
      alert("Hubo un error al procesar el video. Revisa la consola para más detalles.");
    } finally {
      setIsProcessing(false);
    }
  };

  const reset = () => {
    setVideoFile(null);
    setVideoUrl('');
    setGifUrl('');
    setProgress(0);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 p-6 md:p-12 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="border-b border-neutral-800 pb-6">
          <h1 className="text-3xl font-bold tracking-tight">Video a GIF Transparente</h1>
          <p className="text-neutral-400 mt-2">Convierte videos MP4 en GIFs con fondo transparente. Selecciona el color a eliminar directamente desde el video.</p>
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
                <h2 className="text-xl font-semibold mb-4 flex items-center">
                  <Video className="w-5 h-5 mr-2 text-blue-400" />
                  1. Sube tu Video
                </h2>
                
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
                    <div className="relative group rounded-xl overflow-hidden border border-neutral-800 bg-black">
                      <video 
                        ref={videoRef}
                        src={videoUrl} 
                        controls 
                        className="w-full h-auto max-h-[400px] object-contain cursor-crosshair"
                        onClick={handleVideoClick}
                        crossOrigin="anonymous"
                      />
                      <div className="absolute top-4 left-4 bg-black/70 backdrop-blur-md text-xs px-3 py-1.5 rounded-full flex items-center border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        <MousePointer2 className="w-3 h-3 mr-1.5" />
                        Haz clic en el color a eliminar
                      </div>
                    </div>
                    <button onClick={reset} className="text-sm text-neutral-400 hover:text-white flex items-center transition-colors">
                      <RefreshCw className="w-4 h-4 mr-1.5" /> Cambiar video
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Settings & Result */}
            <div className="space-y-6">
              <div className="bg-neutral-900 p-6 rounded-2xl border border-neutral-800">
                <h2 className="text-xl font-semibold mb-6 flex items-center">
                  <Settings className="w-5 h-5 mr-2 text-blue-400" />
                  2. Configurar Transparencia
                </h2>
                
                <div className="space-y-6">
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
                    <p className="text-xs text-neutral-500 mt-2">También puedes hacer clic directamente en el video para seleccionar el color.</p>
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
                    <>
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                      Procesando... {progress}%
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5 mr-2" />
                      Convertir a GIF
                    </>
                  )}
                </button>
              </div>

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
