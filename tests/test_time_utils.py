import pytest

from time_utils import format_time_ms, parse_time_to_ms


def test_parse_minute_format():
    assert parse_time_to_ms("1:32.0") == 92000


def test_parse_seconds_format():
    assert parse_time_to_ms("92.35") == 92350


def test_format_time():
    assert format_time_ms(204500) == "3:24.5"


def test_invalid_time():
    with pytest.raises(ValueError):
        parse_time_to_ms("1:72.0")
