"""What a Marketplace chat has beyond the price: sweeteners, hidden flaws, deadlines and reviews.

Shared by buying (engine.py) and selling (selling.py). No I/O in this file.
"""
import re
from statistics import mean
from typing import Optional

# ---- Sweeteners: terms other than money, each usable once per chat ----

# id: (label on the chip, what is said if nothing is typed, what the other side is told)
SWEETENERS = {
    "buy": {
        "cash": ("Cash, today", "I can pay cash, today.", "The buyer offers to pay cash today."),
        "pickup": ("Pick up now", "I can come pick it up right now.", "The buyer offers to come and collect it right away."),
        "shipping": ("Cover shipping", "I'll cover the shipping.", "The buyer offers to pay for shipping themselves."),
    },
    "sell": {
        "dropoff": ("Drop it off", "I can drop it off to you.", "The seller offers to drop it off at your place."),
        "hold": ("Hold it for you", "I'll hold it for you, no one else gets it.", "The seller offers to hold it for you only."),
        "anytime": ("Pickup any time", "Pick it up whenever suits you.", "The seller offers pickup at any time that suits you."),
    },
}
SWEETENER_BONUS = 1            # a sweetener lifts how persuasive the message was by this, up to the usual 2


def sweetener(mode: str, key: Optional[str]) -> Optional[tuple]:
    return SWEETENERS["sell" if mode == "sell" else "buy"].get(key or "")


def collects(scenario: dict) -> bool:
    """Whether the buyer comes and takes it away, as against a house, a ticket or a jet."""
    return "pickup" in str(scenario.get("setting") or "").lower()


def ships(scenario: dict) -> bool:
    """Whether the listing offers shipping at all, as against local pickup only."""
    return "shipping" in str(scenario.get("setting") or "").lower()


# ---- Hidden flaws: buying only. Found by asking, or found at pickup ----

FLAW_CHANCE = 0.35
# (the flaw, words that show the buyer asked about it, share of the resale value it costs,
#  what the item's title must mention for the flaw to fit, what in the title or description rules it out).
# An empty `fits` fits anything in the group. The first word names the flaw in the sold-listings hint ("bring up the battery").
_PHONE = ("iphone", "ipad", "macbook", "galaxy", "phone", "laptop")
_SCREEN = _PHONE + ("tv", "imac", "monitor", "ultrawide", "watch", "switch", "steam deck", "3ds", "vita", "psp", "ally")
_PAD = ("controller", "controllers", "dualsense", "joy-con", "gamepad", "remotes", "dualshock")
_DISC = ("ps1", "ps2", "ps3", "ps4", "ps5", "playstation", "gamecube", "xbox", "saturn", "dreamcast", "wii", "disc", "discs")
_CAR = ("honda", "ford", "toyota", "bmw", "jeep", "mazda", "lamborghini", "tesla", "cybertruck")
_CLOTHES = ("jacket", "jeans", "hoodie", "leggings", "fleece", "tote", "bag", "satchel", "boots", "slippers", "nuptse")
_SHOES = ("slides", "air max", "boots", "yeezy", "jordan", "new balance", "ugg", "dr. martens", "slippers")
_DRIFT = ("the left stick drifts", ("drift", "stick", "sticks", "controller", "joystick"), 0.15,
          _PAD + ("switch", "steam deck", "ally", "portal", "nintendo 64", "vr2"), ("drift", "microsd"))
_PAD_BATTERY = ("the battery barely holds a charge", ("battery", "charge", "charging", "hours"), 0.20,
                _PAD + ("switch lite", "3ds", "psp", "vita", "steam deck", "ally", "portal", "quest", "headset", "game boy"),
                ("battery",))
_BUTTONS = ("a couple of the buttons stick", ("buttons", "button", "sticky", "triggers", "trigger", "press"), 0.15, _PAD, ())
_SIGNED = ("the signature has no certificate and does not match their usual one",
           ("signature", "certificate", "coa", "authentic", "proof", "signed", "psa", "jsa", "autograph"), 0.50,
           ("signed",), ("coa",))
_FAKE_COA = ("the certificate is from a company known for selling fakes",
             ("certificate", "coa", "authentic", "authenticated", "signature", "proof", "psa", "jsa"), 0.50, ("coa",), ())
