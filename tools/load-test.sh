#!/usr/bin/env bash
# Load-test the local bulk endpoint by uploading a CSV directly and polling
# the job until it completes. Prints timing metrics suitable for a smoke test.
#
# Usage:
#   ./tools/load-test.sh <csv_file> [config_file]
#
# config_file is a shell script that exports:
#   ACCOUNT_SID, AUTH_TOKEN, CHANNEL, SENDER_TYPE, FROM_ADDRESS or MG_SID,
#   MESSAGE, MEDIA_URL (optional)
#
# If config_file is omitted, defaults below kick in.

set -euo pipefail

CSV_FILE="${1:-/tmp/load-1k.csv}"
CONFIG_FILE="${2:-}"

if [ -n "$CONFIG_FILE" ] && [ -f "$CONFIG_FILE" ]; then
  source "$CONFIG_FILE"
fi

# --- Defaults (override via config file) -----------------------------------
ACCOUNT_SID="${ACCOUNT_SID:-ACtest_replace_me}"
AUTH_TOKEN="${AUTH_TOKEN:-test_auth_token_replace_me}"
CHANNEL="${CHANNEL:-sms}"
SENDER_TYPE="${SENDER_TYPE:-phone}"
FROM_ADDRESS="${FROM_ADDRESS:-+15005550006}"     # Twilio Magic test number
MG_SID="${MG_SID:-}"
# NOTE: avoid Liquid `{{ }}` in the default — bash parameter expansion
# matches on the first unescaped `}` and would corrupt the message.
MESSAGE="${MESSAGE-Hello from the load test}"
MEDIA_URL="${MEDIA_URL:-}"
BASE_URL="${BASE_URL:-http://localhost:3001}"
# --------------------------------------------------------------------------

if [ ! -f "$CSV_FILE" ]; then
  echo "✗ CSV file not found: $CSV_FILE"
  exit 1
fi

ROW_COUNT=$(($(wc -l < "$CSV_FILE") - 1))
echo "▶ Uploading $CSV_FILE ($ROW_COUNT rows) to $BASE_URL/api/jobs"

if [ "$SENDER_TYPE" = "messaging-service" ]; then
  SENDER_JSON="{\"channel\":\"$CHANNEL\",\"type\":\"messaging-service\",\"messagingServiceSid\":\"$MG_SID\"}"
else
  SENDER_JSON="{\"channel\":\"$CHANNEL\",\"type\":\"phone\",\"phoneNumber\":\"$FROM_ADDRESS\"}"
fi

TWILIO_JSON="{\"accountSid\":\"$ACCOUNT_SID\",\"authToken\":\"$AUTH_TOKEN\"}"

START_UPLOAD=$(date +%s)
CURL_ARGS=(-s -X POST "$BASE_URL/api/jobs"
  -F "channel=$CHANNEL"
  -F "message=$MESSAGE"
  -F "senderConfig=$SENDER_JSON"
  -F "twilioConfig=$TWILIO_JSON"
  -F "csv=@$CSV_FILE")

if [ -n "$MEDIA_URL" ]; then
  CURL_ARGS+=(-F "mediaUrl=$MEDIA_URL")
fi

RESP=$(curl "${CURL_ARGS[@]}")
END_UPLOAD=$(date +%s)

JOB_ID=$(echo "$RESP" | sed -n 's/.*"jobId":"\([^"]*\)".*/\1/p')
TOTAL=$(echo "$RESP" | sed -n 's/.*"total":\([0-9]*\).*/\1/p')
INVALID=$(echo "$RESP" | sed -n 's/.*"invalid":\([0-9]*\).*/\1/p')

if [ -z "$JOB_ID" ]; then
  echo "✗ Failed to create job. Response:"
  echo "$RESP"
  exit 1
fi

UPLOAD_TIME=$((END_UPLOAD - START_UPLOAD))
echo "  jobId=$JOB_ID  valid=$TOTAL  invalid=$INVALID  uploadTime=${UPLOAD_TIME}s"
echo ""
echo "▶ Polling /api/jobs/$JOB_ID every 2s..."

START_JOB=$(date +%s)
LAST_PROGRESS=-1
while true; do
  STATUS_JSON=$(curl -s "$BASE_URL/api/jobs/$JOB_ID")
  STATUS=$(echo "$STATUS_JSON" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')
  PROGRESS=$(echo "$STATUS_JSON" | sed -n 's/.*"progress":\([0-9]*\).*/\1/p')
  SENT=$(echo "$STATUS_JSON" | sed -n 's/.*"successful":\([0-9]*\).*/\1/p')
  FAILED=$(echo "$STATUS_JSON" | sed -n 's/.*"failed":\([0-9]*\).*/\1/p')

  if [ "$PROGRESS" != "$LAST_PROGRESS" ]; then
    NOW=$(date +%s)
    echo "  [$((NOW - START_JOB))s]  status=$STATUS progress=${PROGRESS}%  sent=$SENT failed=$FAILED"
    LAST_PROGRESS=$PROGRESS
  fi

  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    break
  fi
  sleep 2
done

END_JOB=$(date +%s)
JOB_TIME=$((END_JOB - START_JOB))

echo ""
echo "✓ Job finished in ${JOB_TIME}s (upload ${UPLOAD_TIME}s + processing $((JOB_TIME))s)"
echo "  total=$TOTAL  sent=$SENT  failed=$FAILED  status=$STATUS"
if [ "$TOTAL" -gt 0 ] && [ "$JOB_TIME" -gt 0 ]; then
  THROUGHPUT=$((TOTAL / JOB_TIME))
  echo "  throughput≈${THROUGHPUT} msg/s"
fi
