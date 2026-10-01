#!/usr/bin/env bash
# One-shot prep for a fresh Ubuntu 22.04/24.04 VPS (Contabo). Run as root:
#   bash setup.sh
# Installs Xvfb, Google Chrome, Node.js 22 (skipped if node exists), PM2, creates user `bot`, copies this folder to
# /home/bot/mrmoo-bot and registers PM2 to start on boot.
set -euo pipefail

BOT_USER=bot
APP_DIR=/home/$BOT_USER/mrmoo-bot
SRC_DIR="$(dirname "$(readlink -f "$0")")"

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=l # list only: never auto-restart other services on a shared host
# No `apt-get upgrade` on purpose: it can bump docker/nginx/db packages on a server that already runs things.
# Run it yourself on a fresh box if you want it.
apt-get update
apt-get install -y curl wget gnupg ca-certificates rsync xvfb xauth \
  fonts-liberation fonts-noto-color-emoji fonts-thai-tlwg

# Google Chrome stable. Do not use apt "chromium-browser": on Ubuntu it is a snap and breaks Puppeteer.
if ! command -v google-chrome-stable >/dev/null; then
  wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y /tmp/chrome.deb # also pulls every shared library Chrome needs
  rm -f /tmp/chrome.deb
fi

if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

npm install -g pm2

id "$BOT_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$BOT_USER"
mkdir -p "$APP_DIR"
rsync -a --exclude node_modules --exclude profile "$SRC_DIR/" "$APP_DIR/"
chown -R "$BOT_USER:$BOT_USER" "/home/$BOT_USER"

# systemd unit that resurrects the processes saved with `pm2 save` after a reboot.
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$BOT_USER" --hp "/home/$BOT_USER"

cat <<EOF

Done. Next, as user $BOT_USER:
  su - $BOT_USER
  cd mrmoo-bot
  PUPPETEER_SKIP_DOWNLOAD=1 npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth
  nano ecosystem.config.js
  pm2 start ecosystem.config.js && pm2 save
EOF
