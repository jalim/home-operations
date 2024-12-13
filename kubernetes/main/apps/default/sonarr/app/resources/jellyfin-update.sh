#!/usr/bin/env bash
# shellcheck disable=SC2154


if [[ "${sonarr_eventtype:-}" == "Test" ]]; then
    notification=$(jq -n \
   --arg tvdbId="391042" \
   '{tvdbId: $tvdbId}'
)
else
    notification=$(jq -n \
    --arg tvdbId="${sonarr_series_imdbid:-}" \
    '{tvdbId: $tvdbId}'
    )
fi

printf "${sonarr_series_imdbid}"

JELLYFIN_API_KEY="${JELLYFIN_API_KEY:-}"

status_code=$(curl \
    --write-out "%{http_code}" \
    --silent \
    --output /dev/null \
    --header "Authorization: MediaBrowser Token=${JELLYFIN_API_KEY}" \
    --data-binary "${notification}" \
    --request POST "http://jellyfin:8096/Library/Series/Updated" \
)

if [[ "${status_code}" -ne 204 ]] ; then
    printf "%s - Unable to send notification with status code %s and payload: %s\n" "$(date)" "${status_code}" "$(echo "${notification}" | jq -c)" >&2
    exit 1
else
    printf "%s - Sent notification with status code %s and payload: %s\n" "$(date)" "${status_code}" "$(echo "${notification}" | jq -c)"
fi
