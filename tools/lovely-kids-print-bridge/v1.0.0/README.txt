Lovely Kids Print Bridge
========================

Current stable version: 1.0.0
Protocol: ESC1-RAW
Local port: 17858

Endpoints:
- GET /health
- POST /print-png

Current status:
- Standalone EXE works without PowerShell.
- Auto-start with Windows works.
- Setup EXE installs to:
  %LOCALAPPDATA%\LovelyKids\PrintBridge

NEXT VERSION v1.1:
- On first installation/open, list all Windows printers.
- User selects label printer once.
- Save selected printer.
- Do not depend on printer being named POS-58.
- Test on second Windows device.
- Test 5 consecutive physical labels when new label roll is available.
