import React, { useEffect, useRef, useState } from 'react';
import type { CropRegion } from '@scanner/shared';

interface Props {
  imageUrl: string;
  onCrop: (region: CropRegion) => void;
  onClose: () => void;
}

/** Drag a rectangle on the spine image; reports it in the image's own pixels. */
export default function SpineCropper({ imageUrl, onCrop, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<CropRegion | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => {
      imgRef.current = img;
      const s = Math.min((window.innerWidth * 0.8) / img.width, (window.innerHeight * 0.75) / img.height, 4);
      setScale(s);
      const canvas = canvasRef.current!;
      canvas.width = img.width * s;
      canvas.height = img.height * s;
      draw(null, s);
    };
    // draw/scale are read through refs and the explicit `s` argument.
  }, [imageUrl]);

  function draw(r: CropRegion | null, s = scale) {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, img.width * s, img.height * s);
    if (r) {
      ctx.strokeStyle = '#6a9fb5';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x, r.y, r.width, r.height);
      ctx.fillStyle = 'rgba(106,159,181,0.15)';
      ctx.fillRect(r.x, r.y, r.width, r.height);
    }
  }

  function point(e: React.MouseEvent<HTMLCanvasElement>) {
    const b = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!start) return;
    const cur = point(e);
    const r = {
      x: Math.min(start.x, cur.x),
      y: Math.min(start.y, cur.y),
      width: Math.abs(cur.x - start.x),
      height: Math.abs(cur.y - start.y),
    };
    setRect(r);
    draw(r);
  }

  function applyCrop() {
    if (!rect) return;
    onCrop({
      x: Math.round(rect.x / scale),
      y: Math.round(rect.y / scale),
      width: Math.max(1, Math.round(rect.width / scale)),
      height: Math.max(1, Math.round(rect.height / scale)),
    });
  }

  return (
    <div
      role="dialog"
      aria-label="Crop spine"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <p style={{ color: '#aaa', marginBottom: 12, fontSize: 13 }}>Drag to select the part of the spine to keep</p>
      <canvas
        ref={canvasRef}
        style={{ cursor: 'crosshair', borderRadius: 4 }}
        onMouseDown={e => { setStart(point(e)); setRect(null); }}
        onMouseMove={onMouseMove}
        onMouseUp={() => setStart(null)}
      />
      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <button onClick={applyCrop} disabled={!rect || rect.width < 3 || rect.height < 3}>Crop and read again</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
