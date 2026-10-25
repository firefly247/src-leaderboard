/* Generated from source-map.json and public CSV headers. */
var StorageLayout = {
  "events": {
    "columns": [
      "event_id",
      "event_name"
    ],
    "key": [
      "event_id"
    ],
    "sheet": null,
    "path": "data/events.csv"
  },
  "records": {
    "columns": [
      "record_id",
      "member_name",
      "event_id",
      "event_name",
      "time_ms",
      "time_display",
      "competition",
      "competition_date",
      "note",
      "proof_photo_url",
      "created_at"
    ],
    "key": [
      "record_id"
    ],
    "sheet": null,
    "path": "data/records.csv"
  },
  "competitions": {
    "columns": [
      "competition_id",
      "competition_name"
    ],
    "key": [
      "competition_id"
    ],
    "sheet": null,
    "path": "data/competitions.csv"
  },
  "competition_dates": {
    "columns": [
      "competition_id",
      "year",
      "competition_date"
    ],
    "key": [
      "competition_id",
      "year"
    ],
    "sheet": null,
    "path": "data/competition_dates.csv"
  },
  "competition_events": {
    "columns": [
      "competition_event_id",
      "competition_event_name"
    ],
    "key": [
      "competition_event_id"
    ],
    "sheet": null,
    "path": "data/competition_events.csv"
  },
  "competition_divisions": {
    "columns": [
      "competition_division_id",
      "competition_division_name"
    ],
    "key": [
      "competition_division_id"
    ],
    "sheet": null,
    "path": "data/competition_divisions.csv"
  },
  "competition_records": {
    "columns": [
      "record_id",
      "member_name",
      "competition_id",
      "competition_name",
      "competition_event_id",
      "competition_event_name",
      "competition_division_id",
      "competition_division_name",
      "year",
      "competition_type",
      "is_cox",
      "gold",
      "silver",
      "bronze",
      "note",
      "created_at",
      "lineup_group_id"
    ],
    "key": [
      "record_id"
    ],
    "sheet": null,
    "path": "data/competition_records.csv"
  },
  "dormant_members": {
    "columns": [
      "member_name"
    ],
    "key": [
      "member_name"
    ],
    "sheet": null,
    "path": "data/dormant_members.csv"
  },
  "player_birth_years": {
    "columns": [
      "member_name",
      "birth_year",
      "updated_at",
      "join_year"
    ],
    "key": [
      "member_name"
    ],
    "sheet": "PLAYER_BIRTH_YEARS",
    "path": null
  },
  "weekend_training": {
    "columns": [
      "date",
      "session_json"
    ],
    "key": [
      "date"
    ],
    "sheet": "WEEKEND_TRAINING",
    "path": null
  },
  "competition_lineups": {
    "columns": [
      "id",
      "session_json"
    ],
    "key": [
      "id"
    ],
    "sheet": "COMPETITION_LINEUPS",
    "path": null
  },
  "request_log": {
    "columns": [
      "request_id",
      "request_type",
      "requested_at",
      "source_json",
      "status",
      "processed_at",
      "result",
      "record_id",
      "member_name",
      "event_id",
      "event_name",
      "time_display",
      "competition_date",
      "competition",
      "note",
      "proof_photo_url",
      "delete_reason"
    ],
    "key": [
      "request_id"
    ],
    "sheet": "REQUEST_LOG",
    "path": null
  }
};
