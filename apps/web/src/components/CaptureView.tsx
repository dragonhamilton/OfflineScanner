import React, { useEffect, useRef, useState } from 'react';
import type { Book, Photo } from '@scanner/shared';
import { api } from '../api';

interface Props {
  onScanned: (photo: Photo, books: Book[]) => void;
}

type Step =
  | { kind: 'pick' }
  | { kind: 'count'; photo: Photo; spineCount: number }
  | { kind: 'working'; photo: Photo; message: string; done?: number; total?: number };

/**
 * Upload or capture a shelf photo, confirm how many spines it has,
 * slice it and read every spine with local OCR.
 */
export default function CaptureView({ onScanned }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [error, setError] = useState('');

  useEffect(() => () => streamRef.current?.getTracks().forEach(t => t.stop()), []);

  async function startCamera() {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('No camera access here. The browser only allows it on localhost or HTTPS.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 4096 } } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStreaming(true);
      }
    } catch (err) {
      setError(`Camera unavailable: ${(err as Error).message}`);
    }
  }

  async function capture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (blob) await upload(blob, `capture_${Date.now()}.jpg`);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await upload(file, file.name);
  }

  async function upload(blob: Blob, name: string) {
    setError('');
    try {
      const { photo, estimatedSpineCount } = await api.uploadPhoto(blob, name);
      setStep({ kind: 'count', photo, spineCount: estimatedSpineCount });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function sliceAndRead(photo: Photo, spineCount: number) {
    setError('');
    try {
      setStep({ kind: 'working', photo, message: 'Cutting the photo into spines…' });
      const { books, skippedSlices } = await api.sliceSpines(photo.id, spineCount);

      const read: Book[] = [];
      for (const [i, book] of books.entries()) {
        setStep({ kind: 'working', photo, message: 'Reading spines', done: i, total: books.length });
        read.push(await api.readSpine(book.id));
      }
      if (skippedSlices) console.info(`${skippedSlices} slice(s) looked like wall or shelf and were dropped`);
      onScanned(photo, read);
    } catch (err) {
      setError((err as Error).message);
      setStep({ kind: 'count', photo, spineCount });
    }
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
      {step.kind === 'pick' && (
        <>
          <div style={{ display: 'flex', gap: 12 }}>
            <label className="button">
              <input type="file" accept="image/*" onChange={handleFile} aria-label="Upload shelf photo" hidden />
              Upload photo
            </label>
            <button onClick={startCamera} disabled={streaming}>Use camera</button>
          </div>
          {streaming && (
            <div style={{ maxWidth: 640 }}>
              <video ref={videoRef} muted playsInline style={{ width: '100%', borderRadius: 8 }} />
              <button onClick={capture} style={{ marginTop: 12, width: '100%', padding: 10, fontSize: 15 }}>
                Capture
              </button>
            </div>
          )}
          {!streaming && <video ref={videoRef} hidden />}
        </>
      )}

      {step.kind !== 'pick' && (
        <img
          src={step.photo.imageUrl}
          alt="Shelf photo"
          style={{ maxWidth: '100%', maxHeight: '55vh', objectFit: 'contain', borderRadius: 6, border: '1px solid #444', alignSelf: 'flex-start' }}
        />
      )}

      {step.kind === 'count' && (
        <form
          style={{ display: 'flex', gap: 12, alignItems: 'center' }}
          onSubmit={e => { e.preventDefault(); void sliceAndRead(step.photo, step.spineCount); }}
        >
          <label htmlFor="spine-count">Books in this photo</label>
          <input
            id="spine-count"
            type="number"
            min={1}
            max={150}
            value={step.spineCount}
            onChange={e => setStep({ ...step, spineCount: Math.max(1, Number(e.target.value) || 1) })}
            style={{ width: 80 }}
          />
          <span style={{ color: '#888', fontSize: 12 }}>estimated from the gaps between spines. Correct it if it's off.</span>
          <button type="submit">Slice and read spines</button>
          <button type="button" onClick={() => setStep({ kind: 'pick' })}>Different photo</button>
        </form>
      )}

      {step.kind === 'working' && (
        <p role="status" style={{ color: '#aaa' }}>
          {step.message}
          {step.total !== undefined && ` ${step.done! + 1} of ${step.total}…`}
        </p>
      )}

      {error && <p role="alert" style={{ color: '#f44336' }}>{error}</p>}
    </div>
  );
}
