#!/usr/bin/env bash

# Validate .env file against .env.example
# Ensures all required environment variables are set

# Source utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utilities.sh"

# Extract environment variable names from file
extract_env_vars() {
  local file=$1
  grep -E '^[A-Z_][A-Z0-9_]*=' "$file" 2>/dev/null | cut -d'=' -f1 | sort
}

# Check if .env exists
check_env_exists() {
  if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
      print_info "No .env file found (optional)"
      print_info "To configure environment variables:"
      print_info "  cp .env.example .env"
    fi
    # Return success - .env is optional
    return 0
  fi
  return 0
}

# Compare .env with .env.example
compare_env_files() {
  if [ ! -f ".env.example" ]; then
    print_info "No .env.example file found, skipping validation"
    return 0
  fi
  
  # Get variables from both files
  local example_vars=$(extract_env_vars ".env.example")
  local env_vars=$(extract_env_vars ".env")
  
  # Find missing variables
  local missing_vars=()
  while IFS= read -r var; do
    if [ -n "$var" ] && ! echo "$env_vars" | grep -q "^$var$"; then
      missing_vars+=("$var")
    fi
  done <<< "$example_vars"
  
  # Find extra variables (not in example)
  local extra_vars=()
  while IFS= read -r var; do
    if [ -n "$var" ] && ! echo "$example_vars" | grep -q "^$var$"; then
      extra_vars+=("$var")
    fi
  done <<< "$env_vars"
  
  # Report findings
  local has_issues=false
  
  if [ ${#missing_vars[@]} -gt 0 ]; then
    has_issues=true
    print_error "Missing environment variables:"
    for var in "${missing_vars[@]}"; do
      echo "  - $var"
      # Show example value if available
      local example_value=$(grep "^$var=" ".env.example" | cut -d'=' -f2- | head -1)
      if [ -n "$example_value" ]; then
        print_info "    Example: $var=$example_value"
      fi
    done
    echo ""
  fi
  
  if [ ${#extra_vars[@]} -gt 0 ]; then
    print_warning "Extra environment variables (not in .env.example):"
    for var in "${extra_vars[@]}"; do
      echo "  - $var"
    done
    print_info "Consider adding these to .env.example if they're required"
    echo ""
  fi
  
  return $([ "$has_issues" = true ] && echo 1 || echo 0)
}

# Validate required variables have values
check_empty_values() {
  local empty_vars=()
  
  while IFS= read -r line; do
    if [[ $line =~ ^([A-Z_][A-Z0-9_]*)=(.*)$ ]]; then
      local var="${BASH_REMATCH[1]}"
      local value="${BASH_REMATCH[2]}"
      
      # Remove quotes if present
      value="${value%\"}"
      value="${value#\"}"
      value="${value%\'}"
      value="${value#\'}"
      
      # Check if value is empty or placeholder
      if [ -z "$value" ] || [[ "$value" =~ ^(your-|change-me|todo|xxx|placeholder) ]]; then
        empty_vars+=("$var")
      fi
    fi
  done < .env
  
  if [ ${#empty_vars[@]} -gt 0 ]; then
    print_warning "Environment variables with empty or placeholder values:"
    for var in "${empty_vars[@]}"; do
      echo "  - $var"
    done
    echo ""
    return 1
  fi
  
  return 0
}

# Check for sensitive variables
check_sensitive_patterns() {
  local sensitive_patterns=(
    "SECRET"
    "PASSWORD"
    "TOKEN"
    "KEY"
    "PRIVATE"
    "CREDENTIAL"
  )
  
  print_info "Checking for sensitive variables..."
  
  for pattern in "${sensitive_patterns[@]}"; do
    if grep -q "$pattern" .env 2>/dev/null; then
      print_warning "Found potentially sensitive variables containing '$pattern'"
      print_info "Ensure .env is in .gitignore and never committed"
    fi
  done
}

# Main function
main() {
  print_header "Validating environment configuration"
  
  start_timer
  
  # Check if .env exists
  check_env_exists
  
  local validation_failed=false
  
  # Only validate if .env exists
  if [ -f ".env" ]; then
    # Compare with .env.example
    if ! compare_env_files; then
      validation_failed=true
    fi
    
    # Check for empty values
    if ! check_empty_values; then
      validation_failed=true
    fi
    
    # Check sensitive patterns
    check_sensitive_patterns
    
    # Ensure .env is gitignored
    if ! git check-ignore .env > /dev/null 2>&1; then
      print_error ".env file is not in .gitignore!"
      print_info "Add '.env' to your .gitignore file immediately"
      validation_failed=true
    fi
  fi
  
  end_timer "Environment validation"
  
  if [ "$validation_failed" = true ]; then
    print_error "Environment validation failed"
    return 1
  else
    print_success "Environment validation passed"
    return 0
  fi
}

# Run if executed directly
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi