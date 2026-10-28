"""Fail if the browser and edge-function copies of the shared pure modules differ."""
import pathlib, sys
r = pathlib.Path(__file__).resolve().parent.parent
bad = [f for f in ("retrieve.js", "score.js", "prompt.js", "matching.js") if (r / "assets/js" / f).exists() and (r / "assets/js" / f).read_text() != (r / "supabase/functions/_shared" / f).read_text()]
sys.exit(0 if not bad else print("copies differ: " + ", ".join(bad) + " (cp assets/js/<file> supabase/functions/_shared/)") or 1)
