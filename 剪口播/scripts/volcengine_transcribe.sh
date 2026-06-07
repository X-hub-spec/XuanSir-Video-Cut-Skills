#!/bin/bash
#
# 火山引擎语音识别（异步模式）
#
# 用法: ./volcengine_transcribe.sh <audio_url>
# 输出: volcengine_result.json
#

AUDIO_URL="$1"

if [ -z "$AUDIO_URL" ]; then
  echo "❌ 用法: ./volcengine_transcribe.sh <audio_url>"
  exit 1
fi

# 获取 Access Token / AppID
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$(dirname "$(dirname "$SCRIPT_DIR")")/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ 找不到 $ENV_FILE"
  echo "请创建: cp .env.example .env 并填入 VOLCENGINE_ACCESS_TOKEN 和 VOLCENGINE_APPID"
  exit 1
fi

ACCESS_TOKEN=$(grep '^VOLCENGINE_ACCESS_TOKEN=' "$ENV_FILE" | cut -d'=' -f2-)
if [ -z "$ACCESS_TOKEN" ]; then
  ACCESS_TOKEN=$(grep '^VOLCENGINE_API_KEY=' "$ENV_FILE" | cut -d'=' -f2-)
fi
APPID=$(grep '^VOLCENGINE_APPID=' "$ENV_FILE" | cut -d'=' -f2-)

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" = "your_api_key_here" ] || [ "$ACCESS_TOKEN" = "your_access_token_here" ]; then
  echo "❌ 缺少 VOLCENGINE_ACCESS_TOKEN"
  exit 1
fi

echo "🎤 提交火山引擎转录任务..."
echo "音频 URL: $AUDIO_URL"
if [ -n "$APPID" ] && [ "$APPID" != "your_appid_here" ]; then
  echo "🔑 使用 AppID + Bearer 鉴权"
else
  echo "🔑 使用 x-api-key 鉴权"
fi

# 读取热词词典
DICT_FILE="$(dirname "$(dirname "$SCRIPT_DIR")")/字幕/词典.txt"
HOT_WORDS=""
if [ -f "$DICT_FILE" ] && [ "${VOLCENGINE_ENABLE_HOT_WORDS:-0}" = "1" ]; then
  # 把词典转换成 JSON 数组格式
  HOT_WORDS=$(cat "$DICT_FILE" | grep -v '^$' | while read word; do echo "\"$word\""; done | tr '\n' ',' | sed 's/,$//')
  echo "📖 加载热词: $(cat "$DICT_FILE" | grep -v '^$' | wc -l | tr -d ' ') 个"
elif [ -f "$DICT_FILE" ]; then
  echo "📖 检测到热词词典，但默认不提交热词，避免接口版本不兼容；如需启用，设置 VOLCENGINE_ENABLE_HOT_WORDS=1"
fi

# 构建请求体
if [ -n "$HOT_WORDS" ]; then
  REQUEST_BODY="{\"url\": \"$AUDIO_URL\", \"hot_words\": [$HOT_WORDS]}"
else
  REQUEST_BODY="{\"url\": \"$AUDIO_URL\"}"
fi

# 步骤1: 提交任务
SUBMIT_URL="https://openspeech.bytedance.com/api/v1/vc/submit?language=zh-CN&use_itn=True&use_capitalize=True&caption_type=speech&max_lines=1&words_per_line=15"
if [ -n "$APPID" ] && [ "$APPID" != "your_appid_here" ]; then
  SUBMIT_URL="${SUBMIT_URL}&appid=${APPID}"
  SUBMIT_RESPONSE=$(curl -s -L -X POST "$SUBMIT_URL" \
    -H "Accept: */*" \
    -H "Authorization: Bearer; $ACCESS_TOKEN" \
    -H "Connection: keep-alive" \
    -H "content-type: application/json" \
    -d "$REQUEST_BODY")
else
  SUBMIT_RESPONSE=$(curl -s -L -X POST "$SUBMIT_URL" \
    -H "Accept: */*" \
    -H "x-api-key: $ACCESS_TOKEN" \
    -H "Connection: keep-alive" \
    -H "content-type: application/json" \
    -d "$REQUEST_BODY")
fi

# 提取任务 ID
TASK_ID=$(echo "$SUBMIT_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$TASK_ID" ]; then
  echo "❌ 提交失败，响应:"
  echo "$SUBMIT_RESPONSE"
  exit 1
fi

echo "✅ 任务已提交，ID: $TASK_ID"
echo "⏳ 等待转录完成..."

# 步骤2: 轮询结果
MAX_ATTEMPTS=120  # 最多等待 10 分钟（每 5 秒查一次）
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  sleep 5
  ATTEMPT=$((ATTEMPT + 1))

  QUERY_URL="https://openspeech.bytedance.com/api/v1/vc/query?id=$TASK_ID"
  if [ -n "$APPID" ] && [ "$APPID" != "your_appid_here" ]; then
    QUERY_URL="${QUERY_URL}&appid=${APPID}"
    QUERY_RESPONSE=$(curl -s -L -X GET "$QUERY_URL" \
      -H "Accept: */*" \
      -H "Authorization: Bearer; $ACCESS_TOKEN" \
      -H "Connection: keep-alive")
  else
    QUERY_RESPONSE=$(curl -s -L -X GET "$QUERY_URL" \
      -H "Accept: */*" \
      -H "x-api-key: $ACCESS_TOKEN" \
      -H "Connection: keep-alive")
  fi

  # 检查状态
  STATUS=$(echo "$QUERY_RESPONSE" | grep -o '"code":[0-9]*' | head -1 | cut -d':' -f2)

  if [ "$STATUS" = "0" ]; then
    # 成功完成
    echo "$QUERY_RESPONSE" > volcengine_result.json
    echo "✅ 转录完成，已保存 volcengine_result.json"

    # 显示统计
    UTTERANCES=$(echo "$QUERY_RESPONSE" | grep -o '"text"' | wc -l)
    echo "📝 识别到 $UTTERANCES 段语音"
    exit 0
  elif [ "$STATUS" = "1000" ]; then
    # 处理中
    echo -n "."
  else
    # 其他错误
    echo ""
    echo "❌ 转录失败，响应:"
    echo "$QUERY_RESPONSE"
    exit 1
  fi
done

echo ""
echo "❌ 超时，任务未完成"
exit 1