_FLAWS = {
    "tech": [
        ("the battery health is down to 76 percent", ("battery", "charge", "health"), 0.20,
         _PHONE + ("airpods", "watch", "vision", "quest", "glasses", "headphones"), ("battery", "hd 650", "open back")),
        ("there is a dead pixel near the top corner", ("screen", "pixel", "display"), 0.15, _SCREEN, ("crt",)),
        ("the charging port only works if you wiggle the cable", ("port", "charging", "usb", "cable"), 0.15,
         _PHONE + ("airpods", "wireless", "steam deck", "switch", "portal"), ("lightning",)),
        ("it runs hot and the fan gets loud", ("fan", "noise", "hot", "temperature", "temps", "loud"), 0.15,
         ("gaming pc", "rtx", "rx 580", "macbook", "i9", "steam deck", "ally"), ()),
        ("the left click sometimes double clicks", ("click", "clicks", "double", "button", "buttons", "switches"), 0.20,
         ("mouse",), ()),
        ("a couple of keys chatter and type twice", ("keys", "key", "switches", "chatter", "typing"), 0.15,
         ("keyboard", "stream deck"), ()),
        ("the left ear cup crackles at higher volume", ("sound", "audio", "crackle", "speaker", "volume", "ear"), 0.20,
         ("headset", "airpods max", "headphones"), ()),
        ("the lenses have fine scratches you see in bright scenes", ("lenses", "lens", "scratch", "scratches", "display"), 0.20,
         ("quest", "vr2", "index", "vision"), ()),
        ("the gas lift slowly sinks", ("lift", "height", "sink", "sinks", "piston", "cylinder"), 0.15, ("chair",), ()),
        ("the force feedback rattles", ("feedback", "force", "rattle", "motor", "wheel"), 0.15, ("racing wheel",), ()),
        ("a couple of the pins are bent", ("pins", "pin", "socket", "tested", "boots", "post"), 0.30, ("processor",), ()),
        ("there is faint burn-in from a news channel logo", ("burn", "burn-in", "panel", "oled", "hours", "screen"), 0.25,
         ("oled",), ()),
        ("the backlight has a dark patch in one corner", ("backlight", "panel", "screen", "patches", "uniformity"), 0.20,
         ("tv",), ("oled", "crt")),
        ("the woofer buzzes once you turn it up", ("bass", "woofer", "buzz", "volume", "sound", "loud"), 0.20,
         ("speaker", "speakers", "soundbar", "boombox", "soundlink"), ()),
        ("the tonearm will not return and the motor hums", ("tonearm", "arm", "motor", "speed", "hum", "play"), 0.20,
         ("turntable",), ()),
        ("the left channel cuts out until you tap it", ("channel", "left", "stereo", "sound", "audio", "crackle"), 0.25,
         ("walkman", "receiver"), ()),
        ("the fan rattles on the top setting", ("fan", "noise", "rattle", "loud", "settings"), 0.15, ("purifier", "purifiers"), ()),
        ("the filters are long overdue and it smells musty", ("filters", "filter", "smell", "replaced", "changed"), 0.15,
         ("purifier", "purifiers"), ("replaced",)),
        ("the battery only lasts about ten minutes", ("battery", "runtime", "charge", "minutes"), 0.25, ("vacuum",), ()),
        ("the steam wand sputters and the grinder jams", ("steam", "wand", "grinder", "descale", "descaled", "pressure"), 0.20,
         ("espresso",), ()),
        ("the picture has a pink tint in one corner", ("picture", "tint", "colour", "color", "convergence", "screen"), 0.20,
         ("crt", "trinitron"), ()),
    ],
    "console": [
        _DRIFT,
        ("the disc drive is loud and sometimes will not read", ("disc", "drive", "read", "noise", "loud"), 0.20,
         _DISC, ("digital", "no disc drive", "series s", "reads discs", "vita", "psp", "ally", "portal")),
        ("it was banned from online play", ("online", "ban", "banned", "account", "network"), 0.25,
         ("ps4", "ps5", "playstation 5", "xbox series", "xbox 360", "switch"), ()),
        _PAD_BATTERY,
        _BUTTONS,
        ("the controller ports are loose and drop the connection", ("ports", "port", "controller", "connection", "plug"), 0.15,
         ("nintendo 64", "gamecube", "super nintendo", "dreamcast"), ()),
    ],
    "accessory": [
        _DRIFT,
        _PAD_BATTERY,
        _BUTTONS,
        ("it throws read errors once it is about half full", ("errors", "error", "speed", "tested", "health", "full"), 0.30,
         ("ssd", "microsd", "expansion card"), ()),
    ],
    "games": [
        ("the disc has a deep scratch and freezes in one spot", ("disc", "scratch", "freeze", "play", "work", "tested"), 0.40,
         _DISC, ("cartridge", "code", "switch", "snes", "n64", "ds", "cards")),
        ("the save battery is dead, so it will not keep a save", ("save", "saves", "saving", "battery", "tested", "work"), 0.30,
         ("snes", "n64", "cartridge"), ()),
        ("the manual is a photocopy", ("manual", "complete", "original", "insert"), 0.25,
         ("complete", "manual", "boxed"), ("no manual", "cartridge only")),
    ],
    "vehicle": [
        ("the check engine light comes on now and then", ("engine", "light", "warning", "mechanic", "service"), 0.12,
         ("miles",), ("tesla", "cybertruck", "electric", "project")),
        ("the AC blows warm", ("aircon", "ac", "air", "cool", "cold", "a/c"), 0.06,
         _CAR, ("air conditioning", "project", "miata")),
        ("it has a salvage title", ("title", "accident", "salvage", "crash", "history"), 0.30,
         ("miles", "waverunner"), ("clean title", "salvage", "project")),
        ("the engine is not the one it left the factory with", ("numbers", "matching", "engine", "original", "block", "history"), 0.30,
         ("ferrari 250", "gullwing", "mclaren f1", "boss 429"), ()),
        ("the rear derailleur skips gears", ("gears", "gear", "shifting", "derailleur", "chain", "service"), 0.12,
         ("mountain bike", "radrunner"), ()),
        ("the battery only holds about half its range", ("battery", "range", "charge", "miles"), 0.25,
         ("electric bike", "radrunner"), ()),
    ],
    "fashion": [
        ("there is a small stain inside that will not come out", ("stain", "mark", "clean", "wash"), 0.20, _CLOTHES, ()),
        ("the zipper sticks", ("zip", "zipper", "zips"), 0.12,
         ("jacket", "jeans", "fleece", "nuptse", "satchel", "tote"), ()),
        ("the authenticity card and receipt are missing", ("receipt", "authentic", "card", "real", "fake", "legit"), 0.25,
         ("louis vuitton", "hermès", "hermes", "coach", "supreme", "yeezy", "jordan", "kate spade", "michael kors"),
         ("dupe", "inspired")),
        ("the soles are worn far more than the photos show", ("soles", "sole", "wear", "worn", "tread"), 0.20, _SHOES, ()),
    ],
    "jewelry": [
        ("the clasp is loose", ("clasp", "lock", "loose", "secure"), 0.15,
         ("chain", "bracelet", "necklace", "pearls"), ("love bracelet",)),
        ("the plating is wearing through in places", ("plating", "plated", "solid", "wear", "tarnish", "karat", "gold"), 0.35,
         ("gold",), ("rolex", "cartier", "van cleef")),
        ("it runs a few minutes fast every day", ("accuracy", "accurate", "time", "keeps", "service", "serviced"), 0.15,
         ("seiko", "rolex", "automatic", "patek", "nautilus"), ()),
        ("the certificate belongs to a different stone", ("certificate", "gia", "report", "inscription", "grading"), 0.50,
         ("gia",), ()),
        ("one of the stones is loose in its setting", ("stones", "stone", "setting", "diamond", "loose", "prongs"), 0.20,
         ("diamond", "ring", "tennis"), ()),
    ],
    "fragrance": [
        ("it was stored in a hot car and smells off", ("smell", "stored", "heat", "batch", "fresh", "old"), 0.40, (), ()),
        ("the bottle is about a third emptier than it looks", ("level", "full", "left", "much", "used", "ml"), 0.30,
         (), ("half full", "partials")),
    ],
    "tickets": [
        ("the seats are partial view behind a speaker stack", ("view", "seats", "see", "stage", "obstructed"), 0.30,
         (), ("floor", "pit", "ga", "general admission", "lakers")),
    ],
    "outdoor": [
        ("one of the tent poles is cracked and taped up", ("poles", "pole", "tent", "setup", "pitched", "broken"), 0.20,
         ("tent",), ("rooftop",)),
        ("the rainfly leaks at the seams in a downpour", ("rain", "waterproof", "leak", "leaks", "seams", "fly", "rainfly"), 0.20,
         ("tent",), ()),
        ("the lid gasket is torn, so ice melts in a day", ("ice", "gasket", "seal", "lid", "cold"), 0.20, ("cooler",), ()),
        ("the burner only lights with a lighter", ("igniter", "ignite", "light", "lights", "burner", "flame"), 0.10,
         ("stove", "jetboil"), ("solo stove",)),
        ("the base has rusted through in one spot", ("rust", "rusted", "base", "condition"), 0.15, ("solo stove",), ()),
        ("the hip belt buckle is cracked", ("buckle", "belt", "straps", "strap", "hip"), 0.12, ("backpack",), ()),
        ("the down has clumped and it no longer keeps you warm", ("down", "warm", "loft", "clumped", "rating", "washed"), 0.30,
         ("sleeping bag",), ()),
        ("there is a slow leak somewhere in the seams", ("leak", "air", "pressure", "inflate", "holds", "pump"), 0.30,
         ("paddle board", "inflatable"), ()),
        ("the battery has lost about half its capacity", ("battery", "capacity", "charge", "cycles", "hours"), 0.25,
         ("power station", "inreach"), ()),
        ("one of the chairs has a torn seat", ("seat", "torn", "tear", "fabric", "chairs"), 0.15, ("chairs",), ()),
        ("the cover zipper is broken and the hinge is stiff", ("zipper", "zip", "hinge", "cover", "open", "opens"), 0.15,
         ("rooftop tent",), ()),
    ],
    "flowers": [
        ("a third of the roses are already wilting at the edges", ("freshness", "fresh", "wilting", "wilt", "cut", "picked", "today"), 0.35,
         ("roses", "ramo", "ramo buchón", "peonies", "sunflower"), ("preserved", "eternal", "dinero")),
        ("several of the preserved roses have faded to brown", ("colour", "color", "faded", "fade", "preserved", "last"), 0.30,
         ("preserved", "eternal"), ()),
        ("a few of the bills are prop money", ("bills", "real", "fake", "money", "prop", "cash"), 0.50, ("dinero",), ()),
    ],
    "food": [
        ("the tins are past their best-by date", ("date", "dates", "expiry", "expires", "best", "fresh", "harvest"), 0.30,
         ("tin", "tins"), ()),
        ("the bamboo whisk has a few snapped tines", ("whisk", "chasen", "tines", "broken", "kit"), 0.15, ("kit",), ()),
        ("there is a hairline crack in the glaze", ("crack", "cracks", "chip", "glaze", "hairline", "condition"), 0.30,
         ("chawan", "bowl"), ("kit",)),
    ],
    "music": [
        ("the record is warped and skips on one track", ("warp", "warped", "skip", "skips", "play", "plays", "graded"), 0.30,
         ("vinyl", "lp", "pressing", "45", "record"), ()),
        _SIGNED,
        _FAKE_COA,
        ("the print is cracked far worse than the photos show", ("print", "cracking", "cracked", "crack", "photos"), 0.20,
         ("shirt", "tee", "hoodie", "jersey", "jacket"), ("cracked", "cracking", "embroidered", "no jacket required")),
        ("it is a modern reprint, not an original", ("tag", "tags", "reprint", "original", "stitch", "real", "vintage"), 0.50,
         ("vintage",), ()),
    ],
    "collectible": [
        ("the box has a crushed corner the photos hide", ("box", "corner", "condition", "photos", "mint"), 0.15,
         ("boxed", "box", "carded"), ()),
        ("two of the accessory hands and a head are missing", ("accessories", "accessory", "complete", "hands", "heads", "pieces"), 0.25,
         ("hot toys",), ()),
        ("the slab is cracked and the label looks tampered with", ("slab", "case", "label", "cert", "graded", "cgc", "psa"), 0.40,
         ("cgc", "psa"), ()),
        _SIGNED,
        _FAKE_COA,
        ("the lights and sounds stopped working", ("lights", "sounds", "electronics", "batteries", "works", "work"), 0.25,
         ("electronic", "with lights"), ()),
        ("the paint is chipped on the back", ("paint", "chip", "chips", "finish", "back"), 0.15, ("shield",), ()),
        ("the tag is a reproduction", ("tag", "tags", "real", "fake", "authentic", "original"), 0.60, ("beanie",), ()),
    ],
    "property": [
        ("the roof is at the end of its life and leaks in heavy rain", ("roof", "leak", "leaks", "inspection", "water"), 0.04,
         (), ("condo", "penthouse", "silo", "rebuilt", "roof restored")),
        ("there are foundation cracks in the basement", ("foundation", "cracks", "crack", "basement", "settling", "structural", "inspection"), 0.08,
         (), ("condo", "penthouse", "silo")),
        ("the sewer line is cracked and needs replacing", ("sewer", "plumbing", "pipes", "drain", "septic", "inspection"), 0.03,
         (), ("condo", "penthouse", "silo")),
        ("there is mould behind the bathroom walls", ("mould", "mold", "damp", "moisture", "water", "inspection"), 0.05, (), ()),
        ("the addition was built without permits", ("permits", "permit", "addition", "legal", "city", "code"), 0.06,
         (), ("condo", "penthouse", "silo", "château")),
        ("the building has a large special assessment coming", ("assessment", "hoa", "fees", "building", "association", "dues"), 0.05,
         ("condo", "penthouse"), ()),
        ("the air filtration and blast doors need a full rebuild", ("filtration", "air", "doors", "systems", "maintenance", "inspection"), 0.15,
         ("silo",), ()),
    ],
    "mobile": [
        ("the subfloor is soft near the bathroom", ("subfloor", "floor", "soft", "water", "leak", "bathroom"), 0.15,
         ("mobile home", "double-wide", "single-wide", "tiny house", "trailer"), ()),
        ("the park is raising lot rent by 40 percent next year", ("rent", "lot", "park", "fees", "increase"), 0.20, ("park",), ()),
        ("there is water damage behind the walls from a roof leak", ("roof", "leak", "leaks", "water", "damage", "seals"), 0.15,
         ("airstream", "motorhome", "westfalia", "bus", "trailer", "camper"), ()),
        ("the generator needs a full rebuild", ("generator", "power", "hours", "service"), 0.08, ("motorhome", "bus"), ()),
    ],
    "land": [
        ("there is no legal road access, only an informal easement", ("access", "road", "easement", "legal", "driveway"), 0.30,
         ("acres", "acre", "lot"), ("island", "moon", "downtown", "parking", "ranch", "vineyard")),
        ("the well test came back dry", ("well", "water", "drill", "drilling", "rights"), 0.25,
         ("acres", "homestead", "desert"), ("water rights", "well drilled", "vineyard", "island")),
        ("the perc test failed, so no septic can go in", ("perc", "percolation", "septic", "buildable", "build", "permit"), 0.30,
         ("homestead", "wooded", "desert"), ()),
        ("part of it sits in a flood zone", ("flood", "flooding", "zone", "insurance", "creek", "river"), 0.20,
         (), ("desert", "moon", "ridge")),
        ("the city just capped building height on the block", ("zoning", "zoned", "height", "tower", "city", "permits"), 0.35,
         ("zoned",), ()),
        ("the deed has no legal standing anywhere on Earth or off it", ("deed", "legal", "real", "ownership", "title"), 0.90,
         ("moon",), ()),
    ],
    "vessel": [
        ("the engines are overdue for a major overhaul", ("engines", "engine", "hours", "overhaul", "service", "survey"), 0.15,
         ("yacht", "superyacht", "sundancer", "cruiser"), ("submarine",)),
        ("there is osmosis blistering below the waterline", ("hull", "blisters", "osmosis", "survey", "waterline"), 0.15,
         ("yacht", "superyacht", "sundancer", "cruiser", "sailboat"), ("submarine",)),
        ("the logbooks have a two-year gap", ("logbooks", "logs", "logbook", "records", "history", "maintenance"), 0.20,
         ("cessna", "cirrus", "helicopter", "jet"), ()),
        ("it is due a heavy inspection that costs a fortune", ("inspection", "check", "heavy", "maintenance", "due", "hours"), 0.12,
         ("cessna", "cirrus", "helicopter", "jet"), ()),
        ("the pressure hull is overdue for recertification", ("certification", "certified", "hull", "rated", "depth", "inspection"), 0.30,
         ("submarine",), ()),
    ],
    "art": [
        ("there is a gap in its provenance during the war years", ("provenance", "history", "ownership", "records", "papers"), 0.40,
         ("painting", "violin", "egg", "gutenberg", "screenprint"), ()),
        ("it has had far more restoration than the listing says", ("restoration", "restored", "condition", "repairs", "report"), 0.30,
         ("painting", "violin", "egg", "screenprint", "gutenberg"), ()),
        ("the coin has been cleaned, which hurts its value", ("cleaned", "cleaning", "condition", "graded", "grade", "toning"), 0.40,
         ("coin",), ()),
        ("the stamp has a thin spot on the back", ("thin", "back", "condition", "certificate", "gum"), 0.35, ("stamp",), ()),
        ("a lot of the bones are casts, not real fossil", ("bones", "casts", "cast", "real", "original", "complete"), 0.40,
         ("skeleton",), ()),
        ("the classification paperwork is missing", ("classification", "paperwork", "certificate", "authentic", "lab"), 0.40,
         ("meteorite",), ()),
        ("one of the original chips was swapped for a modern part", ("chips", "original", "parts", "replaced", "authentic"), 0.30,
         ("apple-1",), ()),
        ("the photo match is disputed by the leading authenticator", ("photo", "match", "matched", "authentic", "letter", "loa", "worn"), 0.50,
         ("game-worn",), ()),
        ("it is not the first printing, just a first edition", ("printing", "printings", "first", "edition", "print", "line"), 0.60,
         ("first edition",), ()),
    ],
    "business": [
        ("the books overstate how much cash it takes in", ("books", "revenue", "profit", "financials", "taxes", "numbers", "income"), 0.30,
         (), ("team", "franchise")),
        ("the lease runs out next year with no renewal", ("lease", "landlord", "rent", "renewal", "term"), 0.30,
         ("laundromat", "bar"), ()),
        ("the underground tanks need replacing", ("tanks", "tank", "environmental", "inspection", "leak", "epa"), 0.25,
         ("gas station",), ()),
        ("the permits do not transfer to a new owner", ("permits", "permit", "licence", "license", "health", "city"), 0.25,
         ("taco truck", "bar"), ()),
        ("the ballpark lease is up and the city wants it rebuilt", ("lease", "stadium", "ballpark", "arena", "city", "venue"), 0.15,
         ("team",), ()),
        ("the arena lease is up and the city wants a new one built", ("lease", "stadium", "arena", "city", "venue"), 0.10,
         ("franchise",), ()),
        ("the snowmaking system is failing", ("snowmaking", "snow", "lifts", "lift", "equipment", "maintenance"), 0.15,
         ("ski resort",), ()),
    ],
    "general": [
        ("there is a scuff the photos do not show", ("scuff", "scratch", "marks", "dent", "photos"), 0.10, (), ("cards",)),
        ("it smells strongly of smoke", ("smoke", "smell", "smoker", "pets", "pet"), 0.20, (), ()),
        ("one piece is missing", ("pieces", "missing", "complete", "included", "everything", "parts"), 0.15,
         ("lot", "set", "kit", "complete", "collection", "pair", "pack", "bundle", "with"), ()),
    ],
}
# A sealed box can only hide one thing: it is not as sealed as it looks
_SEALED_FLAW = ("it was opened and resealed", ("seal", "sealed", "resealed", "opened", "unopened", "wrap"), 0.20)
_FLAW_GROUP = {
    "PC and gear": "tech", "Apple and phones": "tech", "Consoles": "console", "Controllers and accessories": "accessory",
    "Bundles": "games", "Games": "games", "Vehicles": "vehicle", "Bags": "fashion", "Clothing and shoes": "fashion",
    "Dupes": "fashion", "Jewelry": "jewelry", "Fragrance": "fragrance", "Tickets": "tickets",
    "TV and audio": "tech", "Home and appliances": "tech", "Camping and outdoors": "outdoor",
    "Flowers and ramos": "flowers", "Matcha and tea": "food", "Music and merch": "music",
    "Marvel and comics": "collectible", "Home and collectables": "collectible", "Fun stuff": "collectible",
    "Homes": "property", "Mobile homes and RVs": "mobile", "Land": "land", "Yachts and aircraft": "vessel",
    "Art and rare finds": "art", "Businesses": "business",
}
# Where to look when nothing in the item's own group fits. A ticket has nothing else to hide.
_FLAW_FALLBACK = {"console": ("tech", "general"), "accessory": ("tech", "general"), "tickets": (), "flowers": (), "food": (),
                  "property": (), "land": (), "mobile": ("vehicle", "general"), "art": ("collectible",), "business": ()}
# Asking straight out whether anything is wrong finds any flaw
_ANY_FLAW = ("problem", "issue", "wrong", "flaw", "defect", "damage", "damaged", "catch", "honest", "broken", "faults", "fault")


def _mentions(text: str, phrases) -> bool:
    return any(re.search(rf"(?<![a-z0-9]){re.escape(p)}(?![a-z0-9])", text) for p in phrases)


def _fitting_flaws(scenario: dict) -> list:
    """The flaws that could be true of this listing: none of a disc drive on a controller,
    or a salvage title on a bike."""
    item = str(scenario.get("item") or "").lower()
    text = f"{item} {scenario.get('description') or ''}".lower()
    if scenario.get("condition") == "For parts":
        return []           # already sold as broken: nothing left to hide
    group = _FLAW_GROUP.get(scenario.get("category") or "", "general")
    if group != "food" and (scenario.get("condition") == "New" or _mentions(item, ("sealed",))):
        return [_SEALED_FLAW]
    for name in (group, *_FLAW_FALLBACK.get(group, ("general",))):
        fitting = [f[:3] for f in _FLAWS[name] if (not f[3] or _mentions(item, f[3])) and not _mentions(text, f[4])]
        if fitting:
            return fitting
    return []


def deal_flaw(scenario: dict, rng) -> Optional[dict]:
    if rng.random() >= FLAW_CHANCE:
        return None
    fitting = _fitting_flaws(scenario)
    if not fitting:
        return None
    text, words, loss = rng.choice(fitting)
    return {"text": text, "words": list(words), "loss": loss, "revealed": False}


def asks_about(flaw: Optional[dict], message: str) -> bool:
    """Whether the buyer's message asks about the flaw, or about flaws at all."""
    if not flaw or flaw.get("revealed"):
        return False
    said = set(re.findall(r"[a-z/]+", message.lower()))
    return bool(said & set(flaw["words"]) or said & set(_ANY_FLAW))


def flaw_hint(flaw: Optional[dict]) -> str:
    """What sold listings say: where to look, without saying what is wrong."""
    if not flaw:
        return "These look clean: nothing commonly goes wrong with them."
    return f"People who bought these often bring up the {flaw['words'][0]}. Worth asking about."


SCAM_WARNING = 0.6            # a price under this share of the going rate gets a warning in sold listings


def sold_listings(state: dict) -> str:
    """Checking sold listings: what one in good shape sells for, and what tends to go wrong."""
    value = state.get("value")
    flaw = state.get("flaw")
    if value and flaw and flaw.get("revealed"):
        # The flaw already knocked this one's worth down; sold listings show the going rate
        value = round(value / (1 - flaw["loss"]))
    going = f"Similar ones sell for about ${int(value):,}. " if value else ""
    if value and state.get("list_price") and state["list_price"] < value * SCAM_WARNING:
        # Far under the going rate: either a seller who has no idea, or bait
        going += "Listings this far under the going rate are often scams. "
    return going + flaw_hint(flaw)


# ---- Scams: buying only. A few known scammers list bait, and have nothing to sell ----

SCAM_RATING = (1.1, 2.6)       # the stars on a scammer's account, from a handful of ratings
SCAM_RATINGS = (2, 9)
SCAM_JOINED = (2025, 2026)     # new accounts: the old ones got banned
# How the scammer means to get paid without handing anything over. Each scam listing names one...
_SCAM_PAYMENT = {
    "deposit": "Once they seem keen, ask for a deposit to hold it, sent outside the app by Zelle or wire, before anyone sees it.",
    "shipping": "Say you are away, out of state, so it has to go through a shipping company once they pay in full up front. You cannot meet.",
    "giftcards": "Ask to be paid in gift cards, Cash App or crypto instead of through the app, with a vague reason: fees, or the app glitching on your account.",
}
# ...and one of these to stop them checking first
_SCAM_COVER = {
    "nomeet": "Never agree to meet in person, show it on a video call or send new photos. Always have an excuse.",
    "urgency": "Say several other people want it and the first to pay gets it. Push them to decide now.",
}


def scam_lines(scam: Optional[dict]) -> list:
    """The model's secret, told only to a scammer."""
    if not scam:
        return []
    return [
        "SECRET: you are a scammer posing as this seller. You do not have the item. Your only goal is to get paid "
        "before the buyer can check anything, then disappear.",
        _SCAM_PAYMENT.get(scam["payment"], ""),
        _SCAM_COVER.get(scam["cover"], ""),
        "If they ask to meet, see it, video call, or for a serial number, receipt or more photos, dodge it with an "
        "excuse. Never admit any of this. Stay friendly and believable, and keep your personality.",
    ]


