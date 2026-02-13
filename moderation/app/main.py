import io
import logging
import os
import re
import unicodedata
from functools import lru_cache
from typing import Any, Dict, List

import requests
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field
from transformers import pipeline

app = FastAPI(title="sdu-moderation", version="1.0.0")
logger = logging.getLogger("moderation")
logging.basicConfig(level=os.getenv("MODERATION_LOG_LEVEL", "INFO"))

MAX_TEXT_CHARS = int(os.getenv("MODERATION_MAX_TEXT_CHARS", "5000"))
MAX_IMAGE_BYTES = int(os.getenv("MODERATION_MAX_IMAGE_BYTES", str(7 * 1024 * 1024)))
FETCH_TIMEOUT_SEC = float(os.getenv("MODERATION_FETCH_TIMEOUT_SEC", "5"))
TEXT_THRESHOLD = float(os.getenv("MODERATION_TEXT_THRESHOLD", "0.75"))
IMAGE_THRESHOLD = float(os.getenv("MODERATION_IMAGE_THRESHOLD", "0.70"))
SUGGESTIVE_THRESHOLD = float(os.getenv("MODERATION_SUGGESTIVE_THRESHOLD", "0.45"))
BLOCK_SUGGESTIVE = os.getenv("MODERATION_BLOCK_SUGGESTIVE", "true").lower() in {"1", "true", "yes", "on"}

TEXT_MODEL_NAME = os.getenv("MODERATION_TEXT_MODEL", "s-nlp/russian_toxicity_classifier")
IMAGE_MODEL_NAME = os.getenv("MODERATION_IMAGE_MODEL", "Falconsai/nsfw_image_detection")
SUGGESTIVE_MODEL_NAME = os.getenv("MODERATION_SUGGESTIVE_MODEL", "prithivMLmods/Mature-Content-Detection")
TEXT_MODEL_REQUIRED = os.getenv("MODERATION_TEXT_MODEL_REQUIRED", "false").lower() in {"1", "true", "yes", "on"}
IMAGE_MODEL_REQUIRED = os.getenv("MODERATION_IMAGE_MODEL_REQUIRED", "true").lower() in {"1", "true", "yes", "on"}
SUGGESTIVE_MODEL_REQUIRED = os.getenv("MODERATION_SUGGESTIVE_MODEL_REQUIRED", "false").lower() in {"1", "true", "yes", "on"}

TOXIC_LABEL_HINTS = (
    "toxic",
    "toxicity",
    "obscene",
    "insult",
    "threat",
    "hate",
    "sexual",
    "offensive",
    "profanity",
    "abusive",
    "severe_toxic",
    "identity_hate",
)
TOXIC_NEGATIVE_LABEL_HINTS = (
    "non-toxic",
    "non toxic",
    "not toxic",
    "safe",
    "clean",
    "neutral",
    "normal",
    "acceptable",
    "benign",
)
NSFW_LABEL_HINTS = (
    "nsfw",
    "porn",
    "explicit",
    "sexy",
    "hentai",
    "nude",
    "erotic",
)
SUGGESTIVE_LABEL_HINTS = (
    "enticing",
    "sensual",
    "sexy",
    "erotic",
    "bikini",
    "swimwear",
    "lingerie",
    "underwear",
    "revealing",
)

