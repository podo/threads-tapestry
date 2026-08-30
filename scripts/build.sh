#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="$project_dir/dist"

mkdir -p "$output_dir"

build_connector() {
  local connector_dir="$1"
  local output_file="$2"
  local temporary_file="$output_file.tmp"

  trap 'rm -f "$temporary_file"' RETURN
  node -e "JSON.parse(require('fs').readFileSync('$connector_dir/plugin-config.json')); JSON.parse(require('fs').readFileSync('$connector_dir/ui-config.json'));"
  (cd "$connector_dir" && zip -X -q "$temporary_file" plugin-config.json ui-config.json plugin.js README.md)
  unzip -t "$temporary_file"
  mv "$temporary_file" "$output_file"
  echo "Built $output_file"
}

build_connector "$project_dir/local.threads.feed" "$output_dir/ThreadsFeed.tapestry"
build_connector "$project_dir/local.threads.home" "$output_dir/ThreadsHome.tapestry"
build_connector "$project_dir/local.threads.web" "$output_dir/ThreadsWeb.tapestry"
