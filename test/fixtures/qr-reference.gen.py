# Provenance of test/fixtures/qr-reference.json (not run by the tests).
# Generated with segno 1.6.6 (pure-Python ISO/IEC 18004 encoder) in a throwaway venv:
#   python3 -m venv /tmp/v && /tmp/v/bin/pip install segno==1.6.6 && /tmp/v/bin/python -I qr-reference.gen.py out.json
# One fix applied to that copy first: segno 1.6.6 write_padding_bits appends `8 - (length % 8)` zero bits,
# which adds a whole extra 0x00 codeword when the bit stream is already byte-aligned (always, in byte
# mode). ISO 18004 §7.4.10 pads only to the codeword boundary, so the line was changed to
# `((8 - (length % 8)) % 8)`. Everything else (RS, placement, masks, penalty, format/version) is stock.
import json, sys, segno
cases = [
  ("hello", 1, None), ("https://laptop.tail1234.ts.net/pair#t=" + "A"*43, None, None),
  ("Mission Control", 2, None), ("x"*40, 3, None), ("y"*60, 4, None), ("https://a.ts.net/pair#t=" + "Zb_9-"*8, 5, None),
  ("z"*100, 6, None), ("q"*120, 7, None), ("w"*150, 8, None), ("e"*178, 9, None), ("r"*210, 10, None),
  ("café ✓", None, None),
]
# forced masks too, on a v7 and v2 to cover version info and every mask
for m in range(8): cases.append(("mask test %d https://host.ts.net" % m, 7, m))
for m in range(8): cases.append(("m%d" % m, 2, m))
out = []
for text, ver, mask in cases:
  q = segno.make_qr(text.encode("utf-8"), error="m", mode="byte", version=ver, mask=mask, boost_error=False, encoding=None)
  rows = ["".join("1" if x else "0" for x in row) for row in q.matrix]
  out.append({"text": text, "version": ver, "forcedMask": mask, "gotVersion": q.version, "mask": q.mask, "rows": rows})
json.dump(out, open(sys.argv[1], "w"), indent=0)
print(len(out))
