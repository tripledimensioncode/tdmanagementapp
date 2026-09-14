#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# fix-nginx-upload.sh
# Run this ONCE on the Raspberry Pi to allow uploads up to 20 MB through nginx.
# Usage:  bash scripts/fix-nginx-upload.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

NGINX_CONF="/etc/nginx/sites-available/default"
BACKUP="/etc/nginx/sites-available/default.bak.$(date +%Y%m%d%H%M%S)"

echo "→ Backing up current nginx config to $BACKUP"
sudo cp "$NGINX_CONF" "$BACKUP"

# Check if client_max_body_size is already set
if grep -q "client_max_body_size" "$NGINX_CONF"; then
  echo "→ Updating existing client_max_body_size to 500M"
  sudo sed -i 's/client_max_body_size[^;]*;/client_max_body_size 500M;/g' "$NGINX_CONF"
else
  echo "→ Inserting client_max_body_size 500M into server block"
  # Insert after the first 'server {' line
  sudo sed -i '/server {/a\    client_max_body_size 500M;' "$NGINX_CONF"
fi

echo "→ Testing nginx config..."
sudo nginx -t

echo "→ Reloading nginx..."
sudo systemctl reload nginx

echo "✅  Done. Nginx now allows uploads up to 20 MB."
