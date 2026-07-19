from __future__ import annotations

import csv
import hmac
import io
import os
import secrets
from collections import defaultdict
from datetime import date, datetime
from functools import wraps
from typing import Any

from dotenv import load_dotenv
from flask import (
    Flask,
    abort,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

from storage import StorageError, get_storage
from time_utils import format_time_ms, parse_time_to_ms

load_dotenv()

EVENTS = ["500M", "1000M", "2000M"]
CSV_ALIASES = {
    "member_name": ["member_name", "name", "이름", "회원명"],
    "event": ["event", "종목"],
    "time": ["time", "record", "기록", "time_display"],
    "competition": ["competition", "competition_name", "대회명", "대회"],
    "competition_date": ["competition_date", "date", "대회일자", "일자"],
    "note": ["note", "비고", "메모"],
}


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.getenv("FLASK_SECRET_KEY", secrets.token_hex(32))
    app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024
    app.config["ADMIN_PASSWORD"] = os.getenv("ADMIN_PASSWORD", "change-me")

    storage = get_storage()
    app.extensions["storage"] = storage

    @app.context_processor
    def inject_globals() -> dict[str, Any]:
        if "csrf_token" not in session:
            session["csrf_token"] = secrets.token_urlsafe(24)
        return {
            "csrf_token": session["csrf_token"],
            "events": EVENTS,
            "current_year": datetime.now().year,
        }

    @app.before_request
    def verify_csrf() -> None:
        if request.method == "POST":
            token = request.form.get("csrf_token") or request.headers.get("X-CSRF-Token")
            expected = session.get("csrf_token", "")
            if not token or not hmac.compare_digest(token, expected):
                abort(400, "유효하지 않은 요청입니다. 페이지를 새로고침해 주세요.")

    def login_required(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if not session.get("is_admin"):
                return redirect(url_for("admin_login", next=request.path))
            return view(*args, **kwargs)

        return wrapped

    def load_records() -> list[dict[str, Any]]:
        records = storage.list_records()
        normalized: list[dict[str, Any]] = []
        for row in records:
            try:
                time_ms = int(float(row.get("time_ms", 0) or 0))
            except (TypeError, ValueError):
                time_ms = 0
            if time_ms <= 0:
                continue
            event = str(row.get("event", "")).strip().upper()
            if event not in EVENTS:
                continue
            item = dict(row)
            item["time_ms"] = time_ms
            item["time_display"] = format_time_ms(time_ms)
            item["member_name"] = str(row.get("member_name", "")).strip()
            item["competition"] = str(row.get("competition", "")).strip()
            item["competition_date"] = str(row.get("competition_date", "")).strip()
            normalized.append(item)
        return normalized

    def build_leaderboard(records: list[dict[str, Any]]) -> dict[str, Any]:
        best_by_member_event: dict[tuple[str, str], dict[str, Any]] = {}
        histories: dict[str, list[dict[str, Any]]] = defaultdict(list)

        for record in records:
            histories[record["member_name"]].append(record)
            key = (record["member_name"], record["event"])
            current = best_by_member_event.get(key)
            if current is None or record["time_ms"] < current["time_ms"]:
                best_by_member_event[key] = record

        rankings: dict[str, list[dict[str, Any]]] = {}
        for event in EVENTS:
            event_rows = [r for (_, e), r in best_by_member_event.items() if e == event]
            event_rows.sort(key=lambda x: (x["time_ms"], x["member_name"]))
            previous_ms = None
            previous_rank = 0
            for index, row in enumerate(event_rows, start=1):
                if row["time_ms"] == previous_ms:
                    rank = previous_rank
                else:
                    rank = index
                row["rank"] = rank
                previous_ms = row["time_ms"]
                previous_rank = rank
            rankings[event] = event_rows

        members = sorted(histories.keys())
        member_summary: list[dict[str, Any]] = []
        for member in members:
            summary: dict[str, Any] = {"member_name": member, "record_count": len(histories[member])}
            for event in EVENTS:
                best = best_by_member_event.get((member, event))
                summary[event] = best["time_display"] if best else "-"
                summary[f"{event}_ms"] = best["time_ms"] if best else None
            member_summary.append(summary)

        return {
            "rankings": rankings,
            "member_summary": member_summary,
            "record_count": len(records),
            "member_count": len(members),
        }

    @app.get("/")
    def index():
        selected_event = request.args.get("event", "500M").upper()
        if selected_event not in EVENTS:
            selected_event = "500M"
        try:
            records = load_records()
            data = build_leaderboard(records)
            return render_template(
                "leaderboard.html",
                selected_event=selected_event,
                rankings=data["rankings"],
                member_summary=data["member_summary"],
                member_count=data["member_count"],
                record_count=data["record_count"],
                storage_name=storage.display_name,
            )
        except StorageError as exc:
            return render_template("error.html", message=str(exc)), 500

    @app.get("/api/leaderboard")
    def api_leaderboard():
        records = load_records()
        data = build_leaderboard(records)
        return jsonify(data)

    @app.route("/admin/login", methods=["GET", "POST"])
    def admin_login():
        if request.method == "POST":
            password = request.form.get("password", "")
            if hmac.compare_digest(password, app.config["ADMIN_PASSWORD"]):
                session["is_admin"] = True
                flash("관리자 로그인이 완료되었습니다.", "success")
                next_url = request.args.get("next", "")
                if not next_url.startswith("/") or next_url.startswith("//"):
                    next_url = url_for("admin")
                return redirect(next_url)
            flash("비밀번호가 올바르지 않습니다.", "error")
        return render_template("admin_login.html")

    @app.post("/admin/logout")
    def admin_logout():
        session.clear()
        flash("로그아웃되었습니다.", "success")
        return redirect(url_for("index"))

    @app.get("/admin")
    @login_required
    def admin():
        recent = sorted(
            load_records(),
            key=lambda r: (str(r.get("created_at", "")), str(r.get("competition_date", ""))),
            reverse=True,
        )[:30]
        return render_template("admin.html", recent_records=recent, today=date.today().isoformat())

    @app.post("/admin/records")
    @login_required
    def add_record():
        try:
            record = validate_record(
                {
                    "member_name": request.form.get("member_name", ""),
                    "event": request.form.get("event", ""),
                    "time": request.form.get("time", ""),
                    "competition": request.form.get("competition", ""),
                    "competition_date": request.form.get("competition_date", ""),
                    "note": request.form.get("note", ""),
                }
            )
            if is_duplicate(record, load_records()):
                flash("동일한 기록이 이미 등록되어 있습니다.", "error")
            else:
                storage.append_record(record)
                flash(f"{record['member_name']}님의 {record['event']} 기록을 등록했습니다.", "success")
        except ValueError as exc:
            flash(str(exc), "error")
        except StorageError as exc:
            flash(str(exc), "error")
        return redirect(url_for("admin"))

    @app.post("/admin/upload")
    @login_required
    def upload_csv():
        uploaded = request.files.get("csv_file")
        if not uploaded or not uploaded.filename:
            flash("CSV 파일을 선택해 주세요.", "error")
            return redirect(url_for("admin"))
        if not uploaded.filename.lower().endswith(".csv"):
            flash(".csv 파일만 업로드할 수 있습니다.", "error")
            return redirect(url_for("admin"))

        try:
            content = uploaded.read().decode("utf-8-sig")
        except UnicodeDecodeError:
            flash("CSV 파일을 UTF-8 형식으로 저장한 뒤 다시 업로드해 주세요.", "error")
            return redirect(url_for("admin"))

        reader = csv.DictReader(io.StringIO(content))
        if not reader.fieldnames:
            flash("CSV 헤더를 찾을 수 없습니다.", "error")
            return redirect(url_for("admin"))

        existing = load_records()
        valid_rows: list[dict[str, Any]] = []
        errors: list[str] = []
        duplicate_count = 0

        for row_number, raw in enumerate(reader, start=2):
            mapped = map_csv_row(raw)
            try:
                record = validate_record(mapped)
                if is_duplicate(record, existing + valid_rows):
                    duplicate_count += 1
                    continue
                valid_rows.append(record)
            except ValueError as exc:
                errors.append(f"{row_number}행: {exc}")

        if errors:
            preview = " / ".join(errors[:5])
            suffix = f" 외 {len(errors) - 5}건" if len(errors) > 5 else ""
            flash(f"CSV 검증 실패: {preview}{suffix}", "error")
            return redirect(url_for("admin"))
        if not valid_rows:
            flash("새로 등록할 기록이 없습니다. 중복 데이터만 포함되었을 수 있습니다.", "error")
            return redirect(url_for("admin"))

        try:
            storage.append_records(valid_rows)
            flash(
                f"CSV에서 {len(valid_rows)}건을 등록했습니다. 중복 {duplicate_count}건은 제외했습니다.",
                "success",
            )
        except StorageError as exc:
            flash(str(exc), "error")
        return redirect(url_for("admin"))

    @app.post("/admin/records/<record_id>/delete")
    @login_required
    def delete_record(record_id: str):
        try:
            deleted = storage.delete_record(record_id)
            if deleted:
                flash("기록을 삭제했습니다.", "success")
            else:
                flash("삭제할 기록을 찾지 못했습니다.", "error")
        except StorageError as exc:
            flash(str(exc), "error")
        return redirect(url_for("admin"))

    @app.get("/healthz")
    def healthz():
        return {"status": "ok", "backend": storage.display_name}

    @app.errorhandler(413)
    def too_large(_):
        return render_template("error.html", message="CSV 파일은 2MB 이하만 업로드할 수 있습니다."), 413

    return app


def validate_record(raw: dict[str, Any]) -> dict[str, Any]:
    member_name = str(raw.get("member_name", "")).strip()
    event = str(raw.get("event", "")).strip().upper()
    time_text = str(raw.get("time", "")).strip()
    competition = str(raw.get("competition", "")).strip()
    competition_date = str(raw.get("competition_date", "")).strip()
    note = str(raw.get("note", "")).strip()

    if not member_name:
        raise ValueError("이름이 비어 있습니다.")
    if len(member_name) > 40:
        raise ValueError("이름은 40자 이하로 입력해 주세요.")
    if event not in EVENTS:
        raise ValueError(f"종목은 {', '.join(EVENTS)} 중 하나여야 합니다.")

    time_ms = parse_time_to_ms(time_text)
    if time_ms <= 0:
        raise ValueError("기록은 0보다 커야 합니다.")

    if competition_date:
        try:
            datetime.strptime(competition_date, "%Y-%m-%d")
        except ValueError as exc:
            raise ValueError("대회일자는 YYYY-MM-DD 형식이어야 합니다.") from exc

    now = datetime.now().isoformat(timespec="seconds")
    return {
        "id": secrets.token_hex(8),
        "member_name": member_name,
        "event": event,
        "time_ms": time_ms,
        "time_display": format_time_ms(time_ms),
        "competition": competition,
        "competition_date": competition_date,
        "note": note,
        "created_at": now,
    }


def map_csv_row(raw: dict[str, Any]) -> dict[str, Any]:
    normalized = {str(k).strip().lower(): (v or "") for k, v in raw.items() if k is not None}
    result: dict[str, Any] = {}
    for canonical, aliases in CSV_ALIASES.items():
        result[canonical] = ""
        for alias in aliases:
            key = alias.strip().lower()
            if key in normalized:
                result[canonical] = normalized[key]
                break
    return result


def is_duplicate(candidate: dict[str, Any], existing: list[dict[str, Any]]) -> bool:
    candidate_key = (
        candidate.get("member_name"),
        candidate.get("event"),
        int(candidate.get("time_ms", 0)),
        candidate.get("competition", ""),
        candidate.get("competition_date", ""),
    )
    for row in existing:
        try:
            row_ms = int(float(row.get("time_ms", 0) or 0))
        except (TypeError, ValueError):
            row_ms = 0
        row_key = (
            str(row.get("member_name", "")).strip(),
            str(row.get("event", "")).strip().upper(),
            row_ms,
            str(row.get("competition", "")).strip(),
            str(row.get("competition_date", "")).strip(),
        )
        if row_key == candidate_key:
            return True
    return False


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=os.getenv("FLASK_DEBUG") == "1")
