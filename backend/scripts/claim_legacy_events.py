"""Assign retained pre-account events to an existing photographer after review."""
import argparse
import sqlite3
import os

parser = argparse.ArgumentParser()
parser.add_argument("--db", default=os.environ.get("DB_PATH", "data/app.db"))
parser.add_argument("--email", required=True)
parser.add_argument("--event-id", action="append", required=True, help="Repeat for each event to claim")
args = parser.parse_args()

with sqlite3.connect(args.db) as connection:
    owner = connection.execute("SELECT id FROM photographers WHERE email = ?", (args.email.lower(),)).fetchone()
    if not owner:
        parser.error("Photographer account not found")
    for event_id in args.event_id:
        event = connection.execute("SELECT id, name, photographer_id FROM events WHERE id = ?", (event_id,)).fetchone()
        if not event or event[2]:
            parser.error(f"Event {event_id} is missing or already owned")
        print(f"Claiming {event[1]} ({event_id})")
    for event_id in args.event_id:
        connection.execute("UPDATE events SET photographer_id = ? WHERE id = ? AND photographer_id IS NULL", (owner[0], event_id))
