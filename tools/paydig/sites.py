"""Pay-to-dig / fee-dig sites (US), verified Oct 2026 against each operator's official site (or its indexed official pages).
Town-level location only. Fees only where the operator publishes them. No partnerships implied.
python3 tools/paydig/sites.py          -> upsert SQL (pay_dig_sites)
python3 tools/paydig/sites.py --json   -> data/pay-dig-sites.json (static fallback)"""
import json, sys
V = "2026-10-18"; C = " (per operator site, checked Oct 2026)"; SEE = "See operator site"
S = []
def add(slug, name, state, area, typ, finds, fee, url, status, src=None):
    S.append(dict(slug=slug, name=name, state=state, area=area, type=typ, finds=finds, fee_note=(fee + C) if fee else SEE, url=url, status_note=status, source_url=src or url, last_verified=V))
F, M, X = "Fossils", "Minerals & Gems", "Mixed"
add("crater-of-diamonds", "Crater of Diamonds State Park", "Arkansas", "Murfreesboro", M, "Diamonds (white, brown, yellow), amethyst, garnet, jasper, agate, quartz",
    "Diamond search area: adults $15, ages 6–12 $7, under 6 free", "https://www.arkansasstateparks.com/parks/crater-diamonds-state-park", "Open daily year-round except major holidays (state park).")
add("ron-coleman", "Ron Coleman Mining", "Arkansas", "Jessieville (near Hot Springs)", M, "Quartz crystals from fresh mine tailings", None, "https://www.roncolemanmining.com/", "Open; crystal digging daily, no reservation needed.")
add("u-dig-fossils", "U-Dig Fossils", "Utah", "Near Delta", F, "Cambrian trilobites (Wheeler Shale)", None, "https://u-digfossils.com/", "Seasonal: 2026 season Mar 30 – Oct 24, Mon–Sat.")
add("fossil-lake-safari", "Fossil Lake Safari", "Wyoming", "Kemmerer", F, "Green River Formation fossil fish, plants, insects",
    "Full day $169 adult / $89 ages 7–16; 2- and 4-hour options; 6 and under free", "https://www.fossilsafari.com/", "Seasonal: May 9 – Sept 30 (2026 season ended).", "https://www.fossilsafari.com/rates/")
add("ulrichs", "Ulrich's Fossil Gallery quarry tours", "Wyoming", "Kemmerer", F, "Green River Formation fossil fish (18-inch layer)",
    "$135 per adult; children under 16 dig free with a paying adult", "https://www.ulrichsfossilgallery.com/", "Seasonal: mid-May through October, weather permitting; weekend reservations required.")
add("tynskys", "Tynsky's Fossils", "Wyoming", "Kemmerer", F, "Green River Formation fossil fish",
    "Private dig parties: $125 per person, 10-person minimum", "https://tynskysfossils.com/", "Group digs only (10+); quarry usually open June–September.", "https://tynskysfossils.com/fossil-dig/")
add("american-fossil", "American Fossil", "Wyoming", "Near Kemmerer", F, "Green River Formation fossil fish, plants",
    "Adults 8 hr $169 / 4 hr $109 / 2 hr $89; ages 6–14 $59–$89; under 6 free", "https://www.americanfossil.com/", "Open seasonally (2026 pricing posted); confirm dates with the operator.")
add("herkimer-diamond-mines", "Herkimer Diamond Mines", "New York", "Middleville (Herkimer County)", M, "Herkimer diamonds (doubly terminated quartz)", None, "https://www.herkimerdiamond.com/", "Seasonal: 2026 season opened April 12.")
add("crystal-grove", "Crystal Grove Diamond Mine & Campground", "New York", "St. Johnsville", M, "Herkimer diamonds (quartz crystals)", None, "https://www.crystalgrove.com/", "Closed for the 2026 season; reopens April 16, 2027 per operator.")
add("penn-dixie", "Penn Dixie Fossil Park & Nature Reserve", "New York", "Blasdell (Hamburg)", F, "Devonian trilobites, brachiopods, crinoids, corals", None, "https://penndixie.org/", "Seasonal: closed to the public for 2026; limited group tours through October.")
add("royal-peacock", "Royal Peacock Opal Mines", "Nevada", "Denio (Virgin Valley)", M, "Precious opal, opalized wood",
    "Bank digging $210/person/day; tailings $85/person/day; kids 12 and under free on tailings", "https://royalpeacock.com/", "Seasonal: May 1 – Oct 18, 2026, weather permitting.", "https://royalpeacock.com/digging/")
