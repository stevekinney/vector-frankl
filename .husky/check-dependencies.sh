#!/usr/bin/env bash

# Check if bun.lock is in sync with package.json
# This prevents inconsistent dependency installations

# Source utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utilities.sh"

# Check if bun.lock exists
check_lockfile_exists() {
  if [ ! -f "bun.lock" ]; then
    print_warning "No bun.lock file found"
    print_info "Run 'bun install' to generate lock file"
    return 1
  fi
  return 0
}

# Check if bun.lock is up to date
check_lockfile_sync() {
  # Create temporary directory for test
  local temp_dir=$(mktemp -d)
  local current_dir=$(pwd)
  
  # Copy package.json and bun.lock to temp directory
  cp package.json "$temp_dir/"
  cp bun.lock "$temp_dir/"
  
  cd "$temp_dir"
  
  # Run bun install in frozen mode to check if lock file is up to date
  if ! bun install --frozen-lockfile > /dev/null 2>&1; then
    cd "$current_dir"
    rm -rf "$temp_dir"
    return 1
  fi
  
  cd "$current_dir"
  rm -rf "$temp_dir"
  return 0
}

# Check for security vulnerabilities
check_vulnerabilities() {
  if command_exists "bunx"; then
    print_info "Checking for known vulnerabilities..."
    
    # Use npm audit since bun doesn't have built-in audit yet
    if bunx npm audit --audit-level=high 2>/dev/null | grep -q "found [1-9]"; then
      print_warning "Security vulnerabilities found in dependencies"
      bunx npm audit --audit-level=high 2>/dev/null | grep -E "(High|Critical)" | head -10
      return 1
    fi
  fi
  return 0
}

# Check for duplicate dependencies
check_duplicates() {
  local duplicates=$(bun pm ls 2>/dev/null | grep "duplicate" | wc -l)
  if [ "$duplicates" -gt 0 ]; then
    print_warning "Found $duplicates duplicate dependencies"
    print_info "Run 'bun pm dedupe' to optimize"
  fi
}

# Main function
main() {
  print_header "Checking dependencies"
  
  start_timer
  
  # Check if lock file exists
  if ! check_lockfile_exists; then
    end_timer "Dependency check"
    return 1
  fi
  
  # Check if lock file is in sync
  print_info "Verifying bun.lock is in sync with package.json..."
  if ! check_lockfile_sync; then
    print_error "bun.lock is out of sync with package.json"
    print_info "Run 'bun install' to update lock file"
    end_timer "Dependency check"
    return 1
  fi
  print_success "Lock file is in sync"
  
  # Check for vulnerabilities (optional, can be slow)
  if [ "$1" != "--skip-audit" ]; then
    check_vulnerabilities
  fi
  
  # Check for duplicates
  check_duplicates
  
  end_timer "Dependency check"
  print_success "All dependency checks passed"
  return 0
}

# Run if executed directly
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi