#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]] || ! command -v systemctl >/dev/null; then
  echo "This installer requires Linux with systemd." >&2
  exit 1
fi

for command_name in node npm tmux; do
  if ! command -v "$command_name" >/dev/null; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done

app_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
node_binary="$(command -v node)"
tmux_binary="$(command -v tmux)"
service_directory="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
service_file="${service_directory}/remote-code-agent.service"
service_port="${PORT:-7681}"
workspace_directory="${WORKSPACE_DIR:-${HOME}}"
upload_directory="${UPLOAD_DIR:-${workspace_directory}/.remote-code-agent/uploads}"
max_upload_bytes="${MAX_UPLOAD_BYTES:-20971520}"
public_hostname="${PUBLIC_HOSTNAME:-}"
service_path="${PATH}"

if [[ -z "$public_hostname" ]]; then
  echo "PUBLIC_HOSTNAME is required (for example: code.example.com)." >&2
  exit 1
fi

if [[ "$app_directory" == *$'\n'* || "$workspace_directory" == *$'\n'* || "$upload_directory" == *$'\n'* || "$service_path" == *$'\n'* ]]; then
  echo "Paths containing newlines are not supported." >&2
  exit 1
fi

if [[ ! "$service_port" =~ ^[0-9]+$ ]] || ((service_port < 1 || service_port > 65535)); then
  echo "PORT must be an integer between 1 and 65535." >&2
  exit 1
fi

if [[ ! "$max_upload_bytes" =~ ^[0-9]+$ ]] || ((max_upload_bytes < 1 || max_upload_bytes > 104857600)); then
  echo "MAX_UPLOAD_BYTES must be an integer between 1 and 104857600." >&2
  exit 1
fi

if [[ ! "$public_hostname" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "PUBLIC_HOSTNAME must be a hostname without a scheme or path." >&2
  exit 1
fi

cd "$app_directory"
npm ci
npm run build:server
mkdir -p "$service_directory"

{
  echo "[Unit]"
  echo "Description=Remote Code Agent"
  echo "After=network-online.target"
  echo "Wants=network-online.target"
  echo
  echo "[Service]"
  echo "Type=simple"
  printf 'WorkingDirectory=%s\n' "$app_directory"
  printf 'Environment=NODE_ENV=production\n'
  printf 'Environment=PORT=%s\n' "$service_port"
  printf 'Environment=WORKSPACE_DIR=%s\n' "$workspace_directory"
  printf 'Environment=UPLOAD_DIR=%s\n' "$upload_directory"
  printf 'Environment=MAX_UPLOAD_BYTES=%s\n' "$max_upload_bytes"
  printf 'Environment=TMUX_BIN=%s\n' "$tmux_binary"
  printf 'Environment=TMUX_SOCKET=remote-code-agent\n'
  printf 'Environment=PUBLIC_HOSTNAME=%s\n' "$public_hostname"
  escaped_service_path="${service_path//\\/\\\\}"
  escaped_service_path="${escaped_service_path//\"/\\\"}"
  escaped_service_path="${escaped_service_path//%/%%}"
  printf 'Environment="PATH=%s"\n' "$escaped_service_path"
  printf 'ExecStart=%s %s/dist/server.js\n' "$node_binary" "$app_directory"
  echo "Restart=on-failure"
  echo "RestartSec=3"
  echo "KillSignal=SIGTERM"
  echo
  echo "[Install]"
  echo "WantedBy=default.target"
} >"$service_file"

systemctl --user daemon-reload
systemctl --user enable --now remote-code-agent.service

echo "Installed ${service_file}"
echo "Check it with: systemctl --user status remote-code-agent"
echo "Keep it running after logout with: sudo loginctl enable-linger ${USER}"
