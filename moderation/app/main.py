import io
import logging
import os
import re
import threading
import time
import unicodedata
from functools import lru_cache
from typing import Any, Dict, List
from urllib.parse import urlsplit, urlunsplit

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
INFER_MAX_SIDE = int(os.getenv("MODERATION_INFER_MAX_SIDE", "1024"))
TEXT_THRESHOLD = float(os.getenv("MODERATION_TEXT_THRESHOLD", "0.75"))
IMAGE_THRESHOLD = float(os.getenv("MODERATION_IMAGE_THRESHOLD", "0.70"))
SUGGESTIVE_THRESHOLD = float(os.getenv("MODERATION_SUGGESTIVE_THRESHOLD", "0.45"))
SUGGESTIVE_GATE_THRESHOLD = float(os.getenv("MODERATION_SUGGESTIVE_GATE_THRESHOLD", "0.20"))
SUGGESTIVE_STRONG_THRESHOLD = float(os.getenv("MODERATION_SUGGESTIVE_STRONG_THRESHOLD", "0.80"))
BLOCK_SUGGESTIVE = os.getenv("MODERATION_BLOCK_SUGGESTIVE", "true").lower() in {"1", "true", "yes", "on"}
PRELOAD_MODELS = os.getenv("MODERATION_PRELOAD_MODELS", "true").lower() in {"1", "true", "yes", "on"}
SUGGESTIVE_BG_WARMUP = os.getenv("MODERATION_SUGGESTIVE_BG_WARMUP", "true").lower() in {"1", "true", "yes", "on"}

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
SUGGESTIVE_STRONG_LABEL_HINTS = (
    "porn",
    "pornography",
    "hentai",
    "nude",
    "nudity",
    "explicit",
    "sexual",
    "sex",
    "nsfw",
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
_suggestive_warmup_lock = threading.Lock()
_suggestive_warmup_started = False


def _duration_ms(started_at: float) -> float:
    return round((time.perf_counter() - started_at) * 1000, 1)


def _safe_url_for_log(raw_url: str) -> str:
    try:
        p = urlsplit(raw_url)
        # Strip query/fragment because presigned URLs may contain secrets.
        return urlunsplit((p.scheme, p.netloc, p.path, "", ""))
    except Exception:
        return "invalid_url"


def _resize_for_inference(image: Image.Image) -> tuple[Image.Image, tuple[int, int], tuple[int, int], bool]:
    original_size = image.size
    if INFER_MAX_SIDE <= 0:
        return image, original_size, image.size, False
    max_side = max(image.size)
    if max_side <= INFER_MAX_SIDE:
        return image, original_size, image.size, False

    ratio = INFER_MAX_SIDE / float(max_side)
    new_w = max(1, int(round(image.size[0] * ratio)))
    new_h = max(1, int(round(image.size[1] * ratio)))
    resampling = getattr(Image, "Resampling", Image).LANCZOS
    resized = image.resize((new_w, new_h), resample=resampling)
    return resized, original_size, resized.size, True


@lru_cache(maxsize=1)
def _text_model() -> Any:
    started_at = time.perf_counter()
    try:
        logger.info("loading text moderation model: %s", TEXT_MODEL_NAME)
        model = pipeline("text-classification", model=TEXT_MODEL_NAME, tokenizer=TEXT_MODEL_NAME, top_k=None)
        logger.info("text moderation model loaded in %.1fms", _duration_ms(started_at))
        return model
    except Exception as exc:
        logger.exception("text model load failed: %s", exc)
        return None


@lru_cache(maxsize=1)
def _image_model() -> Any:
    started_at = time.perf_counter()
    try:
        logger.info("loading image moderation model: %s", IMAGE_MODEL_NAME)
        model = pipeline("image-classification", model=IMAGE_MODEL_NAME, top_k=None)
        logger.info("image moderation model loaded in %.1fms", _duration_ms(started_at))
        return model
    except Exception as exc:
        logger.exception("image model load failed: %s", exc)
        return None


@lru_cache(maxsize=1)
def _suggestive_model() -> Any:
    started_at = time.perf_counter()
    try:
        logger.info("loading suggestive image model: %s", SUGGESTIVE_MODEL_NAME)
        model = pipeline("image-classification", model=SUGGESTIVE_MODEL_NAME, top_k=None)
        logger.info("suggestive image model loaded in %.1fms", _duration_ms(started_at))
        return model
    except Exception as exc:
        logger.exception("suggestive model load failed: %s", exc)
        return None


def _suggestive_model_if_ready() -> Any:
    # Do not trigger a heavy model load from request path if suggestive model is optional.
    if _suggestive_model.cache_info().currsize == 0:
        return None
    return _suggestive_model()


def _start_suggestive_warmup_background() -> None:
    if not BLOCK_SUGGESTIVE or SUGGESTIVE_MODEL_REQUIRED or not SUGGESTIVE_BG_WARMUP:
        return

    global _suggestive_warmup_started
    with _suggestive_warmup_lock:
        if _suggestive_warmup_started:
            return
        _suggestive_warmup_started = True

    def _run() -> None:
        started_at = time.perf_counter()
        loaded = _suggestive_model() is not None
        logger.info(
            "background suggestive warmup done loaded=%s ms=%.1f",
            loaded,
            _duration_ms(started_at),
        )

    t = threading.Thread(target=_run, name="suggestive-warmup", daemon=True)
    t.start()


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
    started_at = time.perf_counter()
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
            raw = bytes(buf)
            logger.info(
                "image fetch done url=%s bytes=%d ms=%.1f",
                _safe_url_for_log(url),
                len(raw),
                _duration_ms(started_at),
            )
            return raw
    except HTTPException:
        raise
    except requests.RequestException as exc:
        raise HTTPException(status_code=400, detail="failed to fetch image") from exc


def _moderate_text(text: str) -> ModerationDecision:
    started_at = time.perf_counter()
    matched = _find_blocked_terms(text)
    if matched:
        logger.info("text moderation blocked by keywords ms=%.1f matched_terms=%d", _duration_ms(started_at), len(matched))
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
        logger.info("text moderation skipped (model unavailable, fail-open) ms=%.1f", _duration_ms(started_at))
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

    decision = ModerationDecision(
        allowed=True,
        reason="",
        score=toxicity,
        source="ml",
        matched_terms=[],
        labels=labels,
    )
    logger.info(
        "text moderation done allowed=%s score=%.4f labels=%d ms=%.1f",
        decision.allowed,
        decision.score,
        len(decision.labels),
        _duration_ms(started_at),
    )
    return decision


def _moderate_image_bytes(data: bytes) -> ModerationDecision:
    total_started_at = time.perf_counter()
    decode_started_at = time.perf_counter()
    image = _ensure_image_bytes(data)
    decode_ms = _duration_ms(decode_started_at)

    resize_started_at = time.perf_counter()
    infer_image, original_size, infer_size, resized_for_infer = _resize_for_inference(image)
    resize_ms = _duration_ms(resize_started_at)
    if resized_for_infer:
        logger.info(
            "image resized for inference from=%dx%d to=%dx%d ms=%.1f",
            original_size[0],
            original_size[1],
            infer_size[0],
            infer_size[1],
            resize_ms,
        )

    nsfw_model = _image_model()
    if nsfw_model is None:
        if IMAGE_MODEL_REQUIRED:
            raise HTTPException(status_code=503, detail="image moderation model unavailable")
        return ModerationDecision(allowed=True, reason="", score=0.0, source="disabled", matched_terms=[], labels={})

    nsfw_started_at = time.perf_counter()
    nsfw_raw = nsfw_model(infer_image)
    nsfw_ms = _duration_ms(nsfw_started_at)
    nsfw_labels = _labels_to_map(_flatten_labels(nsfw_raw))
    nsfw_score = _score_by_hints(nsfw_labels, NSFW_LABEL_HINTS)
    if nsfw_score >= IMAGE_THRESHOLD:
        logger.info(
            "image moderation blocked nsfw_score=%.4f bytes=%d decode_ms=%.1f resize_ms=%.1f nsfw_ms=%.1f total_ms=%.1f",
            nsfw_score,
            len(data),
            decode_ms,
            resize_ms,
            nsfw_ms,
            _duration_ms(total_started_at),
        )
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
    suggestive_strong_score = 0.0
    suggestive_ms = 0.0
    if BLOCK_SUGGESTIVE:
        suggestive_model = _suggestive_model() if SUGGESTIVE_MODEL_REQUIRED else _suggestive_model_if_ready()
        if suggestive_model is None:
            if SUGGESTIVE_MODEL_REQUIRED:
                raise HTTPException(status_code=503, detail="suggestive moderation model unavailable")
            logger.info("suggestive model not ready, skipping optional suggestive check")
            _start_suggestive_warmup_background()
        else:
            suggestive_started_at = time.perf_counter()
            suggestive_raw = suggestive_model(infer_image)
            suggestive_ms = _duration_ms(suggestive_started_at)
            suggestive_labels = _labels_to_map(_flatten_labels(suggestive_raw))
            suggestive_score = _score_by_hints(suggestive_labels, SUGGESTIVE_LABEL_HINTS)
            suggestive_strong_score = _score_by_hints(suggestive_labels, SUGGESTIVE_STRONG_LABEL_HINTS)

    labels = _merge_labels(nsfw_labels, suggestive_labels)
    should_block_suggestive = BLOCK_SUGGESTIVE and (
        suggestive_score >= SUGGESTIVE_STRONG_THRESHOLD
        or (suggestive_score >= SUGGESTIVE_THRESHOLD and suggestive_strong_score >= SUGGESTIVE_GATE_THRESHOLD)
    )
    if should_block_suggestive:
        logger.info(
            "image moderation blocked suggestive_score=%.4f strong_score=%.4f gate=%.2f strong=%.2f bytes=%d decode_ms=%.1f resize_ms=%.1f nsfw_ms=%.1f suggestive_ms=%.1f total_ms=%.1f",
            suggestive_score,
            suggestive_strong_score,
            SUGGESTIVE_GATE_THRESHOLD,
            SUGGESTIVE_STRONG_THRESHOLD,
            len(data),
            decode_ms,
            resize_ms,
            nsfw_ms,
            suggestive_ms,
            _duration_ms(total_started_at),
        )
        return ModerationDecision(
            allowed=False,
            reason="Изображение слишком откровенное (купальник/сексуализированный контент)",
            score=suggestive_score,
            source="ml",
            matched_terms=[],
            labels=labels,
        )

    decision = ModerationDecision(
        allowed=True,
        reason="",
        score=max(nsfw_score, suggestive_score),
        source="ml",
        matched_terms=[],
        labels=labels,
    )
    logger.info(
        "image moderation done allowed=%s score=%.4f bytes=%d from=%dx%d infer=%dx%d resized=%s decode_ms=%.1f resize_ms=%.1f nsfw_ms=%.1f suggestive_ms=%.1f total_ms=%.1f",
        decision.allowed,
        decision.score,
        len(data),
        original_size[0],
        original_size[1],
        infer_size[0],
        infer_size[1],
        str(resized_for_infer).lower(),
        decode_ms,
        resize_ms,
        nsfw_ms,
        suggestive_ms,
        _duration_ms(total_started_at),
    )
    return decision


@app.get("/healthz")
def healthz() -> Dict[str, Any]:
    text_loaded = _text_model() is not None
    image_loaded = _image_model() is not None
    suggestive_loaded = False
    if BLOCK_SUGGESTIVE:
        if SUGGESTIVE_MODEL_REQUIRED:
            suggestive_loaded = _suggestive_model() is not None
        else:
            suggestive_loaded = _suggestive_model_if_ready() is not None

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
            "suggestive_gate": SUGGESTIVE_GATE_THRESHOLD,
            "suggestive_strong": SUGGESTIVE_STRONG_THRESHOLD,
            "block_suggestive": BLOCK_SUGGESTIVE,
        },
    }


@app.get("/livez")
def livez() -> Dict[str, str]:
    # Lightweight liveness probe: do not trigger model loading/downloading.
    return {"status": "ok"}


@app.on_event("startup")
def preload_models_on_startup() -> None:
    if not PRELOAD_MODELS:
        logger.info("startup preload is disabled")
        return
    started_at = time.perf_counter()
    text_loaded = _text_model() is not None
    image_loaded = _image_model() is not None
    suggestive_loaded = True
    suggestive_preload_skipped = BLOCK_SUGGESTIVE and not SUGGESTIVE_MODEL_REQUIRED
    if BLOCK_SUGGESTIVE and SUGGESTIVE_MODEL_REQUIRED:
        suggestive_loaded = _suggestive_model() is not None
    elif suggestive_preload_skipped:
        _start_suggestive_warmup_background()
    logger.info(
        "startup preload done text_loaded=%s image_loaded=%s suggestive_loaded=%s suggestive_preload_skipped=%s total_ms=%.1f",
        text_loaded,
        image_loaded,
        suggestive_loaded,
        suggestive_preload_skipped,
        _duration_ms(started_at),
    )


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
