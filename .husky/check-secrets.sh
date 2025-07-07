#!/usr/bin/env bash

# Check for hardcoded secrets in code
# This script scans for common patterns that might indicate exposed secrets

# Source utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utilities.sh"

# Common secret patterns to check
SECRET_PATTERNS=(
  # API Keys
  "api[_-]?key[[:space:]]*[=:][[:space:]]*[\"'][^\"']{20,}[\"']"
  "apikey[[:space:]]*[=:][[:space:]]*[\"'][^\"']{20,}[\"']"
  
  # AWS
  "AKIA[0-9A-Z]{16}"
  "aws[_-]?access[_-]?key[_-]?id[[:space:]]*[=:][[:space:]]*[\"'][^\"']{20,}[\"']"
  "aws[_-]?secret[_-]?access[_-]?key[[:space:]]*[=:][[:space:]]*[\"'][^\"']{40,}[\"']"
  
  # Passwords
  "password[[:space:]]*[=:][[:space:]]*[\"'][^\"']{8,}[\"']"
  "passwd[[:space:]]*[=:][[:space:]]*[\"'][^\"']{8,}[\"']"
  "pwd[[:space:]]*[=:][[:space:]]*[\"'][^\"']{8,}[\"']"
  
  # Tokens
  "token[[:space:]]*[=:][[:space:]]*[\"'][^\"']{20,}[\"']"
  "auth[_-]?token[[:space:]]*[=:][[:space:]]*[\"'][^\"']{20,}[\"']"
  "access[_-]?token[[:space:]]*[=:][[:space:]]*[\"'][^\"']{20,}[\"']"
  "bearer[[:space:]]+[a-zA-Z0-9_\\-\\.=]+{20,}"
  
  # Private Keys
  "-----BEGIN RSA PRIVATE KEY-----"
  "-----BEGIN OPENSSH PRIVATE KEY-----"
  "-----BEGIN DSA PRIVATE KEY-----"
  "-----BEGIN EC PRIVATE KEY-----"
  "-----BEGIN PGP PRIVATE KEY BLOCK-----"
  
  # Connection Strings
  "mongodb://[^[:space:]]+"
  "postgres://[^[:space:]]+"
  "mysql://[^[:space:]]+"
  "amqp://[^[:space:]]+"
  "redis://[^[:space:]]+"
  
  # Other secrets
  "secret[[:space:]]*[=:][[:space:]]*[\"'][^\"']{8,}[\"']"
  "client[_-]?secret[[:space:]]*[=:][[:space:]]*[\"'][^\"']{20,}[\"']"
  
  # Generic base64 that might be secrets (min 40 chars)
  "[\"'][a-zA-Z0-9+/]{40,}={0,2}[\"']"
)

# Files to exclude from scanning
EXCLUDE_PATTERNS=(
  "*.lock"
  "*.log"
  "*.min.js"
  "*.min.css"
  "dist/*"
  "build/*"
  "coverage/*"
  "node_modules/*"
  ".git/*"
  ".husky/*"
  "*.test.ts"
  "*.spec.ts"
  "*.test.js"
  "*.spec.js"
)

# Check if file should be excluded
should_exclude() {
  local file=$1
  for pattern in "${EXCLUDE_PATTERNS[@]}"; do
    if [[ $file == $pattern ]]; then
      return 0
    fi
  done
  return 1
}

# Scan file for secrets
scan_file() {
  local file=$1
  local found_secrets=false
  
  # Skip if file should be excluded
  if should_exclude "$file"; then
    return 0
  fi
  
  # Skip binary files
  if ! file "$file" | grep -q "text"; then
    return 0
  fi
  
  for pattern in "${SECRET_PATTERNS[@]}"; do
    if grep -qiE "$pattern" "$file" 2>/dev/null; then
      if [ "$found_secrets" = false ]; then
        print_warning "Potential secrets found in $file:"
        found_secrets=true
      fi
      grep -niE "$pattern" "$file" | head -5
    fi
  done
  
  if [ "$found_secrets" = true ]; then
    return 1
  fi
  
  return 0
}

# Main function
main() {
  local files=("$@")
  local errors=0
  
  # If no files provided, scan all tracked files
  if [ ${#files[@]} -eq 0 ]; then
    mapfile -t files < <(git ls-files)
  fi
  
  print_header "Scanning for hardcoded secrets"
  
  local total=${#files[@]}
  local current=0
  
  for file in "${files[@]}"; do
    ((current++))
    
    # Show progress for large scans
    if [ $total -gt 20 ]; then
      progress_bar $current $total
    fi
    
    if [ -f "$file" ]; then
      if ! scan_file "$file"; then
        ((errors++))
      fi
    fi
  done
  
  echo ""
  
  if [ $errors -gt 0 ]; then
    print_error "Found potential secrets in $errors file(s)"
    echo ""
    print_info "False positive? Add pattern to .gitignore or use environment variables"
    print_info "For sensitive data, use .env files and never commit them"
    return 1
  else
    print_success "No hardcoded secrets detected"
    return 0
  fi
}

# Run if executed directly
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi