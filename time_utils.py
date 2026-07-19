from __future__ import annotations

import re

TIME_PATTERN = re.compile(r"^(?:(\d+):)?(\d{1,2})(?:[\.,](\d{1,3}))?$")


def parse_time_to_ms(value: str) -> int:
    text = str(value).strip()
    if not text:
        raise ValueError("기록이 비어 있습니다.")

    text = text.replace(" ", "")
    match = TIME_PATTERN.fullmatch(text)
    if not match:
        raise ValueError("기록은 1:32.0 또는 92.0 형식으로 입력해 주세요.")

    minutes_text, seconds_text, fraction_text = match.groups()
    minutes = int(minutes_text or 0)
    seconds = int(seconds_text)
    if minutes_text and seconds >= 60:
        raise ValueError("분:초 형식에서 초는 60 미만이어야 합니다.")

    fraction = (fraction_text or "0").ljust(3, "0")[:3]
    milliseconds = int(fraction)
    total_ms = (minutes * 60 + seconds) * 1000 + milliseconds
    return total_ms


def format_time_ms(milliseconds: int) -> str:
    milliseconds = int(milliseconds)
    total_seconds, ms = divmod(milliseconds, 1000)
    minutes, seconds = divmod(total_seconds, 60)
    tenths = ms // 100
    if minutes:
        return f"{minutes}:{seconds:02d}.{tenths}"
    return f"{seconds}.{tenths}"
