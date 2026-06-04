#!/usr/bin/env python3
"""
Local Whisper MLX transcription adapter for videocut.

It writes a Volcengine-compatible JSON file so the existing
generate_subtitles.js script can keep working unchanged.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import mlx_whisper


DEFAULT_MODEL = "mlx-community/whisper-small-mlx"
PUNCT_RE = re.compile(r"^[\s\.,!?;:'\"，。！？；：“”‘’、（）()\[\]【】《》<>-]+$")


def split_text_units(text: str) -> list[str]:
    """Split a Whisper word into rough-cut-friendly Chinese chars and Latin runs."""
    units: list[str] = []
    current = ""

    def flush_current() -> None:
        nonlocal current
        if current:
            units.append(current)
            current = ""

    for char in text.strip():
        if char.isascii() and (char.isalnum() or (char in ".+-_/%" and current)):
            current += char
        elif char.isspace() or PUNCT_RE.match(char):
            flush_current()
        elif "\u4e00" <= char <= "\u9fff":
            flush_current()
            units.append(char)
        else:
            flush_current()
            units.append(char)

    flush_current()
    return [unit for unit in units if unit and not PUNCT_RE.match(unit)]


def distribute_word(word: dict) -> list[dict]:
    text = word.get("word") or word.get("text") or ""
    units = split_text_units(text)
    if not units:
        return []

    start = float(word.get("start", 0.0))
    end = float(word.get("end", start))
    duration = max(0.01, end - start)
    step = duration / len(units)
    probability = word.get("probability")

    output = []
    for index, unit in enumerate(units):
        unit_start = start + step * index
        unit_end = end if index == len(units) - 1 else start + step * (index + 1)
        item = {
            "text": unit,
            "start_time": round(unit_start * 1000),
            "end_time": round(unit_end * 1000),
        }
        if probability is not None:
            item["confidence"] = float(probability)
        output.append(item)
    return output


def load_prompt(skill_root: Path) -> str | None:
    dict_file = skill_root / "字幕" / "词典.txt"
    if not dict_file.exists():
        return None

    words = [
        line.strip()
        for line in dict_file.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    if not words:
        return None
    return "以下专有名词可能出现在口播中：" + "、".join(words[:200])


def convert_result(raw: dict, model: str) -> dict:
    utterances = []
    for segment_index, segment in enumerate(raw.get("segments", [])):
        words = []
        for word in segment.get("words", []):
            words.extend(distribute_word(word))

        if not words:
            text = segment.get("text", "")
            words = [
                {
                    "text": unit,
                    "start_time": round(float(segment.get("start", 0.0)) * 1000),
                    "end_time": round(float(segment.get("end", 0.0)) * 1000),
                }
                for unit in split_text_units(text)
            ]

        raw_text = (segment.get("text") or "").strip()
        utterances.append(
            {
                "text": "".join(word["text"] for word in words),
                "raw_text": raw_text,
                "display_text": raw_text,
                "segment_id": segment_index,
                "start_time": round(float(segment.get("start", 0.0)) * 1000),
                "end_time": round(float(segment.get("end", 0.0)) * 1000),
                "words": words,
            }
        )

    return {
        "source": "mlx_whisper",
        "model": model,
        "language": raw.get("language", "zh"),
        "text": raw.get("text", ""),
        "utterances": utterances,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe locally with Whisper MLX.")
    parser.add_argument("audio", help="Audio or video file path")
    parser.add_argument(
        "-o",
        "--output",
        default="volcengine_result.json",
        help="Output JSON path, default: volcengine_result.json",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"MLX Whisper model or local path, default: {DEFAULT_MODEL}",
    )
    parser.add_argument("--language", default="zh", help="Whisper language code, default: zh")
    parser.add_argument("--no-prompt", action="store_true", help="Do not load 字幕/词典.txt as prompt")
    parser.add_argument("--prompt-file", help="Optional reference script or glossary file for Whisper initial_prompt")
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    skill_root = script_dir.parent.parent
    prompt = None if args.no_prompt else load_prompt(skill_root)
    if args.prompt_file:
        prompt_path = Path(args.prompt_file)
        prompt_text = prompt_path.read_text(encoding="utf-8").strip()
        prompt = "\n".join(part for part in [prompt, prompt_text[:3000]] if part)

    raw = mlx_whisper.transcribe(
        args.audio,
        path_or_hf_repo=args.model,
        language=args.language,
        word_timestamps=True,
        initial_prompt=prompt,
        verbose=False,
    )

    converted = convert_result(raw, args.model)
    output = Path(args.output)
    output.write_text(json.dumps(converted, ensure_ascii=False, indent=2), encoding="utf-8")
    word_count = sum(len(utterance["words"]) for utterance in converted["utterances"])
    print(f"✅ 本地转录完成: {output}")
    print(f"📝 段落: {len(converted['utterances'])}, 字/词单元: {word_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