# ---- Deadlines: buying only. Some sellers have to be rid of it soon ----

DEADLINE_ROUNDS = 6
DEADLINE_SLIDE = 0.06          # each round the seller's resistance drops by this, as the clock runs down
DEADLINE_RIVAL = 0.10          # from the third round, the chance each round that someone else buys it first
_DEADLINE = re.compile(r"\b(tonight|today|friday|thursday|this week|moving|must go|leaving|movers|asap)\b", re.I)


def has_deadline(scenario: dict) -> bool:
    if scenario.get("category") == "Tickets":
        return True
    text = " ".join(str(scenario.get(k) or "") for k in ("item", "persona", "description", "opening"))
    return bool(_DEADLINE.search(text))


# ---- Unhinged characters: a friend with a sailor's mouth ----

SWEARING = (
    "You have a sailor's mouth: swear freely and casually in nearly every message (fuck, shit, damn, hell, "
    "bastard and the like), the way some friends talk. It is for colour and comedy, never aimed at the other "
    "person as an insult, and never a slur or anything hateful. You are still friendly underneath."
)


CLEAN_SWEARING = (
    "You are loud, colourful and dramatic, but the player has asked for clean language: no swearing at all. "
    "Say heck, dang or freaking instead."
)


# Some characters are written to be cutting, or to say the same thing again. For them, the jabs and
# the stock lines are the character, so the prompt allows them and tidy_reply leaves them in.
RUDE = (
    "Your personality lets you be cutting: a dry jab or a bit of attitude when they lowball, nag or "
    "waste your time is in character. Keep it to the haggle. Nothing hateful, no threats, nothing about who they are."
)
REPEATS = (
    "You have a stock line or two, as your personality says, and you keep coming back to them. "
    "Saying the same thing again is in character for you."
)


