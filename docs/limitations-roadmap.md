# Limitations and roadmap

## Limitations
- **Reference coverage is uneven.**
  - North America is deep: every projectilepoints.net type page, plus PIDBA Paleoindian measurements.
  - The rest of the world is shallow: curated industry entries plus Wikidata cultures, mostly without size ranges or traits.
  - Texas stays the most detailed region through `points.json`, which always wins.
- **Traits are keyword tags.** They come from a fixed regex vocabulary over the source descriptions, not expert coding. Negation handling is heuristic.
- **Published-only matches can be noisy.** Look-alike worldwide types (for example Fishtail/Fell's Cave on a flake) can show up at low %. They need ≥3 trait hits or a name mention.
- **The score is a heuristic.** Its weights are hand-set, not calibrated against outcomes. Treat the % as "how much evidence supports this", not as a probability.
- **No calibration data yet.** Feedback counts are small.
- **Not yet live:** the edge function on this branch is not deployed (and not type-checked with Deno, only transpiled with esbuild), and migration 009 is not applied.
- **projectilepoints.net has no explicit license.** Only facts and links are stored; written permission would be better before featuring it prominently.
- **Photos:** see the GitHub image caveat in [privacy.md](privacy.md).

## Roadmap
1. Apply 009 and seed it. Deploy analyze-find with the reference layer, after review.
2. Stage 3 (worldwide classification and origin): rebase onto this branch (`preview/worldwide-s3-ref`) and review together.
3. Calibrate the score weights against owner Verified and Wrong outcomes once there are about 100 or more labelled finds.
4. Add more open sources: museum open-access APIs (Smithsonian, British Museum CC BY-NC-SA metadata only), regional typologies (Europe, Africa, Australia).
5. Signed URLs for the `find-photos` bucket, and moving sensitive repo images out of git.
6. Add Deno type-checking (`deno check`) to CI.