add("emerald-village", "Emerald Village", "North Carolina", "Little Switzerland / Spruce Pine", M, "Emerald, aquamarine, garnet, tourmaline, feldspar minerals",
    "Gem buckets $15–$500; Crabtree Emerald Mine dig $25/day (ages 13+)", "https://www.emeraldvillage.com/", "Seasonal: April 1 – October 31, 2026.", "https://www.emeraldvillage.com/mines-activities/the-north-carolina-gemstone-mine/")
add("gem-mountain-nc", "Gem Mountain Gemstone Mine", "North Carolina", "Spruce Pine", M, "Mixed and native gemstone buckets (aquamarine, emerald, garnet, ruby)",
    "Buckets from $45 (2 gal) to $1,000 (30 gal barrel)", "https://www.gemmountain.com/", "Open March 1 – December 31, Mon–Sat.", "https://www.gemmountain.com/hours/")
add("emerald-hollow", "Emerald Hollow Mine", "North Carolina", "Hiddenite", M, "Emerald, hiddenite, sapphire, garnet, quartz",
    "Adult permit $30 (15+), child $10 (4–14); enriched buckets extra", "https://www.emeraldhollowmine.com/", "Open daily; closes for electrical storms.")
add("cherokee-ruby", "Cherokee Ruby & Sapphire Mine", "North Carolina", "Franklin (Cowee Valley)", M, "Ruby, sapphire (incl. star), rhodolite garnet, moonstone; unsalted native ore",
    "$30 per person incl. one 2-gal bucket; 6 and under free with paid miner", "https://cherokeerubymine.com/", "Open March–December, weather permitting.", "https://cherokeerubymine.com/mining-fees/")
add("mason-mountain", "Mason Mountain Mine & Cowee Gift Shop", "North Carolina", "Franklin", M, "Rhodolite garnet, ruby, sapphire, native dirt",
    "Native dig pile $40 adult / $20 ages 6–12; under 6 free", "https://masonmtnmine.com/", "Seasonal: March 4 – October 31, Wed–Sat.")
add("sheffield", "Sheffield Gem Mine", "North Carolina", "Franklin", M, "Star rubies and star sapphires (native), mixed buckets",
    "Admission $10; native buckets $5, rainbow $10, specialty $20–$200", "https://sheffieldmine.com/", "Seasonal: March 28 – October 31, 2026.", "https://sheffieldmine.com/activities-rates/")
add("mineral-wells-fossil-park", "Mineral Wells Fossil Park", "Texas", "Mineral Wells", F, "Pennsylvanian crinoids, brachiopods, bryozoans, trilobite fragments",
    "Free city park (no dig fee)", "https://www.mineralwellstx.gov/209/Mineral-Wells-Fossil-Park", "Open daily year-round (city of Mineral Wells).")
add("gem-mountain-mt", "Gem Mountain Sapphire Mine", "Montana", "Philipsburg", M, "Montana sapphires (Rock Creek)",
    "Natural sapphire gravel bucket $55 (2 gal)", "https://gemmountainmt.com/", "Mine seasonal (2026: May 20 – Sept 5); Philipsburg shop washes gravel year-round.", "https://gemmountainmt.com/plan-your-trip")
add("spokane-bar", "Spokane Bar Sapphire Mine", "Montana", "Helena", M, "Missouri River sapphires, garnet, gold",
    "Sapphire gravel from $100", "https://www.sapphiremine.com/", "Open; hours differ between listings, so call before visiting.", "https://www.sapphiremine.com/faqs/")
