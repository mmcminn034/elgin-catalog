"""Fail if the browser and edge-function copies of retrieve.js differ."""
import pathlib, sys
r = pathlib.Path(__file__).resolve().parent.parent
a, b = (r / "assets/js/retrieve.js").read_text(), (r / "supabase/functions/_shared/retrieve.js").read_text()
sys.exit(0 if a == b else print("retrieve.js copies differ: cp assets/js/retrieve.js supabase/functions/_shared/") or 1)
