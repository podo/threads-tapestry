#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="$project_dir/dist"
connector_dir="$project_dir/local.threads.web"
output_file="$output_dir/Threads.tapestry"
temporary_file="$output_file.tmp"

mkdir -p "$output_dir"
trap 'rm -f "$temporary_file"' EXIT

node -e "JSON.parse(require('fs').readFileSync('$connector_dir/plugin-config.json')); JSON.parse(require('fs').readFileSync('$connector_dir/ui-config.json'));"
(cd "$connector_dir" && zip -X -q "$temporary_file" plugin-config.json ui-config.json plugin.js README.md DESIGN.md)
unzip -t "$temporary_file"
mv "$temporary_file" "$output_file"
echo "Built $output_file"