add("spectrum-sunstone", "Spectrum Sunstone Mine", "Oregon", "Plush", M, "Oregon sunstone",
    "Pit digging $100–$200/person; ore piles $225; kids 12 and under free", "https://highdesertgemsandminerals.com/html/spectrum_sunstone_mine.html", "Seasonal: May 15 – October 15, 2026.")
add("spencer-opal", "Spencer Opal Mines", "Idaho", "Spencer", M, "Precious opal (tailings pile)",
    "Tailings $75 adult / $50 under 16", "https://www.spenceropalmines.com/", "Seasonal: about Memorial Day – mid-September, Thu–Mon; call ahead.", "https://www.spenceropalmines.com/about-us/")
add("emerald-creek-garnet", "Emerald Creek Garnet Area (U.S. Forest Service)", "Idaho", "Near Clarkia (Idaho Panhandle NF)", M, "Star garnets",
    "$15 adult, $5 ages 6–12 (Recreation.gov reservation)", "https://www.fs.usda.gov/r01/idahopanhandle/recreation/emerald-creek-garnet-area", "FLAGGED: closed early for 2026 (garnet material depleted); check before planning 2027.")
add("stonerose", "Stonerose Interpretive Center & Eocene Fossil Site", "Washington", "Republic", F, "Eocene plant, insect and fish fossils",
    "Adults $18, seniors $12, youth 5–17 $7, under 5 free", "https://stonerosefossil.org/", "Seasonal: 2026 public season through Oct 31.", "https://stonerosefossil.org/fossilhunting/admission-fees/")
add("wyoming-dinosaur-center", "Wyoming Dinosaur Center: Dig for a Day", "Wyoming", "Thermopolis", F, "Jurassic dinosaur bone (guided research dig)", None, "https://wyomingdinosaurcenter.org/", "Seasonal program (2026: May 24 – Sept 10); reservations required.", "https://wyomingdinosaurcenter.org/mecevents/dig-for-a-day-5/")
add("sylvania-fossil-park", "Fossil Park (Olander Park System)", "Ohio", "Sylvania", F, "Devonian brachiopods, trilobites, horn corals",
    "Free (parking, admission and fossil hunting)", "https://outdoorsylvania.com/fossil-park/", "Seasonal: about mid-April – late October, Fri–Sun, by reservation.")
add("oceanview-mine", "Oceanview Mine", "California", "Pala", M, "Tourmaline, kunzite, morganite, aquamarine, quartz",
    "$75 adult (12+), $60 ages 4–11, 0–3 free", "https://digforgems.com/oceanview-mine/", "Open by reservation on scheduled dig days.", "https://digforgems.com/frequently-asked-questions/")
add("graves-mountain", "Graves Mountain Rock Swap & Dig", "Georgia", "Lincoln County (near Lincolnton)", M, "Rutile, kyanite, lazulite, pyrophyllite",
    None, "https://agams.club/graves-mountain-rock-swap-and-dig-oct-2nd-4th-2026/", "FLAGGED: public access only on periodic club-hosted Rock Swap & Dig weekends (last: Oct 2–4, 2026); no operator site; next dates not posted.")
for i, s in enumerate(S): s["sort"] = (i + 1) * 10
if __name__ == "__main__":
    if "--json" in sys.argv:
        json.dump(S, open("data/pay-dig-sites.json", "w"), indent=1, ensure_ascii=False); print("-- json:", len(S))
    else:
        L = lambda v: "'" + str(v).replace("'", "''") + "'"
        cols = list(S[0].keys())
        print("insert into public.pay_dig_sites (" + ",".join(cols) + ") values\n" + ",\n".join("(" + ",".join(L(s[c]) for c in cols) + ")" for s in S)
              + "\non conflict (slug) do update set " + ",".join(f"{c}=excluded.{c}" for c in cols if c != "slug") + ";")
