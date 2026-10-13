#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends ufw fail2ban unattended-upgrades ca-certificates curl

SSHD=/etc/ssh/sshd_config
cp -a "$SSHD" "${SSHD}.bak.$(date +%s)"
sed -i \
  -e 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
  -e 's/^#\?KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' \
  -e 's/^#\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' \
  -e 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' \
  -e 's/^#\?X11Forwarding.*/X11Forwarding no/' \
  -e 's/^#\?MaxAuthTries.*/MaxAuthTries 3/' \
  "$SSHD"
grep -q '^PasswordAuthentication' "$SSHD" || echo 'PasswordAuthentication no' >> "$SSHD"
grep -q '^PermitRootLogin' "$SSHD" || echo 'PermitRootLogin prohibit-password' >> "$SSHD"
if systemctl reload ssh 2>/dev/null; then :; else systemctl reload sshd; fi

ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

systemctl enable --now fail2ban
systemctl enable --now unattended-upgrades

echo "HARDEN_OK"
echo "UFW:"; ufw status | head -20
echo "SSHD password auth: $(sshd -T | awk '/^passwordauthentication/{print $2}')"
