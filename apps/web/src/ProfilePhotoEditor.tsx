import { useRef, useState, type PointerEvent } from 'react';
import { MaterialIcon } from './MaterialIcon.js';
import './ProfilePhotoEditor.css';

type Crop = { x: number; y: number; zoom: number };

/** Shared square avatar editor: drag to frame, zoom, then save the chosen crop. */
export function ProfilePhotoEditor({ value, onChange, onError, maxBytes = 5 * 1024 * 1024, label = 'Foto de perfil' }: {
  value?: string;
  onChange: (croppedPhoto: string) => void;
  onError?: (message: string) => void;
  maxBytes?: number;
  label?: string;
}) {
  const [source, setSource] = useState('');
  const [ratio, setRatio] = useState(1);
  const [crop, setCrop] = useState<Crop>({ x: 0.5, y: 0.5, zoom: 1 });
  const [filename, setFilename] = useState('');
  const [error, setError] = useState('');
  const viewport = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function report(message: string) { setError(message); onError?.(message); }
  function choose(file?: File) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > maxBytes) {
      report(`Escolha uma imagem PNG, JPEG, WebP ou GIF de até ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { setSource(String(reader.result)); setFilename(file.name); setCrop({ x: 0.5, y: 0.5, zoom: 1 }); setError(''); };
    reader.onerror = () => report('Não foi possível abrir a imagem.');
    reader.readAsDataURL(file);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || !image.current || !viewport.current) return;
    const rect = viewport.current.getBoundingClientRect();
    const width = Math.max(100, ratio * 100) * crop.zoom;
    const height = Math.max(100, 100 / ratio) * crop.zoom;
    const overflowX = Math.max(1, rect.width * (width / 100 - 1));
    const overflowY = Math.max(1, rect.height * (height / 100 - 1));
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    drag.current = { x: event.clientX, y: event.clientY };
    setCrop((current) => ({ ...current, x: Math.max(0, Math.min(1, current.x - dx / overflowX)), y: Math.max(0, Math.min(1, current.y - dy / overflowY)) }));
  }
  function apply() {
    const selected = image.current;
    if (!selected?.naturalWidth || !selected.naturalHeight) return;
    const side = Math.min(selected.naturalWidth, selected.naturalHeight) / crop.zoom;
    const left = (selected.naturalWidth - side) * crop.x;
    const top = (selected.naturalHeight - side) * crop.y;
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) { report('Não foi possível ajustar esta foto.'); return; }
    context.drawImage(selected, left, top, side, side, 0, 0, canvas.width, canvas.height);
    onChange(canvas.toDataURL('image/jpeg', 0.9));
    setSource(''); setFilename(''); setError('');
  }

  return <section className="profile-photo-editor" aria-label={label}>
    <div className="profile-photo-editor-current">{value ? <img src={value} alt="Foto de perfil atual"/> : <span><MaterialIcon name="person"/></span>}</div>
    <div className="profile-photo-editor-controls">
      <strong>{label}</strong>
      <button type="button" className="profile-photo-editor-choose" onClick={() => fileInput.current?.click()}><MaterialIcon name="photo_camera"/>{source ? 'Escolher outra foto' : 'Alterar foto'}</button>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { choose(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }}/>
      {source && <>
        <div className="profile-photo-crop-viewport" ref={viewport} onPointerDown={(event) => { drag.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} aria-label="Arraste a foto para ajustar o enquadramento">
          <img ref={image} src={source} alt="Prévia do enquadramento" draggable={false} onLoad={(event) => setRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} style={{ position: 'absolute', width: `${Math.max(100, ratio * 100) * crop.zoom}%`, height: `${Math.max(100, 100 / ratio) * crop.zoom}%`, left: `${(100 - Math.max(100, ratio * 100) * crop.zoom) * crop.x}%`, top: `${(100 - Math.max(100, 100 / ratio) * crop.zoom) * crop.y}%` }}/>
          <span>Arraste para ajustar</span>
        </div>
        <label className="profile-photo-zoom">Zoom<input type="range" min="1" max="3" step="0.01" value={crop.zoom} onChange={(event) => setCrop((current) => ({ ...current, zoom: Number(event.currentTarget.value) }))}/></label>
        {filename && <small className="profile-photo-filename">{filename}</small>}
        <button type="button" className="profile-photo-apply" onClick={apply}>Aplicar enquadramento</button>
      </>}
      {error && <small className="profile-photo-error" role="alert">{error}</small>}
      <small>Você pode arrastar a foto e ajustar o zoom antes de salvar.</small>
    </div>
  </section>;
}
