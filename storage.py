from __future__ import annotations

import csv
import json
import os
from abc import ABC, abstractmethod
from pathlib import Path
from threading import Lock
from typing import Any

HEADERS = [
    "id",
    "member_name",
    "event",
    "time_ms",
    "time_display",
    "competition",
    "competition_date",
    "note",
    "created_at",
]


class StorageError(RuntimeError):
    pass


class BaseStorage(ABC):
    display_name = "Unknown"

    @abstractmethod
    def list_records(self) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def append_record(self, record: dict[str, Any]) -> None:
        raise NotImplementedError

    def append_records(self, records: list[dict[str, Any]]) -> None:
        for record in records:
            self.append_record(record)

    @abstractmethod
    def delete_record(self, record_id: str) -> bool:
        raise NotImplementedError


class CsvStorage(BaseStorage):
    display_name = "Local CSV"

    def __init__(self, path: str):
        self.path = Path(path)
        self.lock = Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            with self.path.open("w", newline="", encoding="utf-8-sig") as handle:
                csv.DictWriter(handle, fieldnames=HEADERS).writeheader()

    def list_records(self) -> list[dict[str, Any]]:
        try:
            with self.lock, self.path.open("r", newline="", encoding="utf-8-sig") as handle:
                return list(csv.DictReader(handle))
        except OSError as exc:
            raise StorageError(f"로컬 CSV를 읽지 못했습니다: {exc}") from exc

    def append_record(self, record: dict[str, Any]) -> None:
        self.append_records([record])

    def append_records(self, records: list[dict[str, Any]]) -> None:
        try:
            with self.lock, self.path.open("a", newline="", encoding="utf-8-sig") as handle:
                writer = csv.DictWriter(handle, fieldnames=HEADERS, extrasaction="ignore")
                for record in records:
                    writer.writerow({key: record.get(key, "") for key in HEADERS})
        except OSError as exc:
            raise StorageError(f"로컬 CSV에 기록하지 못했습니다: {exc}") from exc

    def delete_record(self, record_id: str) -> bool:
        rows = self.list_records()
        filtered = [row for row in rows if str(row.get("id", "")) != record_id]
        if len(filtered) == len(rows):
            return False
        try:
            with self.lock, self.path.open("w", newline="", encoding="utf-8-sig") as handle:
                writer = csv.DictWriter(handle, fieldnames=HEADERS, extrasaction="ignore")
                writer.writeheader()
                writer.writerows(filtered)
            return True
        except OSError as exc:
            raise StorageError(f"로컬 CSV에서 삭제하지 못했습니다: {exc}") from exc


class GoogleSheetsStorage(BaseStorage):
    display_name = "Google Sheets"

    def __init__(self):
        try:
            import gspread
            from gspread.exceptions import WorksheetNotFound
        except ImportError as exc:
            raise StorageError("gspread 패키지가 설치되지 않았습니다.") from exc

        spreadsheet_id = os.getenv("SPREADSHEET_ID", "").strip()
        worksheet_name = os.getenv("WORKSHEET_NAME", "Records").strip() or "Records"
        if not spreadsheet_id:
            raise StorageError("SPREADSHEET_ID 환경변수가 필요합니다.")

        credentials_dict = self._load_credentials()
        try:
            client = gspread.service_account_from_dict(credentials_dict)
            spreadsheet = client.open_by_key(spreadsheet_id)
            try:
                worksheet = spreadsheet.worksheet(worksheet_name)
            except WorksheetNotFound:
                worksheet = spreadsheet.add_worksheet(title=worksheet_name, rows=1000, cols=len(HEADERS))
            self.worksheet = worksheet
            self._ensure_headers()
        except Exception as exc:
            raise StorageError(
                "Google Sheets 연결에 실패했습니다. 서비스 계정 공유 권한과 환경변수를 확인해 주세요."
            ) from exc

    @staticmethod
    def _load_credentials() -> dict[str, Any]:
        raw_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
        file_path = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "").strip()
        if raw_json:
            try:
                return json.loads(raw_json)
            except json.JSONDecodeError as exc:
                raise StorageError("GOOGLE_SERVICE_ACCOUNT_JSON이 올바른 JSON이 아닙니다.") from exc
        if file_path:
            try:
                return json.loads(Path(file_path).read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise StorageError("서비스 계정 JSON 파일을 읽지 못했습니다.") from exc
        raise StorageError(
            "GOOGLE_SERVICE_ACCOUNT_JSON 또는 GOOGLE_SERVICE_ACCOUNT_FILE 환경변수가 필요합니다."
        )

    def _ensure_headers(self) -> None:
        current = self.worksheet.row_values(1)
        if current[: len(HEADERS)] != HEADERS:
            if any(current):
                raise StorageError(
                    "Records 시트의 첫 행 헤더가 예상 형식과 다릅니다. README의 헤더를 적용해 주세요."
                )
            self.worksheet.update("A1", [HEADERS])

    def list_records(self) -> list[dict[str, Any]]:
        try:
            return self.worksheet.get_all_records(numericise_ignore=["all"])
        except Exception as exc:
            raise StorageError("Google Sheets에서 기록을 읽지 못했습니다.") from exc

    def append_record(self, record: dict[str, Any]) -> None:
        self.append_records([record])

    def append_records(self, records: list[dict[str, Any]]) -> None:
        rows = [[record.get(header, "") for header in HEADERS] for record in records]
        try:
            self.worksheet.append_rows(rows, value_input_option="RAW")
        except Exception as exc:
            raise StorageError("Google Sheets에 기록을 저장하지 못했습니다.") from exc

    def delete_record(self, record_id: str) -> bool:
        try:
            cell = self.worksheet.find(record_id, in_column=1)
            if not cell:
                return False
            self.worksheet.delete_rows(cell.row)
            return True
        except Exception as exc:
            raise StorageError("Google Sheets에서 기록을 삭제하지 못했습니다.") from exc


def get_storage() -> BaseStorage:
    backend = os.getenv("DATA_BACKEND", "csv").strip().lower()
    if backend == "sheets":
        return GoogleSheetsStorage()
    if backend == "csv":
        return CsvStorage(os.getenv("CSV_DATA_PATH", "data/records.csv"))
    raise StorageError("DATA_BACKEND는 'csv' 또는 'sheets'만 사용할 수 있습니다.")
