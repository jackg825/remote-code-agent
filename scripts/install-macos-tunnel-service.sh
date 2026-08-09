#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]] || ! command -v launchctl >/dev/null; then
  echo "This installer requires macOS with launchd." >&2
  exit 1
fi

for command_name in node npm; do
  if ! command -v "$command_name" >/dev/null; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done

app_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
node_binary="$(command -v node)"
tunnel_name="${TUNNEL_NAME:-}"
service_label="io.remote-code-agent.tunnel"
launch_agent_directory="${HOME}/Library/LaunchAgents"
service_file="${launch_agent_directory}/${service_label}.plist"
log_directory="${HOME}/Library/Logs"
launch_domain="gui/$(id -u)"

if [[ -z "$tunnel_name" ]]; then
  echo "TUNNEL_NAME is required." >&2
  exit 1
fi

if [[ ! "$tunnel_name" =~ ^[A-Za-z0-9_.-]+$ ]]; then
  echo "TUNNEL_NAME contains unsupported characters." >&2
  exit 1
fi

cd "$app_directory"
npm ci
wrangler_script="${app_directory}/node_modules/wrangler/bin/wrangler.js"
"$node_binary" "$wrangler_script" tunnel info "$tunnel_name" >/dev/null
mkdir -p "$launch_agent_directory" "$log_directory"

"$node_binary" --input-type=module -e '
  import { writeFileSync } from "node:fs";

  const [
    serviceFile,
    label,
    nodeBinary,
    wranglerScript,
    tunnelName,
    appDirectory,
    homeDirectory,
    pathValue,
    stdoutPath,
    stderrPath,
  ] = process.argv.slice(1);

  writeFileSync(
    serviceFile,
    JSON.stringify({
      Label: label,
      ProgramArguments: [
        nodeBinary,
        wranglerScript,
        "tunnel",
        "run",
        tunnelName,
        "--log-level",
        "info",
      ],
      WorkingDirectory: appDirectory,
      EnvironmentVariables: {
        HOME: homeDirectory,
        PATH: pathValue,
      },
      RunAtLoad: true,
      KeepAlive: true,
      ThrottleInterval: 10,
      ProcessType: "Background",
      StandardOutPath: stdoutPath,
      StandardErrorPath: stderrPath,
    }),
    { mode: 0o600 },
  );
' \
  "$service_file" \
  "$service_label" \
  "$node_binary" \
  "$wrangler_script" \
  "$tunnel_name" \
  "$app_directory" \
  "$HOME" \
  "$PATH" \
  "${log_directory}/remote-code-agent-tunnel.log" \
  "${log_directory}/remote-code-agent-tunnel.error.log"

plutil -convert xml1 "$service_file"
plutil -lint "$service_file"
launchctl bootout "${launch_domain}/${service_label}" 2>/dev/null || true
launchctl bootstrap "$launch_domain" "$service_file"
launchctl enable "${launch_domain}/${service_label}"
launchctl kickstart -k "${launch_domain}/${service_label}"

echo "Installed ${service_file}"
echo "Check it with: launchctl print ${launch_domain}/${service_label}"
echo "Tunnel status: ${node_binary} ${wrangler_script} tunnel info ${tunnel_name}"
