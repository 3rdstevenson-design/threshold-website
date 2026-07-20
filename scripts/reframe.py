#!/usr/bin/env python3
"""
reframe.py — compute a time-varying 9:16 crop window for a horizontal
video based on face detection + optional speaker diarization.

Called by lib/editor/reframe.ts as a subprocess. Consumes:

    --video <path>                  absolute path to child source.mp4
    --out <path>                    absolute path to reframe.json
    --diarization <path>            optional path to diarization.json
    --sample-fps <float>            how often to run face detection (default 10)
    --target-aspect <float>         default 9/16 ≈ 0.5625
    --smooth-window-sec <float>     moving-average smoothing window (default 0.5)

Produces a JSON keyframe track:

    {
      "fps": 10.0,
      "sourceWidth": 1920,
      "sourceHeight": 1080,
      "targetAspect": 0.5625,
      "keyframes": [
        {"tSec": 0.0, "cx": 960, "cy": 540, "scale": 1.78},
        ...
      ]
    }

Where (cx, cy) is the center of the 9:16 crop window in SOURCE pixel
coordinates at time tSec, and `scale` is the crop box height as a
fraction of the source height (0.85-1.0 typical — shrink when needed
to fit two faces, expand to 1.0 to include the whole vertical axis).

At render time ffmpeg's `crop` filter (with `sendcmd` for time-varying
parameters) uses these to produce the vertical output.

Dependencies (install once):
    pip install mediapipe opencv-python numpy

Error handling: if mediapipe is missing, the script writes an
"identity" reframe (center crop, no tracking) so the pipeline still
works without the reframing dependency installed — with a warning on
stderr. This makes the overall feature degrade gracefully.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from dataclasses import dataclass, asdict
from typing import List, Optional, Tuple


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


@dataclass
class Keyframe:
    tSec: float
    cx: float
    cy: float
    scale: float


@dataclass
class DetectedFaces:
    tSec: float
    faces: List[Tuple[float, float, float, float]]  # (x, y, w, h) in source pixels


def load_diarization(path: Optional[str]):
    """Load diarization.json into a list of (start, end, speaker) tuples."""
    if not path or not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        log(f"WARN: could not parse diarization.json: {e}")
        return []
    words = data.get("words", [])
    segments = []
    for w in words:
        try:
            segments.append((float(w["startSec"]), float(w["endSec"]), str(w["speaker"])))
        except Exception:
            continue
    return segments


def active_speaker_at(segments, t_sec: float) -> Optional[str]:
    for s, e, sp in segments:
        if s <= t_sec <= e:
            return sp
    return None


def detect_all_faces(video_path: str, sample_fps: float) -> Tuple[List[DetectedFaces], int, int, float]:
    """Sample the video at sample_fps and return per-sample face lists.

    Returns (detections, source_width, source_height, total_duration_sec).
    Gracefully degrades to (empty, w, h, dur) if MediaPipe isn't installed.
    """
    try:
        import cv2  # type: ignore
    except ImportError:
        log("ERROR: opencv-python not installed — install with `pip install opencv-python mediapipe numpy`")
        return [], 0, 0, 0.0

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        log(f"ERROR: could not open video {video_path}")
        return [], 0, 0, 0.0

    source_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    source_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    native_fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration_sec = total_frames / native_fps if native_fps > 0 else 0.0

    try:
        import mediapipe as mp  # type: ignore
    except ImportError:
        log("WARN: mediapipe not installed — falling back to center crop. Install with `pip install mediapipe`")
        cap.release()
        return [], source_w, source_h, duration_sec

    mp_face = mp.solutions.face_detection
    # model_selection=1 = full-range (up to 5m away) — better for wide podcast shots.
    detector = mp_face.FaceDetection(model_selection=1, min_detection_confidence=0.5)

    sample_interval = max(1, int(round(native_fps / sample_fps)))
    detections: List[DetectedFaces] = []

    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % sample_interval != 0:
            frame_idx += 1
            continue
        t_sec = frame_idx / native_fps
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        res = detector.process(rgb)
        faces: List[Tuple[float, float, float, float]] = []
        if res.detections:
            for det in res.detections:
                bb = det.location_data.relative_bounding_box
                x = max(0.0, bb.xmin) * source_w
                y = max(0.0, bb.ymin) * source_h
                w = min(1.0, bb.width) * source_w
                h = min(1.0, bb.height) * source_h
                if w <= 0 or h <= 0:
                    continue
                faces.append((x, y, w, h))
        detections.append(DetectedFaces(tSec=t_sec, faces=faces))
        frame_idx += 1

    cap.release()
    detector.close()
    log(f"Face detection: sampled {len(detections)} frames, source {source_w}×{source_h}, duration {duration_sec:.2f}s")
    return detections, source_w, source_h, duration_sec


def crop_includes_all(faces, source_w: int, source_h: int, target_aspect: float, min_scale: float = 0.85) -> Optional[Tuple[float, float, float]]:
    """Can a single 9:16 crop at ≥min_scale include every face?

    The 9:16 crop is parameterized by its height = source_h * scale and its
    center (cx, cy). Width = height * target_aspect. We check whether there
    exists a scale ≥ min_scale where a valid crop contains every face
    bounding box. If yes, return (cx, cy, scale). Otherwise return None.
    """
    if not faces:
        return None
    xs_min = min(f[0] for f in faces)
    ys_min = min(f[1] for f in faces)
    xs_max = max(f[0] + f[2] for f in faces)
    ys_max = max(f[1] + f[3] for f in faces)

    pad = 0.15  # 15% padding so faces aren't right at the crop edges
    bb_w = (xs_max - xs_min) * (1 + pad * 2)
    bb_h = (ys_max - ys_min) * (1 + pad * 2)

    # Needed crop height (in source pixels) to contain the bb with the
    # required aspect ratio. Both axes must fit.
    needed_h = max(bb_h, bb_w / target_aspect)
    scale = needed_h / source_h
    if scale > 1.0 or scale < min_scale:
        # Either doesn't fit (scale > 1) or would require a crop taller
        # than source_h at the given aspect (still scale > 1). The
        # min_scale floor prevents overly-zoomed crops that swallow
        # unrelated background.
        if scale > 1.0:
            return None
        # scale < min_scale means we *can* fit with room to spare — clamp
        # to min_scale for a tighter frame.
        scale = min_scale

    crop_h = source_h * scale
    crop_w = crop_h * target_aspect
    cx = (xs_min + xs_max) / 2
    cy = (ys_min + ys_max) / 2
    # Clamp so the crop stays inside the source frame.
    cx = max(crop_w / 2, min(source_w - crop_w / 2, cx))
    cy = max(crop_h / 2, min(source_h - crop_h / 2, cy))
    return cx, cy, scale


def face_for_speaker(faces, speaker: str, face_speaker_map):
    """Pick the detected face attributed to the active speaker.

    face_speaker_map is a simple heuristic built once at the start: speaker
    '0' is the LEFTMOST face, speaker '1' the next, etc. Works for the
    typical podcast setup (fixed camera, two guests). If the number of
    detected faces doesn't match the heuristic, fall back to the leftmost.
    """
    if not faces:
        return None
    idx = face_speaker_map.get(speaker, 0)
    if idx >= len(faces):
        idx = 0
    return faces[idx]


def build_speaker_map(detections: List[DetectedFaces], speakers: List[str]):
    """Return { speaker_id → face_index } by left-to-right ordering.

    Uses the first sample where the number of detected faces matches the
    number of diarized speakers. This assumes a podcast setup with fixed
    seating. For other setups the caller can override.
    """
    if not speakers:
        return {}
    for d in detections:
        if len(d.faces) == len(speakers):
            ordered = sorted(d.faces, key=lambda f: f[0])
            return {sp: i for i, sp in enumerate(sorted(speakers)) for i in [ordered.index(d.faces[sorted(d.faces, key=lambda f: f[0]).index(d.faces[i])])]}
    # Fallback: all speakers → leftmost face (index 0)
    return {sp: 0 for sp in speakers}


def compute_keyframes(
    detections: List[DetectedFaces],
    source_w: int,
    source_h: int,
    duration_sec: float,
    target_aspect: float,
    diarization_segments,
) -> List[Keyframe]:
    """Turn per-sample face detections into a time-varying crop track.

    Policy per sample:
      - 0 faces: hold previous crop (low-pass), or center if first sample
      - 1 face: center crop on that face with headroom padding
      - 2+ faces that all fit in a 9:16 window at ≥0.85× source height:
            crop to include all
      - 2+ faces that don't fit: use diarization to pick the active
            speaker's face; crop centered on that. If no speaker active
            at that moment, hold previous crop.
    """
    if not detections or source_w == 0 or source_h == 0:
        return [Keyframe(tSec=0.0, cx=(source_w or 1920) / 2, cy=(source_h or 1080) / 2, scale=1.0)]

    # Build speaker→face-index map once per clip (heuristic).
    speaker_ids = sorted({sp for _, _, sp in diarization_segments})
    speaker_map = build_speaker_map(detections, speaker_ids)
    if speaker_ids:
        log(f"Speaker map: {speaker_map}")

    # Default/identity crop — centered full-frame at target aspect.
    default_cy = source_h / 2
    default_scale = 1.0
    # Default cx centers the 9:16 window horizontally inside the source.
    crop_w_default = source_h * default_scale * target_aspect
    default_cx = source_w / 2
    # Clamp in case source aspect is narrower than target (rare; unlikely for wide podcast cams).
    default_cx = max(crop_w_default / 2, min(source_w - crop_w_default / 2, default_cx))

    raw: List[Keyframe] = []
    last_cx, last_cy, last_scale = default_cx, default_cy, default_scale

    for d in detections:
        faces = d.faces
        n = len(faces)
        if n == 0:
            # Hold previous crop.
            raw.append(Keyframe(tSec=d.tSec, cx=last_cx, cy=last_cy, scale=last_scale))
            continue

        if n == 1:
            x, y, w, h = faces[0]
            fcx = x + w / 2
            fcy = y + h / 2 - h * 0.3  # bias upward so shoulders are visible with headroom above
            scale = default_scale
            crop_h = source_h * scale
            crop_w = crop_h * target_aspect
            cx = max(crop_w / 2, min(source_w - crop_w / 2, fcx))
            cy = max(crop_h / 2, min(source_h - crop_h / 2, fcy))
            raw.append(Keyframe(tSec=d.tSec, cx=cx, cy=cy, scale=scale))
            last_cx, last_cy, last_scale = cx, cy, scale
            continue

        fit = crop_includes_all(faces, source_w, source_h, target_aspect)
        if fit is not None:
            cx, cy, scale = fit
            raw.append(Keyframe(tSec=d.tSec, cx=cx, cy=cy, scale=scale))
            last_cx, last_cy, last_scale = cx, cy, scale
            continue

        # Two-plus faces don't fit — consult diarization.
        active = active_speaker_at(diarization_segments, d.tSec)
        if active is not None:
            target_face = face_for_speaker(faces, active, speaker_map)
            if target_face is not None:
                x, y, w, h = target_face
                fcx = x + w / 2
                fcy = y + h / 2 - h * 0.3
                scale = default_scale
                crop_h = source_h * scale
                crop_w = crop_h * target_aspect
                cx = max(crop_w / 2, min(source_w - crop_w / 2, fcx))
                cy = max(crop_h / 2, min(source_h - crop_h / 2, fcy))
                raw.append(Keyframe(tSec=d.tSec, cx=cx, cy=cy, scale=scale))
                last_cx, last_cy, last_scale = cx, cy, scale
                continue

        # Silence or unknown speaker — hold previous crop.
        raw.append(Keyframe(tSec=d.tSec, cx=last_cx, cy=last_cy, scale=last_scale))

    return raw


def smooth_keyframes(keyframes: List[Keyframe], window_sec: float) -> List[Keyframe]:
    """Simple symmetric moving average over each axis. Keeps motion
    cinematic, not jittery."""
    if len(keyframes) < 2 or window_sec <= 0:
        return keyframes
    # Approximate window in samples from average spacing.
    spans = [keyframes[i + 1].tSec - keyframes[i].tSec for i in range(len(keyframes) - 1)]
    avg_spacing = sum(spans) / len(spans) if spans else 0.1
    half = max(1, int(round(window_sec / 2 / max(avg_spacing, 1e-3))))

    smoothed: List[Keyframe] = []
    for i, kf in enumerate(keyframes):
        lo = max(0, i - half)
        hi = min(len(keyframes), i + half + 1)
        window = keyframes[lo:hi]
        cx = sum(k.cx for k in window) / len(window)
        cy = sum(k.cy for k in window) / len(window)
        scale = sum(k.scale for k in window) / len(window)
        smoothed.append(Keyframe(tSec=kf.tSec, cx=cx, cy=cy, scale=scale))
    return smoothed


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--diarization", default=None)
    ap.add_argument("--sample-fps", type=float, default=10.0)
    ap.add_argument("--target-aspect", type=float, default=9.0 / 16.0)
    ap.add_argument("--smooth-window-sec", type=float, default=0.5)
    args = ap.parse_args()

    diar_segments = load_diarization(args.diarization)
    if diar_segments:
        log(f"Loaded {len(diar_segments)} diarization segments.")

    detections, source_w, source_h, duration = detect_all_faces(
        args.video, args.sample_fps,
    )

    if source_w == 0 or source_h == 0:
        # Fallback: write identity reframe so ffmpeg still has a file to
        # consume downstream. The Next.js render step will treat a zero-
        # width source as "skip reframing".
        payload = {
            "fps": args.sample_fps,
            "sourceWidth": 0,
            "sourceHeight": 0,
            "targetAspect": args.target_aspect,
            "keyframes": [],
            "note": "reframe skipped — could not read source dimensions",
        }
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
        log("Wrote identity reframe (no tracking).")
        return 0

    raw = compute_keyframes(
        detections, source_w, source_h, duration,
        args.target_aspect, diar_segments,
    )
    smoothed = smooth_keyframes(raw, args.smooth_window_sec)

    payload = {
        "fps": args.sample_fps,
        "sourceWidth": source_w,
        "sourceHeight": source_h,
        "targetAspect": args.target_aspect,
        "keyframes": [asdict(kf) for kf in smoothed],
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    log(f"Wrote {len(smoothed)} keyframes → {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
