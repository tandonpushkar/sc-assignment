"""Read source bytes listed in a local assignment manifest."""
import json
import mimetypes
from pathlib import Path
import sys
from service.extract import read_pages

def read_packet(manifest):
    records = []
    for entry in json.loads(manifest.read_text(encoding="utf8")):
        docs = []
        for filename in entry["files"]:
            path = manifest.parent / filename
            try:
                pages = read_pages(path.read_bytes(), mimetypes.guess_type(filename)[0] or "")
            except Exception as error:
                raise ValueError(f"{filename}: {error}") from error
            docs.append({"name": filename, "pages": pages})
        records.append({k: entry[k] for k in ("id", "title", "kind")} | {"docs": docs, "decisions": {}})
    return records

if __name__ == "__main__":
    print(json.dumps(read_packet(Path(sys.argv[1]))))
