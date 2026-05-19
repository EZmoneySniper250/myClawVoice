import argparse
import os
import sys


def main():
    parser = argparse.ArgumentParser(description="Transcribe an audio file with faster-whisper")
    parser.add_argument("audio_file")
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="zh")
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:
        print(f"faster-whisper is not installed: {exc}", file=sys.stderr)
        sys.stderr.flush()
        os._exit(2)

    model = WhisperModel(args.model, device="auto", compute_type="auto")
    segments, _info = model.transcribe(
        args.audio_file,
        language=args.language or None,
        vad_filter=False,
        beam_size=5,
    )
    text = "".join(segment.text for segment in segments).strip()
    print(text, flush=True)
    # os._exit avoids Python interpreter shutdown, which triggers a CUDA cleanup
    # crash (STATUS_STACK_BUFFER_OVERRUN / 0xC0000409) on Windows with ctranslate2.
    os._exit(0)


if __name__ == "__main__":
    main()
