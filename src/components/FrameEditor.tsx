import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Eraser, Sparkles, Loader2, Save, Undo, Brush, MousePointer2, SquareDashed, Wand2, Wand, ChevronLeft, ChevronRight } from 'lucide-react';
import { FFmpeg } from '@ffmpeg/ffmpeg';

interface FrameEditorProps {
  frame: { filename: string; url: string };
  frames: { filename: string; url: string }[];
  onUpdateFrame: (filename: string, newUrl: string, newBlob: Blob) => void;
  onSelectFrame: (frame: { filename: string; url: string }) => void;
  onClose: () => void;
  ffmpeg: FFmpeg | null;
}

export default function FrameEditor({ frame, frames, onUpdateFrame, onSelectFrame, onClose, ffmpeg }: FrameEditorProps) {
  const [mode, setMode] = useState<'view' | 'cleanup' | 'inpaint' | 'color' | 'watermark' | 'ai' | 'magicWand'>('view');
  const [threshold, setThreshold] = useState(0);
  const [brushSize, setBrushSize] = useState(20);
  const [prompt, setPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(true);
  
  // Color mode
  const [targetColor, setTargetColor] = useState('#00FF00');
  const [similarity, setSimilarity] = useState(30);
  const [blend, setBlend] = useState(10);
  
  // Watermark mode
  const [watermarkRect, setWatermarkRect] = useState<{x: number, y: number, w: number, h: number} | null>(null);
  const [startPos, setStartPos] = useState<{x: number, y: number} | null>(null);

  // Magic Wand mode
  const [magicWandTolerance, setMagicWandTolerance] = useState(15);
  const [magicWandMode, setMagicWandMode] = useState<'contiguous' | 'global'>('contiguous');
  
  // Inpaint mode
  const [inpaintModel, setInpaintModel] = useState('gemini-3.1-flash-image-preview');

  // Navigation & Unsaved Changes
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<'prev' | 'next' | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkApiKey = async () => {
      // @ts-ignore
      if (window.aistudio?.hasSelectedApiKey) {
        // @ts-ignore
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      }
    };
    checkApiKey();
  }, []);

  const handleSelectApiKey = async () => {
    // @ts-ignore
    if (window.aistudio?.openSelectKey) {
      // @ts-ignore
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  const resetCanvas = () => {
    const img = new Image();
    img.src = frame.url;
    img.onload = () => {
      const canvas = canvasRef.current;
      const maskCanvas = maskCanvasRef.current;
      if (!canvas || !maskCanvas) return;
      
      canvas.width = img.width;
      canvas.height = img.height;
      maskCanvas.width = img.width;
      maskCanvas.height = img.height;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      }
      const mctx = maskCanvas.getContext('2d');
      if (mctx) {
        mctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      }
      setHasUnsavedChanges(false);
    };
  };

  // Load image to canvas
  useEffect(() => {
    resetCanvas();
  }, [frame.url]);

  // Handle Edge Cleanup
  const applyCleanup = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const img = new Image();
    img.src = frame.url;
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      
      if (threshold > 0) {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        const thresholdValue = (threshold / 100) * 255;
        
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] < thresholdValue) {
            data[i] = 0;
          }
        }
        ctx.putImageData(imgData, 0, 0);
        setHasUnsavedChanges(true);
      }
    };
  };

  useEffect(() => {
    if (mode === 'cleanup') {
      applyCleanup();
    }
  }, [threshold, mode]);

  // Drawing mask or watermark
  const getCoordinates = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode === 'magicWand') {
      const coords = getCoordinates(e);
      if (!coords) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const x = Math.floor(coords.x);
      const y = Math.floor(coords.y);
      
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      const width = canvas.width;
      const height = canvas.height;
      
      const clickedIdx = (y * width + x) * 4;
      const targetR = data[clickedIdx];
      const targetG = data[clickedIdx + 1];
      const targetB = data[clickedIdx + 2];
      const targetA = data[clickedIdx + 3];

      if (targetA === 0) return; // Already transparent

      const colorMatch = (r: number, g: number, b: number, a: number) => {
        if (a === 0) return false;
        const distSq = (r - targetR) ** 2 + (g - targetG) ** 2 + (b - targetB) ** 2;
        const maxDistSq = 195075; // 255^2 * 3
        const thresholdSq = maxDistSq * Math.pow(magicWandTolerance / 100, 2);
        return distSq <= thresholdSq;
      };

      if (magicWandMode === 'global') {
        for (let i = 0; i < data.length; i += 4) {
          if (colorMatch(data[i], data[i+1], data[i+2], data[i+3])) {
            data[i+3] = 0;
          }
        }
      } else {
        // Contiguous (Flood Fill)
        const visited = new Uint8Array(width * height);
        const queue = [x, y];
        visited[y * width + x] = 1;

        while (queue.length > 0) {
          const cy = queue.pop()!;
          const cx = queue.pop()!;
          const idx = (cy * width + cx) * 4;

          data[idx + 3] = 0; // Make transparent

          const neighbors = [
            [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]
          ];

          for (const [nx, ny] of neighbors) {
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nIdx = ny * width + nx;
              if (!visited[nIdx]) {
                visited[nIdx] = 1;
                const pIdx = nIdx * 4;
                if (colorMatch(data[pIdx], data[pIdx+1], data[pIdx+2], data[pIdx+3])) {
                  queue.push(nx, ny);
                }
              }
            }
          }
        }
      }

      ctx.putImageData(imgData, 0, 0);
      setHasUnsavedChanges(true);
      return;
    }

    if (mode === 'color') {
      const coords = getCoordinates(e);
      if (!coords) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      const pixel = ctx.getImageData(coords.x, coords.y, 1, 1).data;
      const hex = "#" + (1 << 24 | pixel[0] << 16 | pixel[1] << 8 | pixel[2]).toString(16).slice(1).toUpperCase();
      setTargetColor(hex);
      return;
    }

    if (mode === 'watermark') {
      setIsDrawing(true);
      const coords = getCoordinates(e);
      if (coords) {
        setStartPos(coords);
        setWatermarkRect({ x: coords.x, y: coords.y, w: 0, h: 0 });
      }
      return;
    }

    if (mode !== 'inpaint') return;
    setIsDrawing(true);
    const coords = getCoordinates(e);
    if (!coords) return;
    
    const ctx = maskCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brushSize;
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode === 'watermark' && isDrawing && startPos) {
      const coords = getCoordinates(e);
      if (coords) {
        setWatermarkRect({
          x: Math.min(startPos.x, coords.x),
          y: Math.min(startPos.y, coords.y),
          w: Math.abs(coords.x - startPos.x),
          h: Math.abs(coords.y - startPos.y)
        });
      }
      return;
    }

    if (!isDrawing || mode !== 'inpaint') return;
    const coords = getCoordinates(e);
    if (!coords) return;
    
    const ctx = maskCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
  };

  const handlePointerUp = () => {
    if (mode === 'watermark' && isDrawing) {
      setIsDrawing(false);
      if (watermarkRect && (watermarkRect.w < 5 || watermarkRect.h < 5)) {
        setWatermarkRect(null);
      }
      return;
    }
    setIsDrawing(false);
  };

  const clearMask = () => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setWatermarkRect(null);
  };

  useEffect(() => {
    if (mode === 'watermark') {
      const canvas = maskCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (watermarkRect) {
        ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 2;
        ctx.fillRect(watermarkRect.x, watermarkRect.y, watermarkRect.w, watermarkRect.h);
        ctx.strokeRect(watermarkRect.x, watermarkRect.y, watermarkRect.w, watermarkRect.h);
      }
    }
  }, [watermarkRect, mode]);

  const applyColorKey = async () => {
    if (!ffmpeg) {
      alert("FFmpeg not available.");
      return;
    }
    setIsProcessing(true);
    try {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error("Could not get canvas blob");
      
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      await ffmpeg.writeFile('temp_in.png', uint8Array);
      
      const colorHex = targetColor.replace('#', '0x');
      const sim = (similarity / 100).toFixed(2);
      const blnd = (blend / 100).toFixed(2);

      await ffmpeg.exec([
        '-i', 'temp_in.png',
        '-vf', `colorkey=${colorHex}:${sim}:${blnd}`,
        '-y',
        'temp_out.png'
      ]);

      const data = await ffmpeg.readFile('temp_out.png');
      const outBlob = new Blob([data], { type: 'image/png' });
      const newUrl = URL.createObjectURL(outBlob);
      
      const img = new Image();
      img.src = newUrl;
      await new Promise(r => img.onload = r);
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      }
      
      setHasUnsavedChanges(true);
      URL.revokeObjectURL(newUrl);
    } catch (err) {
      console.error(err);
      alert("Error applying color key.");
    } finally {
      setIsProcessing(false);
    }
  };

  const applyWatermark = () => {
    if (!watermarkRect) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(watermarkRect.x, watermarkRect.y, watermarkRect.w, watermarkRect.h);
    setWatermarkRect(null);
    setHasUnsavedChanges(true);
  };

  const applyAutoAI = async () => {
    setIsProcessing(true);
    try {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.allowLocalModels = false;
      
      const segmenter = await pipeline('background-removal', 'Xenova/modnet', {
        revision: 'main'
      });
      
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error("Could not get canvas blob");
      
      const url = URL.createObjectURL(blob);
      const output = await segmenter(url);
      
      canvas.width = output.width;
      canvas.height = output.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const imgData = new ImageData(new Uint8ClampedArray(output.data), output.width, output.height);
        ctx.putImageData(imgData, 0, 0);
      }
      
      setHasUnsavedChanges(true);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("Error applying Auto AI.");
    } finally {
      setIsProcessing(false);
    }
  };

  const saveChanges = (): Promise<void> => {
    return new Promise((resolve) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        resolve();
        return;
      }
      canvas.toBlob((blob) => {
        if (blob) {
          const newUrl = URL.createObjectURL(blob);
          onUpdateFrame(frame.filename, newUrl, blob);
          setHasUnsavedChanges(false);
        }
        resolve();
      }, 'image/png');
    });
  };

  const handleInpaint = async () => {
    if (!prompt.trim()) {
      alert("Please write a prompt for the AI.");
      return;
    }
    
    const canvas = canvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!canvas || !maskCanvas) return;
    
    setIsProcessing(true);
    
    try {
      // Create a composite image where the masked area is transparent
      const compositeCanvas = document.createElement('canvas');
      compositeCanvas.width = canvas.width;
      compositeCanvas.height = canvas.height;
      const ctx = compositeCanvas.getContext('2d');
      if (!ctx) throw new Error("No 2d context");
      
      ctx.drawImage(canvas, 0, 0);
      
      // Get mask data
      const maskCtx = maskCanvas.getContext('2d');
      if (!maskCtx) throw new Error("No mask context");
      const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      
      // Get composite data
      const compData = ctx.getImageData(0, 0, compositeCanvas.width, compositeCanvas.height);
      
      // Where mask is drawn (red with alpha), make composite transparent
      for (let i = 0; i < maskData.data.length; i += 4) {
        if (maskData.data[i+3] > 0) { // If mask has alpha
          compData.data[i+3] = 0; // Make transparent
        }
      }
      ctx.putImageData(compData, 0, 0);
      
      // Convert to base64
      const base64Data = compositeCanvas.toDataURL('image/png').split(',')[1];
      
      // Initialize Gemini
      // @ts-ignore
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const response = await ai.models.generateContent({
        model: inpaintModel,
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: 'image/png',
              },
            },
            {
              text: prompt,
            },
          ],
        },
      });
      
      let newImageBase64 = '';
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          newImageBase64 = part.inlineData.data;
          break;
        }
      }
      
      if (newImageBase64) {
        const img = new Image();
        img.src = `data:image/png;base64,${newImageBase64}`;
        await new Promise(r => img.onload = r);
        
        const mainCtx = canvas.getContext('2d');
        if (mainCtx) {
          mainCtx.clearRect(0, 0, canvas.width, canvas.height);
          mainCtx.drawImage(img, 0, 0);
        }
        clearMask();
        setHasUnsavedChanges(true);
      } else {
        throw new Error("No image received from AI.");
      }
    } catch (err) {
      console.error(err);
      alert("Error processing with AI. Make sure you have selected your API Key.");
    } finally {
      setIsProcessing(false);
    }
  };

  const currentIndex = frames.findIndex(f => f.filename === frame.filename);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < frames.length - 1;

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (hasUnsavedChanges) {
      setPendingNavigation(direction);
      setShowConfirmModal(true);
    } else {
      executeNavigation(direction);
    }
  };

  const executeNavigation = (direction: 'prev' | 'next') => {
    const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex >= 0 && newIndex < frames.length) {
      onSelectFrame(frames[newIndex]);
      setHasUnsavedChanges(false);
      setWatermarkRect(null);
      clearMask();
    }
    setShowConfirmModal(false);
    setPendingNavigation(null);
  };

  const handleConfirmSaveAndNavigate = async () => {
    await saveChanges();
    if (pendingNavigation) {
      executeNavigation(pendingNavigation);
    }
  };

  const handleConfirmDiscardAndNavigate = () => {
    if (pendingNavigation) {
      executeNavigation(pendingNavigation);
    }
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900 rounded-xl border border-neutral-800 overflow-hidden relative">
      <div className="p-4 border-b border-neutral-800 flex justify-between items-center bg-neutral-950">
        <h3 className="font-medium text-neutral-200">Editing: {frame.filename} {hasUnsavedChanges && <span className="text-yellow-500 text-xs ml-2">(Unsaved Changes)</span>}</h3>
        <button onClick={onClose} className="text-sm text-neutral-400 hover:text-white">Close Editor</button>
      </div>
      
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Tools */}
        <div className="w-64 border-r border-neutral-800 p-4 space-y-6 overflow-y-auto">
          <div className="space-y-2">
            <button 
              onClick={() => { setMode('view'); clearMask(); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${mode === 'view' ? 'bg-blue-600 text-white' : 'hover:bg-neutral-800 text-neutral-300'}`}
            >
              Normal View
            </button>
            <button 
              onClick={() => { setMode('color'); clearMask(); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center ${mode === 'color' ? 'bg-blue-600 text-white' : 'hover:bg-neutral-800 text-neutral-300'}`}
            >
              <MousePointer2 className="w-4 h-4 mr-2" />
              Pick Color
            </button>
            <button 
              onClick={() => { setMode('watermark'); clearMask(); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center ${mode === 'watermark' ? 'bg-blue-600 text-white' : 'hover:bg-neutral-800 text-neutral-300'}`}
            >
              <SquareDashed className="w-4 h-4 mr-2" />
              Mark Area
            </button>
            <button 
              onClick={() => { setMode('ai'); clearMask(); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center ${mode === 'ai' ? 'bg-blue-600 text-white' : 'hover:bg-neutral-800 text-neutral-300'}`}
            >
              <Wand2 className="w-4 h-4 mr-2" />
              Auto AI
            </button>
            <button 
              onClick={() => { setMode('magicWand'); clearMask(); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center ${mode === 'magicWand' ? 'bg-blue-600 text-white' : 'hover:bg-neutral-800 text-neutral-300'}`}
            >
              <Wand className="w-4 h-4 mr-2" />
              Magic Wand
            </button>
            <button 
              onClick={() => { setMode('cleanup'); clearMask(); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center ${mode === 'cleanup' ? 'bg-blue-600 text-white' : 'hover:bg-neutral-800 text-neutral-300'}`}
            >
              <Eraser className="w-4 h-4 mr-2" />
              Edge Cleanup
            </button>
            <button 
              onClick={() => { setMode('inpaint'); clearMask(); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center ${mode === 'inpaint' ? 'bg-blue-600 text-white' : 'hover:bg-neutral-800 text-neutral-300'}`}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Inpainting (AI)
            </button>
          </div>
          
          {mode === 'color' && (
            <div className="space-y-4 pt-4 border-t border-neutral-800">
              <div>
                <label className="text-xs text-neutral-400 block mb-1">Color to Remove</label>
                <div className="flex items-center space-x-2">
                  <input 
                    type="color" 
                    value={targetColor} 
                    onChange={(e) => setTargetColor(e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer bg-transparent border-0 p-0"
                  />
                  <input 
                    type="text" 
                    value={targetColor.toUpperCase()} 
                    onChange={(e) => setTargetColor(e.target.value)}
                    className="flex-1 bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <p className="text-[10px] text-neutral-500 mt-1">Click on the image to pick a color</p>
              </div>
              
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-xs text-neutral-400">Margin / Tolerance</label>
                  <span className="text-xs text-neutral-400">{similarity}%</span>
                </div>
                <input 
                  type="range" min="1" max="100" 
                  value={similarity} 
                  onChange={(e) => setSimilarity(Number(e.target.value))}
                  className="w-full accent-blue-500"
                />
              </div>
              
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-xs text-neutral-400">Smoothing / Blend</label>
                  <span className="text-xs text-neutral-400">{blend}%</span>
                </div>
                <input 
                  type="range" min="0" max="100" 
                  value={blend} 
                  onChange={(e) => setBlend(Number(e.target.value))}
                  className="w-full accent-blue-500"
                />
              </div>
              
              <button 
                onClick={applyColorKey} 
                disabled={isProcessing}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white text-sm py-2 rounded-lg flex items-center justify-center"
              >
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <MousePointer2 className="w-4 h-4 mr-2" />}
                Apply Color Key
              </button>
              
              <button onClick={saveChanges} disabled={isProcessing} className="w-full bg-neutral-800 hover:bg-neutral-700 text-white text-sm py-2 rounded-lg flex items-center justify-center mt-2">
                <Save className="w-4 h-4 mr-2" /> Save Changes
              </button>
            </div>
          )}

          {mode === 'watermark' && (
            <div className="space-y-4 pt-4 border-t border-neutral-800">
              <p className="text-xs text-neutral-400">Draw a rectangle on the image to select the area to remove.</p>
              
              <button 
                onClick={applyWatermark} 
                disabled={!watermarkRect || isProcessing}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white text-sm py-2 rounded-lg flex items-center justify-center"
              >
                <SquareDashed className="w-4 h-4 mr-2" />
                Remove Area
              </button>
              
              <button onClick={saveChanges} disabled={isProcessing} className="w-full bg-neutral-800 hover:bg-neutral-700 text-white text-sm py-2 rounded-lg flex items-center justify-center mt-2">
                <Save className="w-4 h-4 mr-2" /> Save Changes
              </button>
            </div>
          )}

          {mode === 'ai' && (
            <div className="space-y-4 pt-4 border-t border-neutral-800">
              <p className="text-xs text-neutral-400">Automatically remove the background using the ModNet AI model.</p>
              
              <button 
                onClick={applyAutoAI} 
                disabled={isProcessing}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white text-sm py-2 rounded-lg flex items-center justify-center"
              >
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Wand2 className="w-4 h-4 mr-2" />}
                Apply Auto AI
              </button>
              
              <button onClick={saveChanges} disabled={isProcessing} className="w-full bg-neutral-800 hover:bg-neutral-700 text-white text-sm py-2 rounded-lg flex items-center justify-center mt-2">
                <Save className="w-4 h-4 mr-2" /> Save Changes
              </button>
            </div>
          )}

          {mode === 'magicWand' && (
            <div className="space-y-4 pt-4 border-t border-neutral-800">
              <p className="text-xs text-neutral-400">Click on the image to make matching colors transparent.</p>
              
              <div>
                <label className="text-xs text-neutral-400 block mb-1">Flood Mode</label>
                <div className="flex bg-neutral-950 rounded-lg p-1">
                  <button
                    onClick={() => setMagicWandMode('contiguous')}
                    className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${magicWandMode === 'contiguous' ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white'}`}
                  >
                    Contiguous
                  </button>
                  <button
                    onClick={() => setMagicWandMode('global')}
                    className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${magicWandMode === 'global' ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white'}`}
                  >
                    Global
                  </button>
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-xs text-neutral-400">Tolerance</label>
                  <span className="text-xs text-neutral-400">{magicWandTolerance}%</span>
                </div>
                <input 
                  type="range" min="0" max="100" 
                  value={magicWandTolerance} 
                  onChange={(e) => setMagicWandTolerance(Number(e.target.value))}
                  className="w-full accent-blue-500"
                />
              </div>
              
              <button onClick={resetCanvas} className="w-full bg-neutral-800 hover:bg-neutral-700 text-white text-xs py-2 rounded-lg flex items-center justify-center">
                <Undo className="w-3 h-3 mr-1" /> Reset Frame
              </button>
              
              <button onClick={saveChanges} disabled={isProcessing} className="w-full bg-neutral-800 hover:bg-neutral-700 text-white text-sm py-2 rounded-lg flex items-center justify-center mt-2">
                <Save className="w-4 h-4 mr-2" /> Save Changes
              </button>
            </div>
          )}
          
          {mode === 'cleanup' && (
            <div className="space-y-4 pt-4 border-t border-neutral-800">
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-xs text-neutral-400">Threshold</label>
                  <span className="text-xs text-neutral-400">{threshold}%</span>
                </div>
                <input 
                  type="range" min="0" max="100" 
                  value={threshold} 
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="w-full accent-blue-500"
                />
              </div>
              <button onClick={saveChanges} className="w-full bg-neutral-800 hover:bg-neutral-700 text-white text-sm py-2 rounded-lg flex items-center justify-center">
                <Save className="w-4 h-4 mr-2" /> Apply
              </button>
            </div>
          )}
          
          {mode === 'inpaint' && (
            <div className="space-y-4 pt-4 border-t border-neutral-800">
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-xs text-neutral-400">Brush Size</label>
                  <span className="text-xs text-neutral-400">{brushSize}px</span>
                </div>
                <input 
                  type="range" min="5" max="100" 
                  value={brushSize} 
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                  className="w-full accent-blue-500"
                />
              </div>
              
              <div className="flex space-x-2">
                <button onClick={clearMask} className="flex-1 bg-neutral-800 hover:bg-neutral-700 text-white text-xs py-2 rounded-lg flex items-center justify-center">
                  <Undo className="w-3 h-3 mr-1" /> Clear
                </button>
              </div>
              
              <div>
                <label className="text-xs text-neutral-400 block mb-1">AI Prompt</label>
                <textarea 
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Ex: Remove the watermark and reconstruct the shoe..."
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2 text-sm text-white h-24 resize-none focus:outline-none focus:border-blue-500 mb-3"
                />
              </div>

              <div>
                <label className="text-xs text-neutral-400 block mb-1">AI Model</label>
                <select
                  value={inpaintModel}
                  onChange={(e) => setInpaintModel(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="gemini-3.1-flash-image-preview">Nano Banana Inpaint (Flash)</option>
                  <option value="gemini-3-pro-image-preview">Nano Banana Pro Inpaint (Pro)</option>
                </select>
              </div>
              
              {!hasApiKey ? (
                <button 
                  onClick={handleSelectApiKey} 
                  className="w-full bg-purple-600 hover:bg-purple-500 text-white text-sm py-2 rounded-lg flex items-center justify-center"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Select API Key
                </button>
              ) : (
                <button 
                  onClick={handleInpaint} 
                  disabled={isProcessing}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white text-sm py-2 rounded-lg flex items-center justify-center"
                >
                  {isProcessing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  Generate with AI
                </button>
              )}
              
              <button onClick={saveChanges} disabled={isProcessing} className="w-full bg-neutral-800 hover:bg-neutral-700 text-white text-sm py-2 rounded-lg flex items-center justify-center mt-2">
                <Save className="w-4 h-4 mr-2" /> Save Changes
              </button>
            </div>
          )}
        </div>
        
        {/* Canvas Area */}
        <div className="flex-1 bg-neutral-950 flex items-center justify-center p-4 overflow-hidden relative group" ref={containerRef}>
          {hasPrev && (
            <button 
              onClick={() => handleNavigate('prev')}
              className="absolute left-4 z-30 p-3 bg-neutral-900/80 hover:bg-neutral-800 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg border border-neutral-700"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          <div className="relative flex items-center justify-center w-full h-full">
            <div className="relative inline-flex items-center justify-center max-w-full max-h-full">
              {/* Background pattern for transparency */}
              <div className="absolute inset-0" style={{ 
                backgroundImage: 'repeating-conic-gradient(#333 0% 25%, #222 0% 50%)', 
                backgroundSize: '20px 20px',
                zIndex: 0
              }} />
              
              <canvas 
                ref={canvasRef} 
                className="relative z-10"
                style={{ display: 'block', maxWidth: '100%', maxHeight: '100%' }}
              />
              
              <canvas 
                ref={maskCanvasRef}
                className={`absolute top-0 left-0 z-20 ${
                  mode === 'inpaint' ? 'cursor-crosshair' : 
                  mode === 'watermark' ? 'cursor-crosshair' : 
                  mode === 'color' ? 'cursor-crosshair' : 
                  mode === 'magicWand' ? 'cursor-crosshair' : 
                  'pointer-events-none'
                }`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                style={{ display: 'block', width: '100%', height: '100%' }}
              />
            </div>
          </div>

          {hasNext && (
            <button 
              onClick={() => handleNavigate('next')}
              className="absolute right-4 z-30 p-3 bg-neutral-900/80 hover:bg-neutral-800 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg border border-neutral-700"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-neutral-900 rounded-xl p-6 max-w-md w-full border border-neutral-800 shadow-2xl">
            <h3 className="text-lg font-medium text-white mb-2">Unsaved Changes</h3>
            <p className="text-neutral-400 text-sm mb-6">
              You have unsaved changes on this frame. Do you want to save them before moving to the next frame?
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-300 hover:bg-neutral-800 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleConfirmDiscardAndNavigate}
                className="px-4 py-2 rounded-lg text-sm font-medium text-red-400 hover:bg-red-400/10 transition-colors"
              >
                Discard
              </button>
              <button 
                onClick={handleConfirmSaveAndNavigate}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                Save & Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
