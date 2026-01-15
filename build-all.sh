#!/bin/bash

# Build/Install microservices
# Usage:
#   ./build-all.sh                    # Build all services
#   ./build-all.sh --install          # Install deps for all services
#   ./build-all.sh --install --build  # Install and build all services
#   ./build-all.sh user-service payment-service  # Build specific services
#   ./build-all.sh --install user-service        # Install specific services

set -e

ALL_SERVICES=(
  "gateway-service"
  "user-service"
  "notification-service"
  "payment-service"
  "product-service"
  "tombola-service"
  "settings-service"
  "chat-service"
)

ROOT_DIR=$(pwd)
FAILED=()
SUCCESS=()
DO_INSTALL=false
DO_BUILD=false
SERVICES=()

# Parse arguments
for arg in "$@"; do
  case $arg in
    --install|-i)
      DO_INSTALL=true
      ;;
    --build|-b)
      DO_BUILD=true
      ;;
    --help|-h)
      echo "Usage: $0 [options] [services...]"
      echo ""
      echo "Options:"
      echo "  --install, -i    Run npm install for services"
      echo "  --build, -b      Run npm run build for services"
      echo "  --help, -h       Show this help message"
      echo ""
      echo "Services: ${ALL_SERVICES[*]}"
      echo ""
      echo "Examples:"
      echo "  $0                           # Build all services"
      echo "  $0 --install                 # Install all services"
      echo "  $0 --install --build         # Install and build all"
      echo "  $0 user-service              # Build user-service only"
      echo "  $0 -i -b user-service        # Install and build user-service"
      exit 0
      ;;
    *)
      # Check if it's a valid service name
      for svc in "${ALL_SERVICES[@]}"; do
        if [ "$arg" == "$svc" ]; then
          SERVICES+=("$arg")
          break
        fi
      done
      ;;
  esac
done

# Default to build if no action specified
if [ "$DO_INSTALL" = false ] && [ "$DO_BUILD" = false ]; then
  DO_BUILD=true
fi

# Default to all services if none specified
if [ ${#SERVICES[@]} -eq 0 ]; then
  SERVICES=("${ALL_SERVICES[@]}")
fi

echo "=========================================="
echo "Services: ${SERVICES[*]}"
echo "Install: $DO_INSTALL | Build: $DO_BUILD"
echo "=========================================="

for service in "${SERVICES[@]}"; do
  echo ""
  echo "Processing $service..."
  echo "------------------------------------------"

  if [ -d "$service" ]; then
    cd "$ROOT_DIR/$service"

    if [ "$DO_INSTALL" = true ]; then
      echo "Installing dependencies for $service..."
      if npm install; then
        echo "✓ $service dependencies installed"
      else
        echo "✗ $service install failed"
        FAILED+=("$service:install")
        cd "$ROOT_DIR"
        continue
      fi
    fi

    if [ "$DO_BUILD" = true ]; then
      echo "Building $service..."
      if npm run build; then
        echo "✓ $service built successfully"
        SUCCESS+=("$service")
      else
        echo "✗ $service build failed"
        FAILED+=("$service:build")
        cd "$ROOT_DIR"
        continue
      fi
    fi

    if [ "$DO_INSTALL" = true ] && [ "$DO_BUILD" = false ]; then
      SUCCESS+=("$service")
    fi

    cd "$ROOT_DIR"
  else
    echo "✗ $service directory not found"
    FAILED+=("$service:notfound")
  fi
done

echo ""
echo "=========================================="
echo "Summary"
echo "=========================================="
echo "Success (${#SUCCESS[@]}): ${SUCCESS[*]}"
echo "Failed (${#FAILED[@]}): ${FAILED[*]}"
echo ""

if [ ${#FAILED[@]} -gt 0 ]; then
  exit 1
fi

echo "All operations completed successfully!"