DEFAULT_BLOCKED_TERMS = [
    "порно",
    "порн",
    "секс",
    "анал",
    "минет",
    "шлюха",
    "бляд",
    "еб",
    "хуй",
    "пизд",
    "дроч",
    "gay porn",
    "porn",
    "sex",
    "anal",
    "blowjob",
    "handjob",
    "fuck",
    "fucking",
    "bitch",
    "whore",
    "nude",
    "naked",
    "nsfw",
    "гей",
    "сука",
    "сучка",
    "мудак",
    "долбоеб",
    "долбаеб",
    "пидор",
    "пидр",
    "пидорас",
    "пидарас",
    "педик",
    "ебать",
    "ебан",
    "еблан",
    "уеб",
    "нахуй",
    "хуесос",
    "похуй",
    "хуйн",
    "хер",
    "гандон",
    "гондон",
    "мраз",
    "мразь",
    "ублюд",
    "чмо",
    "шалава",
    "кончен",
    "заеб",
    "выеб",
    "доеб",
    "проеб",
    "ебуч",
    "уебок",
    "уебан",
    "проститут",
    "залуп",
    "shit",
    "idiot",
    "moron",
    "bastard",
    "slut",
    "asshole",
    "motherfucker",
    "cunt",
    "dick",
    "faggot",
    "nigger",
    "nigga",
    "pornhub",
    "xxx",
    "rape",
    "raped",
    "fetish",
    "orgasm",
    "masturbat",
    "nudes",
]

STEM_TERMS = {
    "порн",
    "еба",
    "бляд",
    "пизд",
    "дроч",
    "хуй",
    "сук",
    "пидр",
    "пидорас",
    "наху",
    "уеб",
    "еблан",
    "хуесос",
    "хуйн",
    "заеб",
    "выеб",
    "доеб",
    "проеб",
    "ебуч",
    "уебок",
    "уебан",
    "гандон",
    "гондон",
    "мраз",
    "ублюд",
    "шалав",
    "проститут",
    "залуп",
    "кончен",
    "masturbat",
    "rape",
    "porn",
}

ZERO_WIDTH_RE = re.compile(r"[\u200b-\u200f\u202a-\u202e\u2060\ufeff]")
SEPARATOR_RE = r"(?:[\s\W_])*"
WORD_CHAR_CLASS = r"0-9A-Za-zА-Яа-яЁё"
CONFUSABLE_RAW_MAP = {
    "a": "aа@4",
    "а": "aа@4",
    "b": "bв6",
    "б": "bб6",
    "в": "bв6",
    "c": "cс",
    "с": "cсs5$",
    "d": "dд",
    "д": "dд",
    "e": "eе3",
    "е": "eе3",
    "f": "fф",
    "ф": "fф",
    "g": "g69",
    "h": "hн",
    "н": "hнn",
    "i": "iі1!|l",
    "і": "iі1!|l",
    "k": "kк",
    "к": "kк",
    "m": "mм",
    "м": "mм",
    "n": "nн",
    "o": "oо0",
    "о": "oо0",
    "p": "pрп",
    "р": "pрr",
    "п": "pп",
    "r": "rр",
    "s": "sс5$",
    "t": "tт7+",
    "т": "tт7+",
    "u": "uу",
    "у": "uу",
    "x": "xх",
    "х": "xх",
    "y": "yу",
    "z": "zз2",
    "з": "zз2",
    "0": "oо0",
    "1": "iі1!|l",
    "2": "zз2",
    "3": "eе3",
    "4": "aа@4",
    "5": "sс5$",
    "6": "bбв6g",
    "7": "tт7+",
    "9": "g69",
    "@": "aа@4",
    "$": "sс5$",
    "!": "iі1!|l",
    "|": "iі1!|l",
    "+": "tт7+",
}


class TextModerationRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_TEXT_CHARS)
    context: str = Field(default="generic", max_length=64)


class ImageURLModerationRequest(BaseModel):
    url: str = Field(..., min_length=5, max_length=2048)
    context: str = Field(default="generic", max_length=64)


class ModerationDecision(BaseModel):
    allowed: bool
    reason: str = ""
    score: float = 0.0
    source: str = ""
    matched_terms: List[str] = Field(default_factory=list)
    labels: Dict[str, float] = Field(default_factory=dict)


def _env_extra_terms() -> List[str]:
    raw = os.getenv("MODERATION_BLOCKED_TERMS", "")
    if not raw:
        return []
    terms: List[str] = []
    for item in raw.split(","):
        term = item.strip().lower()
        if term:
            terms.append(term)
    return terms


def _normalize_text_for_match(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text).casefold()
    normalized = normalized.replace("ё", "е")
    normalized = ZERO_WIDTH_RE.sub("", normalized)
    return normalized


def _char_pattern(ch: str) -> str:
    if ch.isalnum():
        return re.escape(ch)
    return ""


def _build_confusable_map() -> Dict[str, str]:
    out: Dict[str, str] = {}
    for ch, variants in CONFUSABLE_RAW_MAP.items():
        chars = sorted(set(variants))
        escaped = "".join(re.escape(c) for c in chars)
        out[ch] = f"[{escaped}]"
    return out


CONFUSABLE_MAP = _build_confusable_map()


def _term_key(term: str) -> str:
    normalized = _normalize_text_for_match(term)
    return re.sub(r"[\s\W_]+", "", normalized, flags=re.UNICODE)


NORMALIZED_STEM_TERMS = {_term_key(t) for t in STEM_TERMS if _term_key(t)}


def _compile_term_patterns() -> List[tuple[str, re.Pattern[str]]]:
    terms = sorted(set(DEFAULT_BLOCKED_TERMS + _env_extra_terms()))
    patterns: List[tuple[str, re.Pattern[str]]] = []
    for term in terms:
        compact = _term_key(term)
        if not compact:
            continue
        parts = [CONFUSABLE_MAP.get(ch, _char_pattern(ch)) for ch in compact]
        parts = [p for p in parts if p]
        if not parts:
            continue
        body = SEPARATOR_RE.join(parts)
        if compact in NORMALIZED_STEM_TERMS:
            # Stem terms intentionally match inside larger words to catch inflections.
            pat = re.compile(body, re.IGNORECASE)
        else:
            pat = re.compile(rf"(?<![{WORD_CHAR_CLASS}]){body}(?![{WORD_CHAR_CLASS}])", re.IGNORECASE)
        patterns.append((term, pat))
    return patterns


TERM_PATTERNS = _compile_term_patterns()


@lru_cache(maxsize=1)
def _text_model() -> Any:
    try:
        logger.info("loading text moderation model: %s", TEXT_MODEL_NAME)
        return pipeline("text-classification", model=TEXT_MODEL_NAME, tokenizer=TEXT_MODEL_NAME, top_k=None)
    except Exception as exc:
        logger.exception("text model load failed: %s", exc)
        return None


@lru_cache(maxsize=1)
def _image_model() -> Any:
    try:
        logger.info("loading image moderation model: %s", IMAGE_MODEL_NAME)
        return pipeline("image-classification", model=IMAGE_MODEL_NAME, top_k=None)
    except Exception as exc:
        logger.exception("image model load failed: %s", exc)
        return None


@lru_cache(maxsize=1)
def _suggestive_model() -> Any:
    try:
        logger.info("loading suggestive image model: %s", SUGGESTIVE_MODEL_NAME)
        return pipeline("image-classification", model=SUGGESTIVE_MODEL_NAME, top_k=None)
    except Exception as exc:
        logger.exception("suggestive model load failed: %s", exc)
        return None


def _flatten_labels(raw: Any) -> List[Dict[str, Any]]:
    if raw is None:
        return []
    if isinstance(raw, dict):
        return [raw]
    if isinstance(raw, list):
        if not raw:
            return []
        if isinstance(raw[0], dict):
            return raw
        if isinstance(raw[0], list):
            out: List[Dict[str, Any]] = []
            for item in raw:
                if isinstance(item, list):
                    out.extend([x for x in item if isinstance(x, dict)])
            return out
    return []


def _labels_to_map(items: List[Dict[str, Any]]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for item in items:
        label = str(item.get("label", "")).strip().lower()
        score = float(item.get("score", 0.0) or 0.0)
        if not label:
            continue
        prev = out.get(label)
        if prev is None or score > prev:
            out[label] = score
    return out


def _merge_labels(*maps: Dict[str, float]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for m in maps:
        if not m:
            continue
        for label, score in m.items():
            prev = out.get(label)
            if prev is None or score > prev:
                out[label] = score
    return out


def _score_by_hints(labels: Dict[str, float], hints: tuple[str, ...]) -> float:
    score = 0.0
    for label, value in labels.items():
        low = label.lower()
        if any(h in low for h in hints) and value > score:
            score = value
    return score


def _score_toxicity(labels: Dict[str, float]) -> float:
    score = 0.0
    for label, value in labels.items():
        low = label.lower().strip()
        if any(neg in low for neg in TOXIC_NEGATIVE_LABEL_HINTS):
            continue
        if any(h in low for h in TOXIC_LABEL_HINTS) and value > score:
            score = value
    return score


def _find_blocked_terms(text: str) -> List[str]:
    t = _normalize_text_for_match(text)
    matched: List[str] = []
    for term, pattern in TERM_PATTERNS:
        if pattern.search(t):
            matched.append(term)
    return matched


def _ensure_image_bytes(data: bytes) -> Image.Image:
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="empty image")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="image too large")
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGB")
        return image
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail="invalid image") from exc


def _fetch_image(url: str) -> bytes:
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=400, detail="only http(s) image urls are allowed")

    try:
        with requests.get(url, timeout=FETCH_TIMEOUT_SEC, stream=True, headers={"User-Agent": "sdu-moderation/1.0"}) as resp:
            if resp.status_code >= 400:
                raise HTTPException(status_code=400, detail="image url is not reachable")
            content_type = (resp.headers.get("content-type") or "").lower().split(";")[0].strip()
            if content_type and not content_type.startswith("image/"):
                # Some object stores/CDNs return generic binary content-type for images
                # (e.g. application/octet-stream). In this case we still try to decode
                # bytes as an image below. But we reject obvious text/api payloads early.
                if content_type.startswith("text/") or content_type in {
                    "application/json",
                    "application/xml",
                    "application/javascript",
                    "application/x-javascript",
                }:
                    raise HTTPException(status_code=400, detail="url does not point to image")
                logger.info("non-image content-type for image url: %s, fallback to byte validation", content_type)

            buf = bytearray()
            for chunk in resp.iter_content(chunk_size=64 * 1024):
                if not chunk:
                    continue
                buf.extend(chunk)
                if len(buf) > MAX_IMAGE_BYTES:
                    raise HTTPException(status_code=400, detail="image too large")
            return bytes(buf)
    except HTTPException:
        raise
    except requests.RequestException as exc:
        raise HTTPException(status_code=400, detail="failed to fetch image") from exc


def _moderate_text(text: str) -> ModerationDecision:
    matched = _find_blocked_terms(text)
    if matched:
        return ModerationDecision(
            allowed=False,
            reason="Текст содержит запрещенные слова",
            score=1.0,
            source="keyword",
            matched_terms=matched,
            labels={},
        )

    model = _text_model()
    if model is None:
        if TEXT_MODEL_REQUIRED:
            raise HTTPException(status_code=503, detail="text moderation model unavailable")
        return ModerationDecision(allowed=True, reason="", score=0.0, source="keyword-only", matched_terms=[], labels={})

    raw = model(text[:MAX_TEXT_CHARS], truncation=True)
    labels = _labels_to_map(_flatten_labels(raw))
    toxicity = _score_toxicity(labels)
    if toxicity >= TEXT_THRESHOLD:
        return ModerationDecision(
            allowed=False,
            reason="Текст распознан как токсичный/неприемлемый",
            score=toxicity,
            source="ml",
            matched_terms=[],
            labels=labels,
        )

    return ModerationDecision(
        allowed=True,
        reason="",
        score=toxicity,
        source="ml",
        matched_terms=[],
        labels=labels,
    )


