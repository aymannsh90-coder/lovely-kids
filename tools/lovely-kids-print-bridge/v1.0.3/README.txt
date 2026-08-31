Lovely Kids Print Bridge v1.0.3
================================

Source version for BT-58L / System 58L.

Protocol:
ESC1-RAW

Bridge:
http://127.0.0.1:17858

Version:
1.0.3

Features:
- Preserves calibrated QR label printing.
- Adds POST /print-receipt-png for continuous 58mm receipts.
- QR labels keep the calibrated -24 dot horizontal shift.
- Receipts use zero horizontal shift.
- QR labels use GS FF for next-label positioning.
- Receipts use normal paper feed.

Store QR label canvas:
- Width: 384 dots
- Height: 195 dots

Important:
The stale v1.0.2 binaries previously copied into this folder are
intentionally not included.

Build a fresh v1.0.3 executable on Windows from:
Build-LovelyKidsPrintBridge-Standalone.ps1

Verify after installation:
http://127.0.0.1:17858/health

The reported version must be 1.0.3.
