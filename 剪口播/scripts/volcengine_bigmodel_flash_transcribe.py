#!/usr/bin/env python3
"""
Volcengine bigmodel ASR flash transcription.

Usage:
  python volcengine_bigmodel_flash_transcribe.py audio.mp3 -o volcengine_result.json

The output is normalized to the legacy `volcengine_result.json` shape consumed by
generate_subtitles.js: {"utterances": [...]}.
"""

import argparse
import base64
import json
import os
import sys
import urllib.request
import uuid
from pathlib import Path


API_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash"
RESOURCE_ID = "volc.bigasr.auc_turbo"


def load_env() -> dict:
    script_dir = Path(__file__).resolve().parent
    env_file = script_dir.parents[1] / ".env"
    values = {}
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    values.update({k: v for k, v in os.environ.items() if k.startswith("VOLCENGINE_")})
    return values


def normalize_result(data: dict) -> dict:
    result = data.get("result") or {}
    output = {"utterances": []}
    for utterance_index, utterance in enumerate(result.get("utterances") or []):
        words = []
        for word in utterance.get("words") or []:
            text = str(word.get("text") or "")
            start = int(word.get("start_time", -1) or -1)
            end = int(word.get("end_time", -1) or -1)
            if not text.strip() or start < 0 or end <= start:
                continue
            words.append({
                "text": text,
                "start_time": start,
                "end_time": end,
                "confidence": word.get("confidence", 0),
            })
        if not words:
            continue
        text = utterance.get("text", "")
        output["utterances"].append({
            "segment_id": utterance_index,
            "text": text,
            "raw_text": text,
            "display_text": text,
            "start_time": min(word["start_time"] for word in words),
            "end_time": max(word["end_time"] for word in words),
            "words": words,
        })
    return output


def post_json(url: str, headers: dict, body: dict) -> tuple[dict, dict]:
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=payload, method="POST")
    for key, value in headers.items():
        request.add_header(key, value)
    request.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(request, timeout=180) as response:
        response_body = response.read().decode("utf-8")
        return dict(response.headers), json.loads(response_body or "{}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", help="Audio file path, mp3/wav/ogg opus")
    parser.add_argument("-o", "--output", default="volcengine_result.json")
    args = parser.parse_args()

    audio_path = Path(args.audio)
    if not audio_path.exists():
        print(f"❌ 找不到音频文件: {audio_path}", file=sys.stderr)
        return 1

    env = load_env()
    appid = env.get("VOLCENGINE_APPID", "")
    token = env.get("VOLCENGINE_ACCESS_TOKEN", "")
    api_key = env.get("VOLCENGINE_API_KEY", "")

    headers = {
        "X-Api-Resource-Id": RESOURCE_ID,
        "X-Api-Request-Id": str(uuid.uuid4()),
        "X-Api-Sequence": "-1",
    }
    if api_key and api_key not in {"your_api_key_here", "your_access_token_here"}:
        headers["X-Api-Key"] = api_key
        uid = api_key
        print("🔑 使用新版 X-Api-Key 鉴权")
    else:
        if not appid or appid == "your_appid_here" or not token or token == "your_access_token_here":
            print("❌ 缺少 VOLCENGINE_APPID / VOLCENGINE_ACCESS_TOKEN", file=sys.stderr)
            return 1
        headers["X-Api-App-Key"] = appid
        headers["X-Api-Access-Key"] = token
        uid = appid
        print("🔑 使用旧版 AppID + Access Token 鉴权")

    print("🎤 提交火山引擎大模型识别极速版...")
    body = {
        "user": {"uid": uid},
        "audio": {"data": base64.b64encode(audio_path.read_bytes()).decode("ascii")},
        "request": {
            "model_name": "bigmodel",
            "enable_itn": True,
            "enable_punc": True,
        },
    }
    headers_response, data = post_json(API_URL, headers, body)
    status = headers_response.get("X-Api-Status-Code", "")
    message = headers_response.get("X-Api-Message", "")
    if status != "20000000":
        print(f"❌ 火山识别失败: {status} {message}", file=sys.stderr)
        print(json.dumps(data, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1

    normalized = normalize_result(data)
    Path(args.output).write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    words_count = sum(len(utterance.get("words") or []) for utterance in normalized["utterances"])
    print(f"✅ 火山转录完成: {args.output}")
    print(f"📝 段落: {len(normalized['utterances'])}, 字/词单元: {words_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
