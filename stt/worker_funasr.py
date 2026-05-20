import argparse
import json
import sys


def write_message(message):
    print(json.dumps(message, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description="Persistent FunASR worker")
    parser.add_argument("--model", default="paraformer-zh")
    args = parser.parse_args()

    try:
        from funasr import AutoModel
    except Exception as exc:
        write_message({"type": "fatal", "error": f"funasr not installed: {exc}"})
        return 2

    try:
        model = AutoModel(model=args.model, disable_update=True)
    except Exception as exc:
        write_message({"type": "fatal", "error": f"Failed to load FunASR model '{args.model}': {exc}"})
        return 2

    write_message({"type": "ready", "model": args.model})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
            request_id = request["id"]
            audio_file = request["audioFile"]
        except Exception as exc:
            write_message({"type": "error", "id": None, "error": f"Invalid request: {exc}"})
            continue

        try:
            res = model.generate(input=audio_file, batch_size_s=300)
            text = res[0]["text"].strip() if res else ""
            write_message({"type": "result", "id": request_id, "text": text})
        except Exception as exc:
            write_message({"type": "error", "id": request_id, "error": str(exc)})

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
