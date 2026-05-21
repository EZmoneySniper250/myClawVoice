import argparse
import json
import sys


def write_message(message):
    print(json.dumps(message, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description="Persistent faster-whisper worker")
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="zh")
    parser.add_argument("--beam-size", type=int, default=1)
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:
        write_message({"type": "fatal", "error": f"faster-whisper is not installed: {exc}"})
        return 2

    try:
        model = WhisperModel(args.model, device="auto", compute_type="auto")
    except Exception as exc:
        write_message({"type": "fatal", "error": f"Failed to load Whisper model: {exc}"})
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
            language = request.get("language") or args.language or None
        except Exception as exc:
            write_message({"type": "error", "id": None, "error": f"Invalid request: {exc}"})
            continue

        try:
            text = transcribe(model, audio_file, language, args.beam_size)
            if not text and language:
                text = transcribe(model, audio_file, None, max(args.beam_size, 3))
            write_message({"type": "result", "id": request_id, "text": text})
        except Exception as exc:
            write_message({"type": "error", "id": request_id, "error": str(exc)})

    return 0


def transcribe(model, audio_file, language, beam_size):
    # initial_prompt gives Whisper prior context so the first token is well-anchored
    prompt = "以下是普通话口语对话内容。" if (language or '').startswith('zh') else None
    segments, _info = model.transcribe(
        audio_file,
        language=language,
        vad_filter=False,
        beam_size=beam_size,
        no_speech_threshold=0.5,
        initial_prompt=prompt,
    )
    return "".join(segment.text for segment in segments).strip()


if __name__ == "__main__":
    raise SystemExit(main())
