"""KYC level 3 automatic checks. HINTS for the support agent, never a decision (2026-11-22).

Open-source only (no keyed service): OpenCV's YuNet face detector and SFace face recogniser,
both from the opencv_zoo repository (Apache 2.0), read from KYC_MODELS_DIR:
  face_detection_yunet_2023mar.onnx, face_recognition_sface_2021dec.onnx

For each request it reports:
  - per image: size, sharpness (variance of the Laplacian), brightness, number of faces;
  - the selfie against the ID photo: SFace cosine similarity (OpenCV's own threshold 0.363 = same
    person);
  - the same exact image sent by another person, and the same face behind another account
    (selfies still kept, i.e. at most KYC_L3_IMAGE_DAYS after their decision);
  - `hints`: short codes the desk turns into sentences.
No text is read from the document (no OCR, no MRZ): the agent reads it.

The engine is injectable so the tests run without OpenCV or the models.
"""
from __future__ import annotations

import os
from typing import Any, Optional, Protocol

SAME_PERSON = 0.363      # OpenCV's published cosine threshold for SFace
OTHER_ACCOUNT = 0.45     # stricter: a hint against another member must not fire on look-alikes
MAX_SIDE = 1600          # images are scaled down to this before detection
BLURRY = 60.0            # variance of the Laplacian below which an image is called blurry
DARK, BRIGHT = 45.0, 225.0
VERSION = 1


class Engine(Protocol):
    name: str

    def decode(self, data: bytes) -> Any: ...
    def quality(self, img: Any) -> dict: ...
    def faces(self, img: Any, min_score: float) -> list: ...
    def feature(self, img: Any, face: Any) -> bytes: ...
    def similarity(self, a: bytes, b: bytes) -> float: ...


class OpenCVEngine:
    name = "opencv-yunet-sface"

    def __init__(self, models_dir: str):
        import cv2  # imported here: the API container and the tests never load OpenCV
        import numpy as np
        self.cv2, self.np = cv2, np
        det = os.path.join(models_dir, "face_detection_yunet_2023mar.onnx")
        rec = os.path.join(models_dir, "face_recognition_sface_2021dec.onnx")
        for p in (det, rec):
            if not os.path.isfile(p):
                raise FileNotFoundError(os.path.basename(p))
        cv2.setNumThreads(1)
        self.det = cv2.FaceDetectorYN.create(det, "", (320, 320), 0.6, 0.3, 50)
        self.rec = cv2.FaceRecognizerSF.create(rec, "")

    def decode(self, data: bytes):
        cv2, np = self.cv2, self.np
        img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            return None
        h, w = img.shape[:2]
        k = MAX_SIDE / max(h, w)
        if k < 1:
            img = cv2.resize(img, (int(w * k), int(h * k)), interpolation=cv2.INTER_AREA)
        return img

    def quality(self, img) -> dict:
        cv2 = self.cv2
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape[:2]
        return {"width": int(w), "height": int(h), "sharpness": round(float(cv2.Laplacian(gray, cv2.CV_64F).var()), 1),
                "brightness": round(float(gray.mean()), 1)}

    def faces(self, img, min_score: float) -> list:
        h, w = img.shape[:2]
        self.det.setInputSize((w, h))
        self.det.setScoreThreshold(min_score)
        _, found = self.det.detect(img)
        if found is None:
            return []
        return sorted(list(found), key=lambda f: -float(f[2] * f[3]))  # biggest face first

    def feature(self, img, face) -> bytes:
        aligned = self.rec.alignCrop(img, face)
        return self.np.asarray(self.rec.feature(aligned), dtype=self.np.float32).tobytes()

    def similarity(self, a: bytes, b: bytes) -> float:
        np = self.np
        fa, fb = np.frombuffer(a, dtype=np.float32).reshape(1, -1), np.frombuffer(b, dtype=np.float32).reshape(1, -1)
        return float(self.rec.match(fa, fb, self.cv2.FaceRecognizerSF_FR_COSINE))


def load_engine(models_dir: Optional[str] = None) -> Optional[Engine]:
    try:
        return OpenCVEngine(models_dir or os.environ.get("KYC_MODELS_DIR", "/models"))
    except Exception:
        return None


def analyse(images: dict[str, bytes], engine: Optional[Engine], other_faces: list[tuple[str, str, bytes]] = (),
            same_image_elsewhere: int = 0) -> tuple[dict, Optional[bytes]]:
    """(scores, the selfie's face vector or None). Never raises on a bad image."""
    hints: list[str] = []
    out: dict = {"version": VERSION, "engine": engine.name if engine else "unavailable", "images": {}, "match": None,
                 "sameImageOtherPeople": same_image_elsewhere, "sameFaceOtherPeople": [], "hints": hints}
    if same_image_elsewhere:
        hints.append("image_reused")
    if engine is None:
        hints.append("engine_unavailable")
        return out, None

    decoded, found = {}, {}
    for kind in ("id_front", "id_back", "selfie"):
        if kind not in images:
            continue
        try:
            img = engine.decode(images[kind])
        except Exception:
            img = None
        if img is None:
            out["images"][kind] = {"readable": False}
            hints.append(f"{kind}_unreadable")
            continue
        q = engine.quality(img)
        # A printed ID photo scores lower than a live face: a lower bar there.
        fs = engine.faces(img, 0.5 if kind == "id_front" else 0.7) if kind != "id_back" else []
        q.update({"readable": True, "faces": len(fs)})
        out["images"][kind] = q
        decoded[kind], found[kind] = img, fs
        if q["sharpness"] < BLURRY:
            hints.append(f"{kind}_blurry")
        if q["brightness"] < DARK:
            hints.append(f"{kind}_dark")
        elif q["brightness"] > BRIGHT:
            hints.append(f"{kind}_overexposed")

    if "selfie" in decoded:
        n = len(found["selfie"])
        if n == 0:
            hints.append("selfie_no_face")
        elif n > 1:
            hints.append("selfie_several_faces")
    if "id_front" in decoded and not found["id_front"]:
        hints.append("id_no_face")

    selfie_vec = None
    try:
        if found.get("selfie"):
            selfie_vec = engine.feature(decoded["selfie"], found["selfie"][0])
        if selfie_vec is not None and found.get("id_front"):
            id_vec = engine.feature(decoded["id_front"], found["id_front"][0])
            score = round(engine.similarity(selfie_vec, id_vec), 3)
            out["match"] = {"score": score, "same": score >= SAME_PERSON, "threshold": SAME_PERSON}
            if score < SAME_PERSON:
                hints.append("faces_differ")
        if selfie_vec is not None:
            seen = []
            for rid, ref, vec in other_faces:
                s = engine.similarity(selfie_vec, vec)
                if s >= OTHER_ACCOUNT:
                    seen.append({"request": rid, "ref": ref, "score": round(s, 3)})
            seen.sort(key=lambda x: -x["score"])
            out["sameFaceOtherPeople"] = seen[:5]
            if seen:
                hints.append("face_seen_on_other_account")
    except Exception:
        hints.append("face_compare_failed")
    return out, selfie_vec