def manner(character: dict) -> list[str]:
    """The extra lines for a character written to be rude or to repeat themselves, or nothing."""
    return [line for key, line in (("rude", RUDE), ("repeats", REPEATS)) if character.get(key)]


def swearing(scenario: dict, clean: bool = False) -> list[str]:
    """The extra line for a character who swears, or nothing for everyone else. With `clean`, the
    player's Marketplace setting, they keep their energy and lose the language."""
    if not scenario.get("swears"):
        return []
    return [CLEAN_SWEARING if clean else SWEARING]


# ---- Reviews: after every chat, the other side may rate you ----

REVIEWS_KEPT = 50
TRUST_MIN_REVIEWS = 3
TRUST_LOW = 3.5                # below this average, people have one less patience with you
TRUST_HIGH = 4.7               # at or above it, one more
_REVIEW_TEXT = {
    5: "Smooth deal. Would trade again.",
    4: "Good trade.",
    3: "Haggled hard, but we got there.",
    2: "Backed out after we agreed.",
    1: "Rude and wasted my time.",
}


def review(state: dict) -> Optional[dict]:
    """The stars the other side leaves when a chat ends, or None if they would not bother."""
    result = state.get("result") or {}
    outcome = result.get("outcome")
    if state.get("scam"):
        return None             # a scammer has better things to do than rate you
    log = state.get("log") or []
    insults = sum(1 for e in log if e.get("insulted"))
    agreed = bool(log and log[-1].get("agreed")) or (state.get("opening_agreed") and not log)
    if outcome in ("deal", "sold"):
        stars = 5 - min(2, insults) - (1 if state.get("bluffed") else 0)
        stars = max(3, stars)
    elif outcome in ("walked", "kept"):
        if agreed:
            stars = 2
        elif insults >= 2:
            stars = 1
        elif insults:
            stars = 3
        else:
            return None
    else:
        return None
    return {"stars": stars, "text": _REVIEW_TEXT[stars], "by": state["scenario"].get("merchant") or "Someone"}


def rating(reviews: list) -> Optional[float]:
    return round(mean(r["stars"] for r in reviews), 1) if reviews else None


def trust_bonus(reviews: list) -> int:
    """How your reviews change the patience people have with you."""
    if len(reviews) < TRUST_MIN_REVIEWS:
        return 0
    score = rating(reviews) or 0
    return 1 if score >= TRUST_HIGH else -1 if score < TRUST_LOW else 0


# ---- The listing's own downsides, as arguments the buyer can make ----
# Small models score a fair point low once they have decided to hold their price, so a buyer who
# points at a downside the listing itself admits to is credited in code. Each entry: what to call it,
# what in the listing makes it a downside, what a buyer says to bring it up, and whether "no"/"never"
# in front of it in the listing turns it into a selling point ("no scratches").
_DOWNSIDES = (
    ("the missing box",
     r"\bno (original )?box\b|\bwithout (the |its |a )?(original )?box\b|\bbox (is )?(not included|missing)\b",
     r"\bbox(es)?\b", False),
    ("the stick drift", r"\bdrift", r"\bdrift", True),
    ("the scratches", r"\bscratch|\bscuff", r"\bscratch|\bscuff", True),
    ("the dents", r"\bdent(s|ed)?\b", r"\bdent", True),
    ("the cracks", r"\bcrack|\bchipped\b", r"\bcrack|\bchip", True),
    ("the wear", r"\bworn\b|\bwear\b|\bfad(ed|ing)\b|\bpeel|\bcreas", r"\bworn\b|\bwear\b|\bfad(e|ed|ing)\b|\bpeel|\bcreas", True),
    ("the stains", r"\bstain", r"\bstain", True),
    ("the tears", r"\btorn\b|\bripped\b|\brips?\b", r"\btorn\b|\bripped\b|\brips?\b|\btears?\b", True),
    ("the noise", r"\brattl|\bloud\b|\bnois|\bsqueak|\bbuzz", r"\brattl|\bloud\b|\bnois|\bsqueak|\bbuzz|\bfans?\b", True),
    ("its age", r"\blaunch (model|edition|unit|day)\b|\bfirst gen|\byears? old\b|\bolder (model|one)\b",
     r"\blaunch\b|\bold\b|\bolder\b|\bage\b|\byears?\b|\bfirst gen|\boutdated\b", False),
    ("what is missing",
     r"\bmissing\b|\bnot included\b|\bno (charger|cables?|case|manual|remote|stand|controller|dust bag|papers|receipt)\b",
     r"\bmissing\b|\bnot included\b|\bdoes(n'?t| not) come with\b|\bno (charger|cables?|case|manual|remote|stand|controller|dust bag|papers|receipt)\b|\bwithout (a |the )?(charger|cables?|case|manual|remote|stand|receipt|papers)\b",
     False),
    ("the fault", r"\bdoes(n'?t| not) work|\bnot working\b|\bbroken\b|\bdead pixel|\bburn-?in\b|\bfaulty\b|\bglitch|\bflicker",
     r"\bdoes(n'?t| not) work|\bnot working\b|\bbroken\b|\bdead pixel|\bburn-?in\b|\bfaulty\b|\bglitch|\bflicker", True),
    ("the repairs", r"\brepair|\breplaced\b|\baftermarket\b|\bnot original\b", r"\brepair|\breplaced\b|\baftermarket\b|\bnot original\b", True),
    ("the smell", r"\bsmok(e|er|ing)\b(?!-free)|\bsmell|\bodou?r", r"\bsmok|\bsmell|\bodou?r", True),
)
_NEGATED = re.compile(r"\b(no|not|never|zero|without|free of|none)\b[^.,;]{0,20}$")
_WEAK_CONDITIONS = {"Used - Fair": r"\bfair\b|\bcondition\b|\bused\b", "For parts": r"\bparts\b|\bcondition\b|\bbroken\b"}
CITED_MIN_WORDS = 3            # "no box?" is a fair point; "box" alone is not an argument


