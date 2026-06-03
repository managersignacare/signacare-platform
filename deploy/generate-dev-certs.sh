#!/bin/bash
# Generate self-signed TLS certificates for development
# Usage: ./deploy/generate-dev-certs.sh

set -e

CERT_DIR="$(dirname "$0")/certs"
mkdir -p "$CERT_DIR"

echo "Generating self-signed TLS certificate for development..."

openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout "$CERT_DIR/dev-key.pem" \
  -out "$CERT_DIR/dev-cert.pem" \
  -subj "/C=AU/ST=Victoria/L=Melbourne/O=Signacare EMR Dev/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo ""
echo "Certificates generated:"
echo "  Key:  $CERT_DIR/dev-key.pem"
echo "  Cert: $CERT_DIR/dev-cert.pem"
echo ""
echo "Add to .env:"
echo "  TLS_CERT_PATH=$CERT_DIR/dev-cert.pem"
echo "  TLS_KEY_PATH=$CERT_DIR/dev-key.pem"
echo ""
echo "For macOS trust (optional — removes browser warning):"
echo "  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain $CERT_DIR/dev-cert.pem"
