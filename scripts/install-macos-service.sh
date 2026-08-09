#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]] || ! command -v launchctl >/dev/null; then
  echo "This installer requires macOS with launchd." >&2
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
service_port="${PORT:-7681}"
workspace_directory="${WORKSPACE_DIR:-${HOME}}"
upload_directory="${UPLOAD_DIR:-${workspace_directory}/.remote-code-agent/uploads}"
max_upload_bytes="${MAX_UPLOAD_BYTES:-20971520}"
public_hostname="${PUBLIC_HOSTNAME:-}"
service_label="io.remote-code-agent.backend"
launch_agent_directory="${HOME}/Library/LaunchAgents"
service_file="${launch_agent_directory}/${service_label}.plist"
log_directory="${HOME}/Library/Logs"
launch_domain="gui/$(id -u)"

if [[ -z "$public_hostname" ]]; then
  echo "PUBLIC_HOSTNAME is required (for example: code.example.com)." >&2
  exit 1
fi

if [[ "$app_directory" == *$'\n'* || "$workspace_directory" == *$'\n'* || "$upload_directory" == *$'\n'* ]]; then
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
mkdir -p "$launch_agent_directory" "$log_directory"

"$node_binary" --input-type=module -e '
  import { writeFileSync } from "node:fs";

  const [
    serviceFile,
    label,
    nodeBinary,
    appDirectory,
    port,
    workspace,
    uploadDirectory,
    maxUploadBytes,
    tmuxBinary,
    publicHostname,
    pathValue,
    stdoutPath,
    stderrPath,
  ] = process.argv.slice(1);

  writeFileSync(
    serviceFile,
    JSON.stringify({
      Label: label,
      ProgramArguments: [nodeBinary, `${appDirectory}/dist/server.js`],
      WorkingDirectory: appDirectory,
      EnvironmentVariables: {
        NODE_ENV: "production",
        PORT: port,
        WORKSPACE_DIR: workspace,
        UPLOAD_DIR: uploadDirectory,
        MAX_UPLOAD_BYTES: maxUploadBytes,
        TMUX_BIN: tmuxBinary,
        TMUX_SOCKET: "remote-code-agent",
        PUBLIC_HOSTNAME: publicHostname,
        PATH: pathValue,
      },
      RunAtLoad: true,
      KeepAlive: true,
      StandardOutPath: stdoutPath,
      StandardErrorPath: stderrPath,
    }),
    { mode: 0o600 },
  );
' \
  "$service_file" \
  "$service_label" \
  "$node_binary" \
  "$app_directory" \
  "$service_port" \
  "$workspace_directory" \
  "$upload_directory" \
  "$max_upload_bytes" \
  "$tmux_binary" \
  "$public_hostname" \
  "$PATH" \
  "${log_directory}/remote-code-agent.log" \
  "${log_directory}/remote-code-agent.error.log"

plutil -convert xml1 "$service_file"
plutil -lint "$service_file"
launchctl bootout "${launch_domain}/${service_label}" 2>/dev/null || true
launchctl bootstrap "$launch_domain" "$service_file"
launchctl enable "${launch_domain}/${service_label}"
launchctl kickstart -k "${launch_domain}/${service_label}"

echo "Installed ${service_file}"
echo "Check it with: launchctl print ${launch_domain}/${service_label}"
echo "Health check: curl http://127.0.0.1:${service_port}/healthz"
