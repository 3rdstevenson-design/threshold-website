'use client';

import { useRef, useState } from 'react';
import { Alert, Button, FieldLabel } from '../../_ui';

const C = {
  bg: 'var(--obsidian)',
  surface: 'var(--bg-elevated)',
  purple: 'var(--threshold-purple)',
  gold: 'var(--champion-gold)',
  white: 'var(--clinical-white)',
  silver: 'var(--sterling-silver)',
  green: 'var(--status-success-fg)',
  red: 'var(--status-error-fg)',
  border: 'var(--border-hairline)',
};

export interface UploadModalProps {
  /** Empty string → manual-entry mode (user must supply URL or id). */
  mediaId: string;
  captionHint: string;
  dashKey: string;
  onClose: () => void;
  onUploaded: () => void;
}

export default function UploadModal({
  mediaId: initialMediaId,
  captionHint,
  dashKey,
  onClose,
  onUploaded,
}: UploadModalProps) {
  const isManualEntry = initialMediaId === '';

  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [reelUrlOrId, setReelUrlOrId] = useState('');
  const [manualCaption, setManualCaption] = useState('');
  const [manualDurationSec, setManualDurationSec] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    curvePoints: number;
    visionNotes?: string;
    framesExtracted?: number;
    framesSkippedReason?: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function submit() {
    if (!file) {
      setError('Pick a screenshot first.');
      return;
    }
    if (isManualEntry && !reelUrlOrId.trim()) {
      setError('Paste the Reel URL or media ID.');
      return;
    }
    setUploading(true);
    setError(null);
    setResult(null);
    const form = new FormData();
    form.append('file', file);

    if (isManualEntry) {
      const v = reelUrlOrId.trim();
      if (v.includes('instagram.com')) form.append('reelUrl', v);
      else form.append('mediaId', v);
      if (manualCaption.trim()) form.append('caption', manualCaption.trim());
      const durSec = parseFloat(manualDurationSec);
      if (Number.isFinite(durSec) && durSec > 0) {
        form.append('videoDurationMs', String(Math.round(durSec * 1000)));
      }
    } else {
      form.append('mediaId', initialMediaId);
    }
    if (notes.trim()) form.append('notes', notes.trim());

    try {
      const res = await fetch('/api/analytics/retention-upload', {
        method: 'POST',
        headers: { 'x-dashboard-key': dashKey },
        body: form,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Upload failed');
        return;
      }
      setResult({
        curvePoints: json.curvePoints,
        visionNotes: json.visionNotes,
        framesExtracted: json.framesExtracted,
        framesSkippedReason: json.framesSkippedReason,
      });
      onUploaded();
    } catch (e: any) {
      setError(e?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: 20,
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.surface,
          borderRadius: 8,
          border: `1px solid ${C.border}`,
          borderTop: `2px solid ${C.purple}`,
          boxShadow: 'var(--glow-md)',
          maxWidth: 540,
          width: '100%',
          padding: 28,
          color: C.white,
          fontFamily: 'var(--font-body)',
        }}
      >
        <div style={{
          fontSize: 11, fontWeight: 600, letterSpacing: '0.35em',
          color: C.purple, textTransform: 'uppercase', marginBottom: 8,
          fontFamily: 'var(--font-ui)',
        }}>
          Retention upload
        </div>
        <h2 style={{
          fontSize: 24, fontWeight: 300, margin: '0 0 10px',
          fontFamily: 'var(--font-display)', lineHeight: 1.1,
        }}>
          Upload drop-off screenshot
        </h2>
        {isManualEntry ? (
          <div style={{ fontSize: 14, color: C.silver, marginBottom: 18, lineHeight: 1.65 }}>
            Paste the Reel URL or media ID, then drop the retention screenshot.
            If the post hasn&apos;t been synced from Meta yet, we&apos;ll create a
            stub record and fill in real metrics on the next sync.
          </div>
        ) : (
          <div style={{ fontSize: 14, color: C.silver, marginBottom: 18, lineHeight: 1.65 }}>
            <div style={{ fontStyle: 'italic', fontFamily: 'var(--font-display)' }}>&quot;{captionHint.slice(0, 90)}{captionHint.length > 90 ? '…' : ''}&quot;</div>
            <div style={{ marginTop: 8, fontSize: 13 }}>Claude vision will parse the chart into a per-second retention curve.</div>
          </div>
        )}

        {isManualEntry && (
          <div style={{ display: 'grid', gap: 14, marginBottom: 16 }}>
            <div>
              <FieldLabel>Instagram Reel URL or media ID</FieldLabel>
              <input
                value={reelUrlOrId}
                onChange={(e) => setReelUrlOrId(e.target.value)}
                placeholder="https://www.instagram.com/reel/CxYz…/   or   17912345678901234"
                style={inputStyle}
              />
            </div>
            <div>
              <FieldLabel>Caption (optional)</FieldLabel>
              <input
                value={manualCaption}
                onChange={(e) => setManualCaption(e.target.value)}
                placeholder="First line of the caption — helps hook-style classification"
                style={inputStyle}
              />
            </div>
            <div>
              <FieldLabel>Video duration, seconds (optional)</FieldLabel>
              <input
                value={manualDurationSec}
                onChange={(e) => setManualDurationSec(e.target.value)}
                placeholder="e.g. 28"
                inputMode="numeric"
                style={inputStyle}
              />
            </div>
          </div>
        )}

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) setFile(f);
          }}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${file ? C.purple : C.border}`,
            borderRadius: 8,
            padding: 28,
            textAlign: 'center',
            cursor: 'pointer',
            color: C.silver,
            marginBottom: 16,
            background: file ? 'rgba(112, 2, 171, 0.04)' : 'transparent',
            transition: 'border-color .2s ease, background-color .2s ease',
          }}
        >
          {file ? (
            <>
              <div style={{ color: C.white, fontWeight: 600, fontFamily: 'var(--font-body)' }}>{file.name}</div>
              <div style={{ fontSize: 11, marginTop: 6, fontFamily: 'var(--font-ui)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>{(file.size / 1024).toFixed(0)} KB · {file.type}</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 14 }}>Drop a PNG / JPEG / WebP here, or click to pick.</div>
              <div style={{ fontSize: 11, marginTop: 6, fontFamily: 'var(--font-ui)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
                Screenshot Instagram&apos;s Pro Dashboard retention chart
              </div>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setFile(f);
            }}
          />
        </div>

        <FieldLabel>Notes (optional)</FieldLabel>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. felt like the b-roll cut too fast around 0:04"
          rows={3}
          style={{
            ...inputStyle,
            resize: 'vertical',
            marginBottom: 16,
            minHeight: 72,
          }}
        />

        {error && (
          <div style={{ marginBottom: 14 }}>
            <Alert kind="error" title="Couldn't upload">{error}</Alert>
          </div>
        )}
        {result && (
          <div style={{ marginBottom: 14 }}>
            <Alert kind="success" title="Parsed">
              {result.curvePoints} points.
              {typeof result.framesExtracted === 'number' && result.framesExtracted > 0
                ? ` Extracted ${result.framesExtracted} drop-cliff frame(s).`
                : result.framesSkippedReason
                  ? ` No frames — ${result.framesSkippedReason}.`
                  : ''}
              {result.visionNotes ? ` Claude notes: "${result.visionNotes}"` : ''}
            </Alert>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={submit} disabled={!file || uploading}>
            {uploading ? 'Parsing…' : 'Upload & parse'}
          </Button>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  background: 'var(--input-bg)',
  border: `1px solid var(--input-border)`,
  borderRadius: 8,
  color: C.white,
  padding: '12px 14px',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  boxSizing: 'border-box' as const,
  outline: 'none',
  transition: 'border-color .2s, background-color .2s',
};