def _moderate_image_bytes(data: bytes) -> ModerationDecision:
    image = _ensure_image_bytes(data)

    nsfw_model = _image_model()
    if nsfw_model is None:
        if IMAGE_MODEL_REQUIRED:
            raise HTTPException(status_code=503, detail="image moderation model unavailable")
        return ModerationDecision(allowed=True, reason="", score=0.0, source="disabled", matched_terms=[], labels={})

    nsfw_raw = nsfw_model(image)
    nsfw_labels = _labels_to_map(_flatten_labels(nsfw_raw))
    nsfw_score = _score_by_hints(nsfw_labels, NSFW_LABEL_HINTS)
    if nsfw_score >= IMAGE_THRESHOLD:
        return ModerationDecision(
            allowed=False,
            reason="Изображение распознано как NSFW",
            score=nsfw_score,
            source="ml",
            matched_terms=[],
            labels=nsfw_labels,
        )

    suggestive_labels: Dict[str, float] = {}
    suggestive_score = 0.0
    if BLOCK_SUGGESTIVE:
        suggestive_model = _suggestive_model()
        if suggestive_model is None:
            if SUGGESTIVE_MODEL_REQUIRED:
                raise HTTPException(status_code=503, detail="suggestive moderation model unavailable")
        else:
            suggestive_raw = suggestive_model(image)
            suggestive_labels = _labels_to_map(_flatten_labels(suggestive_raw))
            suggestive_score = _score_by_hints(suggestive_labels, SUGGESTIVE_LABEL_HINTS)

    labels = _merge_labels(nsfw_labels, suggestive_labels)
    if BLOCK_SUGGESTIVE and suggestive_score >= SUGGESTIVE_THRESHOLD:
        return ModerationDecision(
            allowed=False,
            reason="Изображение слишком откровенное (купальник/сексуализированный контент)",
            score=suggestive_score,
            source="ml",
            matched_terms=[],
            labels=labels,
        )

    return ModerationDecision(
        allowed=True,
        reason="",
        score=max(nsfw_score, suggestive_score),
        source="ml",
        matched_terms=[],
        labels=labels,
    )


@app.get("/healthz")
def healthz() -> Dict[str, Any]:
    text_loaded = _text_model() is not None
    image_loaded = _image_model() is not None
    suggestive_loaded = _suggestive_model() is not None if BLOCK_SUGGESTIVE else False

    degraded = (TEXT_MODEL_REQUIRED and not text_loaded) or (IMAGE_MODEL_REQUIRED and not image_loaded)
    if BLOCK_SUGGESTIVE and SUGGESTIVE_MODEL_REQUIRED and not suggestive_loaded:
        degraded = True
    return {
        "status": "degraded" if degraded else "ok",
        "text_model": {"name": TEXT_MODEL_NAME, "loaded": text_loaded, "required": TEXT_MODEL_REQUIRED},
        "image_model": {"name": IMAGE_MODEL_NAME, "loaded": image_loaded, "required": IMAGE_MODEL_REQUIRED},
        "suggestive_model": {
            "name": SUGGESTIVE_MODEL_NAME,
            "loaded": suggestive_loaded,
            "required": SUGGESTIVE_MODEL_REQUIRED and BLOCK_SUGGESTIVE,
            "enabled": BLOCK_SUGGESTIVE,
        },
        "thresholds": {
            "text": TEXT_THRESHOLD,
            "image": IMAGE_THRESHOLD,
            "suggestive": SUGGESTIVE_THRESHOLD,
            "block_suggestive": BLOCK_SUGGESTIVE,
        },
    }


@app.post("/moderate/text", response_model=ModerationDecision)
def moderate_text(req: TextModerationRequest) -> ModerationDecision:
    return _moderate_text(req.text)


@app.post("/moderate/image/url", response_model=ModerationDecision)
def moderate_image_url(req: ImageURLModerationRequest) -> ModerationDecision:
    data = _fetch_image(req.url)
    return _moderate_image_bytes(data)


@app.post("/moderate/image/file", response_model=ModerationDecision)
def moderate_image_file(file: UploadFile = File(...), context: str = Form(default="generic")) -> ModerationDecision:
    _ = context
    data = file.file.read(MAX_IMAGE_BYTES + 1)
    return _moderate_image_bytes(data)
