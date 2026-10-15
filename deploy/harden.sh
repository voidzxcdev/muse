#!/bin/bash
# Muse host harden: key-only SSH, kill Contabo/cloud-init password drop-ins,
# UFW, fail2ban, auto-updates, sysctl. Run as root once.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  ufw fail2ban unattended-upgrades ca-certificates curl

# --- SSH: main config ---
SSHD=/etc/ssh/sshd_config
cp -a "$SSHD" "${SSHD}.bak.$(date +%s)"
sed -i \
  -e 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
  -e 's/^#\?KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' \
  -e 's/^#\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' \
  -e 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' \
  -e 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' \
  -e 's/^#\?X11Forwarding.*/X11Forwarding no/' \
  -e 's/^#\?MaxAuthTries.*/MaxAuthTries 3/' \
  -e 's/^#\?PermitEmptyPasswords.*/PermitEmptyPasswords no/' \
  -e 's/^#\?AllowTcpForwarding.*/AllowTcpForwarding no/' \
  "$SSHD"
grep -q '^PasswordAuthentication' "$SSHD" || echo 'PasswordAuthentication no' >> "$SSHD"
grep -q '^PermitRootLogin' "$SSHD" || echo 'PermitRootLogin prohibit-password' >> "$SSHD"
grep -q '^PubkeyAuthentication' "$SSHD" || echo 'PubkeyAuthentication yes' >> "$SSHD"

# Contabo/cloud-init often re-enable passwords in drop-ins. Kill that.
mkdir -p /etc/ssh/sshd_config.d
cat >/etc/ssh/sshd_config.d/99-muse-harden.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
PermitEmptyPasswords no
X11Forwarding no
MaxAuthTries 3
AllowUsers root
AuthenticationMethods publickey
AllowTcpForwarding no
EOF

for f in /etc/ssh/sshd_config.d/50-cloud-init.conf \
         /etc/ssh/sshd_config.d/60-cloudimg-settings.conf; do
  if [ -f "$f" ]; then
    cp -a "$f" "${f}.bak.$(date +%s)"
    sed -i \
      -e 's/^PasswordAuthentication.*/PasswordAuthentication no/' \
      -e 's/^#PasswordAuthentication.*/PasswordAuthentication no/' \
      "$f"
    grep -q '^PasswordAuthentication' "$f" || echo 'PasswordAuthentication no' >> "$f"
  fi
done

if systemctl reload ssh 2>/dev/null; then :; else systemctl reload sshd; fi

# Lock passwords; disable Contabo default sudo user shell
passwd -l root || true
if id debian >/dev/null 2>&1; then
  passwd -l debian || true
  usermod -s /usr/sbin/nologin debian || true
  rm -f /etc/sudoers.d/90-cloud-init-users
fi

# --- Firewall: no public SSH. Only Docker bridge -> :22 (Cloudflare tunnel). ---
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
# cloudflared (compose network) reaches host SSH via bridge gateway
ufw allow from 172.18.0.0/16 to any port 22 proto tcp comment 'cloudflared-to-host-ssh'
ufw allow from 172.17.0.0/16 to any port 22 proto tcp comment 'docker0-ssh'
ufw --force enable

# --- fail2ban SSH jail ---
cat >/etc/fail2ban/jail.d/muse-sshd.conf <<'EOF'
[sshd]
enabled = true
port = ssh
filter = sshd
backend = systemd
maxretry = 4
bantime = 3600
findtime = 600
EOF

# --- kernel network harden (Docker still needs ip_forward) ---
cat >/etc/sysctl.d/99-muse.conf <<'EOF'
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_source_route = 0
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
EOF
sysctl --system >/dev/null 2>&1 || sysctl -p /etc/sysctl.d/99-muse.conf || true

systemctl enable --now fail2ban
systemctl enable --now unattended-upgrades
systemctl restart fail2ban
systemctl disable --now exim4 2>/dev/null || true

echo "HARDEN_OK"
echo "UFW:"; ufw status verbose | head -25
echo "SSHD effective:"
sshd -T 2>/dev/null | awk '/^(passwordauthentication|permitrootlogin|pubkeyauthentication|kbdinteractiveauthentication|maxauthtries|allowusers|authenticationmethods|allowtcpforwarding)/{print}'
echo "fail2ban:"; fail2ban-client status sshd 2>/dev/null | head -15 || true
