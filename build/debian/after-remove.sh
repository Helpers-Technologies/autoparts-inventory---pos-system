#!/bin/bash

# Remove symlink to binary
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}' 2>/dev/null || update-alternatives --remove '${executable}' '/usr/bin/${executable}' 2>/dev/null || true
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Cleanly unload and remove AppArmor profile
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
    if { apparmor_status --enabled > /dev/null 2>&1 || aa-enabled > /dev/null 2>&1; } && hash apparmor_parser 2>/dev/null; then
        apparmor_parser --remove "$APPARMOR_PROFILE_DEST" 2>/dev/null || true
    fi
    rm -f "$APPARMOR_PROFILE_DEST"
fi
