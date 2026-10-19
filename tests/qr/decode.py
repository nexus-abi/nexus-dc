"""Decodes the generated QR matrices with OpenCV (independent of qr.js) and checks the text round-trips."""
import json, sys, cv2, numpy as np
data = json.load(open(sys.argv[1])); bad = 0
det = cv2.QRCodeDetector()
for it in data:
    m = it['m']; n = len(m); s = 8; q = 4
    img = np.full(((n + 2 * q) * s, (n + 2 * q) * s), 255, np.uint8)
    for r in range(n):
        for c in range(n):
            if m[r][c] == '1': img[(r + q) * s:(r + q + 1) * s, (c + q) * s:(c + q + 1) * s] = 0
    txt, pts, _ = det.detectAndDecode(img)
    ok = txt == it['text']
    if not ok: bad += 1; print('FAIL v%d len=%d got=%r' % ((n - 17) // 4, len(it['text']), txt[:40]))
print('decoded OK: %d / %d' % (len(data) - bad, len(data)))
sys.exit(1 if bad else 0)