def _admits(pattern: str, text: str, negatable: bool) -> bool:
    """The listing says this, as a downside: "light scratches", not "no scratches"."""
    for m in re.finditer(pattern, text, re.I):
        if not negatable or not _NEGATED.search(text[:m.start()].lower()):
            return True
    return False


def cited_downsides(scenario: dict, flaw: Optional[dict], message: str, already: list) -> list[str]:
    """The downsides the listing admits to that the buyer's message brings up, not counting any credited before."""
    if len(message.split()) < CITED_MIN_WORDS:
        return []
    listing = " ".join(str(scenario.get(k) or "") for k in ("item", "description"))
    said = message.lower()
    found = [
        label for label, admitted, raised, negatable in _DOWNSIDES
        if _admits(admitted, listing, negatable) and re.search(raised, said)
    ]
    weak = _WEAK_CONDITIONS.get(scenario.get("condition") or "")
    if weak and re.search(weak, said):
        found.append("its condition")
    if flaw and flaw.get("revealed") and set(re.findall(r"[a-z/]+", said)) & set(flaw["words"]):
        found.append("the flaw")
    return [f for f in found if f not in already]


# ---- Keeping the model's reply in line ----
# The model writes the reply and judges the message at once, and its own earlier lines are fed back
# to it, so a single insult or stock phrase gets copied round after round. Both are cut before saving.
_INSULTS = re.compile(
    r"\b(whin(y|ier|iest|ing|e|er|ers)|cheapskates?|annoying|pathetic|stupid|idiot\w*|dumb|clowns?|losers?|"
    r"entitled|greedy|grow up|get lost|stop being|desperate|beggars?|choosy)\b",
    re.I,
)
_SENTENCES = re.compile(r"(?<=[.!?])\s+")


def _gist(sentence: str) -> str:
    """A sentence with its prices and punctuation stripped, to spot one said before."""
    sentence = re.sub(r"\{price\}|\$[\d,]+(\.\d+)?", "#", sentence.lower())
    return " ".join(re.findall(r"[a-z#']+", sentence))


def tidy_reply(text: str, earlier: list[str], fallbacks: tuple[str, ...], character: Optional[dict] = None) -> str:
    """The reply without insults or sentences already said in this chat, except from a character
    written to be rude or to repeat themselves. If nothing is left, one of `fallbacks` the chat has not had yet."""
    character = character or {}
    said = set() if character.get("repeats") else {_gist(s) for line in earlier for s in _SENTENCES.split(line or "")}
    insults = None if character.get("rude") else _INSULTS
    kept = [s for s in _SENTENCES.split(text) if s and not (insults and insults.search(s)) and _gist(s) not in said]
    if kept:
        return " ".join(kept)
    unused = [f for f in fallbacks if _gist(f) not in said]
    return (unused or fallbacks)[0] if text or fallbacks else text


_HOLDING = re.compile(
    r"\{price\}|\$\d|\b(stick|firm|final|not (lowering|moving|budging|going lower)|won'?t (go|budge|move)|stays?|holding|as good as it gets|"
    r"minor|no big deal|not a big deal|does(n'?t| not) matter|barely|hardly)\b",
    re.I,
)


def without_holding(text: str, filler: tuple[str, ...] = ()) -> str:
    """The reply without the sentences that keep the price where it was or play the point down,
    for when the game moves it anyway. `filler` lines go too: the point is owned instead."""
    return " ".join(s for s in _SENTENCES.split(text) if s and not _HOLDING.search(s) and s not in filler)
