#!/bin/bash
set -e

# Update alternatives / binary link
if type update-alternatives >/dev/null 2>&1; then
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Ensure root owner and 4755 SUID mode on chrome-sandbox helper if present
if [ -f '/opt/${sanitizedProductName}/chrome-sandbox' ]; then
    chown root:root '/opt/${sanitizedProductName}/chrome-sandbox' 2>/dev/null || true
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' 2>/dev/null || true
fi

# Update desktop and MIME databases
if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# Install and reload AppArmor profile (Ubuntu 24.04+)
if apparmor_status --enabled > /dev/null 2>&1 || aa-enabled > /dev/null 2>&1; then
    APPARMOR_PROFILE_SOURCE='/opt/${sanitizedProductName}/resources/apparmor-profile'
    APPARMOR_PROFILE_TARGET='/etc/apparmor.d/${executable}'

    if [ -f "$APPARMOR_PROFILE_SOURCE" ]; then
        if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" > /dev/null 2>&1 || [ -f "$APPARMOR_PROFILE_SOURCE" ]; then
            cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"

            if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
                apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET" 2>/dev/null || true
            fi
        fi
    fi
fi
