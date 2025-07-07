#!/usr/bin/env bash

# Shared utilities for git hooks
# This file provides common functions for colorful output, timing, and CI detection

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# Emojis for better readability
CHECK_MARK="✅"
CROSS_MARK="❌"
WARNING="⚠️ "
INFO="ℹ️ "
ROCKET="🚀"
TIMER="⏱️ "
LOCK="🔒"
PACKAGE="📦"
GEAR="⚙️ "

# Check if running in CI environment
is_ci() {
  [ -n "$CI" ] || [ -n "$CONTINUOUS_INTEGRATION" ] || [ -n "$GITHUB_ACTIONS" ] || [ -n "$GITLAB_CI" ]
}

# Print colored output
print_color() {
  local color=$1
  shift
  printf '%b\n' "${color}$*${RESET}"
}

# Print success message
print_success() {
  print_color "$GREEN" "$CHECK_MARK $*"
}

# Print error message
print_error() {
  print_color "$RED" "$CROSS_MARK $*"
}

# Print warning message
print_warning() {
  print_color "$YELLOW" "$WARNING $*"
}

# Print info message
print_info() {
  print_color "$CYAN" "$INFO $*"
}

# Print header
print_header() {
  echo ""
  print_color "$BOLD$BLUE" "$ROCKET $*"
  print_color "$BLUE" "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# Start timer
start_timer() {
  TIMER_START=$(date +%s)
}

# End timer and print elapsed time
end_timer() {
  local label=${1:-"Operation"}
  if [ -n "$TIMER_START" ]; then
    local TIMER_END=$(date +%s)
    local DURATION=$((TIMER_END - TIMER_START))
    print_color "$MAGENTA" "$TIMER $label completed in ${DURATION}s"
  fi
}

# Show spinner while a command runs
spinner() {
  local pid=$1
  local delay=0.1
  local spinstr='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  while [ "$(ps a | awk '{print $1}' | grep -w $pid)" ]; do
    local temp=${spinstr#?}
    printf " [%c]  " "$spinstr"
    local spinstr=$temp${spinstr%"$temp"}
    sleep $delay
    printf "\b\b\b\b\b\b"
  done
  printf "    \b\b\b\b"
}

# Run command with spinner
run_with_spinner() {
  local label=$1
  shift
  printf '%s' "$label"
  
  # Run command in background
  "$@" > /tmp/hook_output_$$.log 2>&1 &
  local pid=$!
  
  # Show spinner while command runs
  spinner $pid
  
  # Wait for command to finish and get exit code
  wait $pid
  local exit_code=$?
  
  if [ $exit_code -eq 0 ]; then
    print_success " Done"
  else
    print_error " Failed"
    echo ""
    cat /tmp/hook_output_$$.log
    echo ""
  fi
  
  rm -f /tmp/hook_output_$$.log
  return $exit_code
}

# Check if command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Get list of changed files between two commits
get_changed_files() {
  local base=${1:-HEAD~1}
  local head=${2:-HEAD}
  git diff --name-only "$base" "$head" 2>/dev/null
}

# Check if file was modified
file_changed() {
  local file=$1
  local base=${2:-HEAD~1}
  local head=${3:-HEAD}
  get_changed_files "$base" "$head" | grep -q "^$file$"
}

# Ensure we're in git repository
ensure_git_repo() {
  if ! git rev-parse --git-dir > /dev/null 2>&1; then
    print_error "Not in a git repository"
    exit 1
  fi
}

# Skip hook with message
skip_hook() {
  local reason=$1
  print_info "Skipping hook: $reason"
  exit 0
}

# Exit with error message and suggestion
exit_with_error() {
  local message=$1
  local suggestion=$2
  
  echo ""
  print_error "$message"
  
  if [ -n "$suggestion" ]; then
    echo ""
    print_info "Suggestion: $suggestion"
  fi
  
  echo ""
  print_warning "To bypass this hook, use --no-verify flag"
  echo ""
  
  exit 1
}

# Create a cache key for expensive operations
cache_key() {
  echo "$*" | sha256sum | cut -d' ' -f1
}

# Check if cache is valid (default: 5 minutes)
is_cache_valid() {
  local cache_file=$1
  local max_age=${2:-300}
  
  if [ ! -f "$cache_file" ]; then
    return 1
  fi
  
  local file_age=$(($(date +%s) - $(stat -f %m "$cache_file" 2>/dev/null || stat -c %Y "$cache_file" 2>/dev/null)))
  [ $file_age -lt $max_age ]
}

# Progress bar for long operations
progress_bar() {
  local current=$1
  local total=$2
  local width=${3:-50}
  
  local percent=$((current * 100 / total))
  local filled=$((width * current / total))
  
  printf "\r["
  printf "%${filled}s" | tr ' ' '='
  printf "%$((width - filled))s" | tr ' ' '-'
  printf "] %d%%" $percent
  
  if [ $current -eq $total ]; then
    echo ""
  fi
}

# Export all functions
export -f is_ci print_color print_success print_error print_warning print_info
export -f print_header start_timer end_timer spinner run_with_spinner
export -f command_exists get_changed_files file_changed ensure_git_repo
export -f skip_hook exit_with_error cache_key is_cache_valid progress_bar