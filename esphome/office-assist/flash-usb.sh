#!/bin/bash
# First (USB) flash of the ESPHome factory image onto the Waveshare 1.85C V2 "Office Assist".
# This board's USB-Serial/JTAG link drops long transfers, so the image goes over in 256 KB
# pieces, each verified and retried (same approach as dogbelly-pocket hardware/tools/flash.sh).
# After this, update over Wi-Fi only (esphome run/upload --device office-assist.local).
#
# Usage: flash-usb.sh <firmware.factory.bin> [port]
#   factory bin: .esphome/build/office-assist/build/firmware.factory.bin
#   (or the "Download -> Factory format" file from the ESPHome dashboard)
# Needs esptool >= 4.8 (ships with ESPHome). Back up the current flash first if you may want it back:
#   the IDF firmware backup lives in dogbelly-pocket hardware/backups/.
set -eo pipefail
BIN=${1:?factory .bin}
P=${2:-/dev/serial/by-id/usb-Espressif_USB_JTAG_serial_debug_unit_B8:1F:3F:D1:E4:94-if00}
ET=${ESPTOOL:-esptool}
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

retry() { for t in 1 2 3 4 5; do "$@" && return 0; sleep 2; done; return 1; }

write() {  # offset file
    for t in 1 2 3 4 5; do
        if timeout 90 $ET -p "$P" write-flash "$1" "$2" >/dev/null 2>&1; then
            out=$(timeout 60 $ET -p "$P" verify-flash "$1" "$2" 2>&1 || true)
            [[ $out == *successful* || $out == *"Verification successful"* ]] && return 0
        fi
        sleep 2
    done
    echo "FAILED at $1"; return 1
}

# Erase the whole chip first: removes the previous firmware and all its data (NVS, otadata,
# the old app), as Matt asked. The chip erases itself, so this is a short command over USB.
retry timeout 180 $ET -p "$P" erase-flash && echo "chip erased"

split -b 262144 -d -a 3 "$BIN" "$TMP/c"
i=0
for f in "$TMP"/c*; do write $((i * 262144)) "$f"; i=$((i + 1)); echo "piece $i ok"; done
echo "factory image ok ($i pieces)"
timeout 20 $ET -p "$P" --after watchdog-reset chip-id >/dev/null 2>&1 || true
echo "reset; watch logs with: esphome logs office-assist.yaml --device $P"
