"""RapidOCR worker: reads {"path": ...} lines on stdin, writes one JSON reply per line."""

import json
import sys

from rapidocr_onnxruntime import RapidOCR


def main() -> None:
    engine = RapidOCR()
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            request = json.loads(raw)
            result, _elapsed = engine(request["path"])
            lines = [
                {
                    "text": str(text),
                    "box": [[float(x), float(y)] for x, y in box],
                    "score": float(score),
                }
                for box, text, score in (result or [])
            ]
            reply = {"lines": lines}
        except Exception as exc:  # report and keep serving
            reply = {"error": f"{type(exc).__name__}: {exc}"}
        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
