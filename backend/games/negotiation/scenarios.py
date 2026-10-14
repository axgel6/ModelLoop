"""What is for sale in the Negotiation game.

Every scenario is a listing on an online marketplace and the seller behind it.
The buyer only ever talks to the seller by message. `opening` is the seller's
reply to the buyer's first "is this still available?", and it names the price
as {price}. No I/O in this file.
"""

LIKE_NEW = "Used - Like New"
GOOD = "Used - Good"
FAIR = "Used - Fair"
NEW = "New"
PARTS = "For parts"


def _listing(id, item, price, condition, seller, persona, description, opening, delivery="Local pickup"):
    return {
        "id": id, "item": item, "list_price": price, "condition": condition,
        "merchant": seller, "persona": persona, "description": description, "opening": opening,
        "setting": f"Marketplace · {delivery}",
    }


SCENARIOS = [
    # ---- Graphics cards and PC parts ----
    _listing(
        "rtx5090", "NVIDIA GeForce RTX 5090 Founders Edition", 2650, LIKE_NEW, "Derek",
        "knows exactly how scarce these are, slightly smug, ignores anyone who opens with a lowball",
        "Bought at launch, used for three months in a smoke-free build. Never mined on, never overclocked. Comes with the original box, the power adapter and the receipt. Selling because I went back to a smaller case.",
        "Yes it's available. Three months old, box and receipt included. {price}, and I know what these go for.",
    ),
    _listing(
        "rtx4070s", "ASUS Dual RTX 4070 Super 12GB", 470, LIKE_NEW, "Nina",
        "friendly and practical, upgraded and just wants the old card gone, answers quickly",
        "Eight months old, ran cool and quiet in a well ventilated case. Original box and anti-static bag. Can show it running benchmarks before you buy.",
        "Hi! Still here. Works perfectly, I can show you benchmarks at pickup. {price}.",
    ),
    _listing(
        "rtx3080", "EVGA RTX 3080 FTW3 Ultra 10GB", 360, GOOD, "Wes",
        "honest to a fault, admits it was in a mining rig, defensive when people use that against him",
        "Was in a mining rig for about a year, then my gaming PC. Thermal pads and paste were replaced in the spring and temperatures are good. No box. Fans are original and spin quietly.",
        "Still available. I'll be upfront, it mined for a year, but I repasted it and temps are great. {price}.",
    ),
    _listing(
        "rx580", "Sapphire Pulse RX 580 8GB", 55, FAIR, "Colby",
        "a teenager funding a new build, eager, replies within seconds, easily rattled",
        "My first graphics card. Still runs esports games fine at 1080p. One fan rattles a little at high speed. Dusty but working. Card only.",
        "yeah still got it! works good, one fan is kinda loud tho. {price}",
    ),
    _listing(
        "ryzen7800x3d", "AMD Ryzen 7 7800X3D processor", 320, LIKE_NEW, "Farah",
        "precise and unhurried, writes in full sentences, will not hold items without a deposit",
        "Used for five months, never delidded or overclocked. Pins and pads are spotless. Comes in the original box with the clamshell. No cooler included.",
        "Hello, yes it is available. Five months of light use, original packaging. I am asking {price}.",
        "Pickup or shipping",
    ),
    _listing(
        "gamingpc", "Gaming PC: Ryzen 5 5600, RTX 3060, 16GB RAM", 640, GOOD, "Trey",
        "built it himself and is proud of it, lists the parts unprompted, hurt by any criticism of the cable management",
        "Custom build from 2022. Ryzen 5 5600, RTX 3060 12GB, 16GB DDR4, 1TB NVMe, 650W Gold power supply, glass side panel with RGB fans. Fresh Windows install. Tower only, no monitor or peripherals.",
        "Still available! Built it myself, runs everything at 1080p high. Tower only. {price}.",
    ),
    _listing(
        "highendpc", "High-end gaming PC: i9-13900K, RTX 4080", 1850, LIKE_NEW, "Anders",
        "an engineer who over-researched every part, firm, mildly insulted by offers that ignore the parts list",
        "Intel i9-13900K, RTX 4080 16GB, 64GB DDR5, 2TB NVMe, 360mm liquid cooler, 1000W Platinum power supply in a Lian Li O11. Built last year, used for work and some gaming. All boxes included.",
        "It's available. Full parts list is in the description and I have every box. {price} is already below what the parts cost.",
    ),
    _listing(
        "monitor1440", "LG UltraGear 27-inch 1440p 165Hz monitor", 180, GOOD, "Hannah",
        "easygoing, moving to a smaller flat, mentions the one flaw before you ask",
        "27 inches, 1440p, 165Hz, IPS. One dead pixel near the bottom left corner that I stopped noticing in a week. Comes with the stand, power brick and a DisplayPort cable. No box.",
        "Hey, yep still for sale. There is one dead pixel in the corner, otherwise perfect. {price}.",
    ),
    _listing(
        "oledultrawide", "Alienware AW3423DW 34-inch QD-OLED ultrawide", 520, GOOD, "Raj",
        "enthusiastic about display tech, will explain OLED care at length, nervous about shipping it",
        "34-inch curved QD-OLED, 175Hz. No burn-in, I ran the pixel refresh regularly and can send a photo of a grey screen. Original box and stand. Local pickup only, I am not shipping a panel this size.",
        "Still available! No burn-in at all, happy to send test photos. Pickup only. {price}.",
    ),
    _listing(
        "g502", "Logitech G502 Hero gaming mouse", 28, GOOD, "Ben",
        "relaxed student, selling small stuff before moving, not going to argue long over a mouse",
        "Wired G502 Hero. All buttons and the scroll wheel work. Includes the extra weights and the case for them. Mouse feet are worn and the cable has a slight kink near the plug.",
        "yeah it's available. works fine, comes with the weights. {price}",
    ),
    _listing(
        "g502x", "Logitech G502 X Plus wireless mouse, white", 85, LIKE_NEW, "Yuki",
        "tidy and exact, kept every accessory, replies politely but briefly",
        "Used for two months and then I switched to a lighter mouse. Includes the dongle, extender, charging cable and box. No shine on the buttons, battery life is as new.",
        "Hello, it is still available. Two months old with everything in the box. {price}.",
        "Pickup or shipping",
    ),
    _listing(
        "keychron", "Keychron Q1 Pro mechanical keyboard, lubed switches", 115, LIKE_NEW, "Theo",
        "a keyboard hobbyist, slightly evangelical, values the hours he spent lubing switches",
        "Aluminium 75 percent board. Gateron Oil King switches, hand lubed and filmed, tape and foam mods done. Includes the stock keycaps, cable, tools and box. Sounds incredible.",
        "Still available. Every switch is hand lubed, that alone took a weekend. {price}.",
        "Pickup or shipping",
    ),
    _listing(
        "blackwidow", "Razer BlackWidow V3 keyboard, green switches", 42, FAIR, "Kyle",
        "blunt and a bit lazy, replies in fragments, wants it gone by the weekend",
        "Works fine. The spacebar is shiny and the W key lighting is dim. No wrist rest. Loud clicky switches, my roommate hated it.",
        "still have it. works, bit worn. {price}",
    ),
    _listing(
        "cloud2", "HyperX Cloud II gaming headset", 32, GOOD, "Aaliyah",
        "upbeat, replaced the ear pads herself and wants credit for it",
        "Wired headset with the USB sound card. I fitted brand new ear pads last month. Microphone works well. The headband stitching is fraying a little on one side.",
        "Hi! Yes still available. New ear pads on it, mic works great. {price}.",
    ),
    _listing(
        "novapro", "SteelSeries Arctis Nova Pro Wireless headset", 205, LIKE_NEW, "Jonas",
        "matter of fact, got it as a gift and prefers speakers, has the receipt",
        "Used maybe ten times. Includes the base station, both batteries, all cables and the box. Works with PC and PlayStation.",
        "It's available. Barely used, both batteries and the base station included. {price}.",
        "Pickup or shipping",
    ),
    _listing(
        "streamdeck", "Elgato Stream Deck MK.2, 15 keys", 78, LIKE_NEW, "Paige",
        "a streamer who quit, self-deprecating about it, friendly",
        "Bought it for a streaming career that lasted four weeks. Works perfectly, includes the stand and USB cable. No scratches on the faceplate.",
        "Yes still here! I streamed for a month and gave up, so it's basically new. {price}.",
        "Pickup or shipping",
    ),
    _listing(
        "titanchair", "Secretlab Titan Evo gaming chair, regular size", 255, GOOD, "Omar",
        "practical, switching to a standing desk, not interested in delivering it",
        "Black leatherette, regular size. Two years old. Magnetic head pillow included. A little wear on the left armrest pad, hydraulics hold fine. You need a car that fits it, I am not taking it apart.",
        "Still available. Two years old, some armrest wear. You'll need to collect it. {price}.",
    ),
    _listing(
        "quest3", "Meta Quest 3 128GB with Elite Strap", 355, LIKE_NEW, "Camille",
        "cheerful, gets motion sick and admits it, happy to factory reset it in front of you",
        "Used a handful of times before I accepted that VR makes me queasy. Includes both controllers, the Elite Strap, original strap, charger and box. Lenses are scratch free.",
        "Hi, yes! Barely used, turns out VR makes me ill. Elite Strap included. {price}.",
    ),
    _listing(
        "index", "Valve Index full VR kit", 510, GOOD, "Stefan",
        "knows the hardware inside out, upfront about the controller stick, firm on price",
        "Headset, two base stations and two controllers. The left controller has slight stick drift that I fixed once with contact cleaner. Includes all cables, mounts and the original box.",
        "Available. Full kit, the left stick drifts a little now and then. {price}.",
    ),
    _listing(
        "g29", "Logitech G29 racing wheel with pedals and shifter", 165, GOOD, "Mateo",
        "a sim racing fan moving up to direct drive, chatty about lap times",
        "Wheel, three pedal set and the Driving Force shifter. Works on PlayStation and PC. The leather on the rim is worn where my hands sat. Brake pedal still has the stiff rubber block in it.",
        "Still for sale! Wheel, pedals and the shifter together. {price}.",
    ),
    _listing(
        "trinitron", "Sony Trinitron 27-inch CRT TV", 150, GOOD, "Walt",
        "retired, bemused that anyone wants an old television, will not help carry it",
        "Flat tube Trinitron with component input. Picture is bright and the geometry is good. Remote included. It weighs about a hundred pounds and it is in my basement, so bring a friend.",
        "It is still here. Works fine, my grandson says these are wanted for old games. {price}, and you carry it.",
    ),

    # ---- Consoles ----
    _listing(
        "ps5", "PlayStation 5 disc edition with two controllers", 380, GOOD, "Jordan",
        "laid back, selling because he never plays it, hates long back-and-forth",
        "Launch model disc console. Two DualSense controllers, one has light stick drift. HDMI and power cables included. No box. Factory reset and ready to go.",
        "Yep still got it. Two controllers, barely any hours on it. {price} and it is yours.",
    ),
    _listing(
        "ps5pro", "PlayStation 5 Pro, 2TB", 610, LIKE_NEW, "Imani",
        "organised and brisk, bought it on impulse, has the receipt ready to photograph",
        "Bought in the winter and played two games on it. Includes the controller, cables, box and receipt. No disc drive, digital only.",
        "Hello, yes it's available. Used for two games, receipt included. {price}.",
    ),
    _listing(
        "ps2slim", "PlayStation 2 Slim with memory card and controller", 70, GOOD, "Reggie",
        "nostalgic and talkative, tells you which games he finished on it",
        "Slim model, black. Reads discs first try. One official DualShock 2, an 8MB memory card and the AV and power cables. A few scratches on the lid.",
        "Still available! Reads every disc first time. Controller and memory card included. {price}.",
    ),
    _listing(
        "ps2fat", "PlayStation 2 fat console with network adapter and hard drive", 135, GOOD, "Dmitri",
        "a tinkerer, speaks in model numbers, respects buyers who know what the hard drive is for",
        "SCPH-39001 with the official network adapter and a 500GB drive set up for loading games. Laser was replaced last year. Two controllers and a memory card with Free McBoot.",
        "Available. 39001 with the network adapter and a 500GB drive, new laser. {price}.",
    ),
    _listing(
        "gamecube", "Nintendo GameCube, indigo, with controller", 95, GOOD, "Holly",
        "sentimental, it was her childhood console, wants it to go to someone who will play it",
        "Indigo console with one matching official controller, a memory card and all the cables. The controller stick is a bit loose. Console has some scuffs on top but runs quietly.",
        "Hi, yes it's available! It was mine as a kid, still works great. {price}.",
    ),
    _listing(
        "gcgbplayer", "GameCube, black, with Game Boy Player and start-up disc", 230, GOOD, "Victor",
        "a collector, careful, quick to point out the disc is the valuable part",
        "Black console with the Game Boy Player attached and the start-up disc, which is the hard part to find. One controller, memory card and cables. Disc has light surface marks and loads fine.",
        "Still available. It includes the start-up disc, which most of these are missing. {price}.",
    ),
    _listing(
        "xboxseriesx", "Xbox Series X, 1TB", 330, GOOD, "Brandon",
        "casual, switched to PC, will throw in nothing extra and says so",
        "Works perfectly. One controller, HDMI and power cable. Small scratch on the top vent. No box. Reset and unlinked from my account.",
        "Yeah still available. One controller, works perfect. {price}.",
    ),
    _listing(
        "xbox360lot", "Xbox 360 Slim with Kinect and 22 games", 65, FAIR, "Tammy",
        "a parent clearing out the playroom, cheerful, has no idea what any of it is worth",
        "Kids outgrew it. Console, Kinect sensor, two controllers and a stack of 22 games, mostly sports, Lego and Call of Duty. Everything worked when we unplugged it. One controller is missing the battery cover.",
        "Yes it's still here! The kids outgrew it. Everything worked last time it was on. {price} for all of it.",
    ),
    _listing(
        "steamdeck", "Steam Deck OLED 512GB with case", 410, LIKE_NEW, "Elise",
        "thoughtful, travels less now, answers questions thoroughly",
        "512GB OLED model, eight months old. Screen protector fitted since day one. Includes the carrying case and charger. No stick drift, battery health is excellent.",
        "Hi, it's available. Screen protector on since new, comes with the case. {price}.",
    ),
    _listing(
        "switch", "Nintendo Switch OLED with Tears of the Kingdom", 260, GOOD, "Sofia",
        "friendly, a little sentimental about it, wants it to go to a good home",
        "White OLED model with the dock, Joy-Cons, grip and charger. Tears of the Kingdom cartridge included. Light scratches on the back, screen is clean. No box.",
        "It has been very loved but it is in great shape! The game is included. {price}.",
    ),
    _listing(
        "switchlite", "Nintendo Switch Lite, turquoise", 105, FAIR, "Dylan",
        "a college student, direct, needs the money for books and says so",
        "Works fine. The left stick drifts sometimes, usually fixed by blowing under it. Scratches on the back and a small one on the screen. Charger included.",
        "still available. left stick drifts sometimes, priced for that. {price}",
    ),
    _listing(
        "vita", "PlayStation Vita 1000 OLED with 32GB card", 185, GOOD, "Noel",
        "soft spoken enthusiast, protective of the handheld, wary of resellers",
        "Original OLED model in black. Includes a 32GB memory card, which costs a fortune alone, plus the charger and a hard case. Light wear on the back touch pad.",
        "Hello. Yes, still available. It includes the 32GB card and a case. {price}.",
        "Pickup or shipping",
    ),
    _listing(
        "psp", "PSP 3000, piano black, with 6 games", 90, GOOD, "Luis",
        "easygoing, found it in a drawer, pleasantly surprised it is worth anything",
        "Found it while moving. Screen is clean, buttons all work. Battery lasts about two hours. Six UMD games including Crisis Core and Monster Hunter. Charger and a 4GB stick included.",
        "Hey, yes. Found it in a drawer, everything works. Six games with it. {price}.",
    ),
    _listing(
        "dreamcast", "Sega Dreamcast with two controllers and VMU", 130, GOOD, "Pete",
        "wry and knowledgeable, loves the console, will mention the disc drive noise before you do",
        "Console, two controllers, one VMU, cables. The disc drive is noisy, as they all are, and reads everything I have tried. Slight yellowing on the shell.",
        "Still available. Drive is loud like every Dreamcast but it reads fine. {price}.",
    ),
    _listing(
        "snes", "Super Nintendo with two controllers", 120, GOOD, "Glenn",
        "plain spoken, had it since the nineties, does not negotiate by essay",
        "Original console, two official controllers, power supply and AV cable. Top is yellowed. Cleaned the cartridge slot and it boots games first time.",
        "Yes, still for sale. Had it since new. Works first time. {price}.",
    ),
    _listing(
        "wiilot", "Nintendo Wii with Wii Sports, Mario Kart and 4 remotes", 75, GOOD, "Denise",
        "warm and chatty, the family played it every Christmas, not in a rush",
        "White Wii with four remotes, two nunchuks, the wheel, sensor bar and cables. Games are Wii Sports, Wii Sports Resort and Mario Kart Wii. One remote has a cracked battery cover.",
        "Hello! Yes, it's available. Four remotes and Mario Kart included. {price} for everything.",
    ),
    _listing(
        "wiiu", "Wii U 32GB Deluxe with gamepad", 140, GOOD, "Arjun",
        "methodical, lists every flaw, expects the same honesty from the buyer",
        "Black 32GB console, gamepad, charger, sensor bar and cables. Gamepad screen has light scratches and the battery lasts around two hours. Nintendo Land disc included.",
        "It is available. Gamepad battery is about two hours, everything else is fine. {price}.",
    ),
    _listing(
        "new3dsxl", "New Nintendo 3DS XL, Galaxy edition", 235, GOOD, "Rosa",
        "bubbly, loves the design, knows these have gone up and is pleased about it",
        "Galaxy style New 3DS XL. Both screens are free of scratches. Hinge is firm. Includes a charger and a 64GB card. Stylus is a replacement. No box.",
        "Hi! Still available. Screens are perfect, it comes with a charger and a 64GB card. {price}.",
        "Pickup or shipping",
    ),
    _listing(
        "n64", "Nintendo 64 with GoldenEye 007 and four controllers", 170, GOOD, "Darnell",
        "cheerful dad clearing the attic, would love to tell you about every game",
        "Console with four controllers in different colours, GoldenEye 007, the expansion pak, and all cables. Two of the sticks are loose. Tested last night and it all works.",
        "Everything works, I tested it with the kids last night. Four controllers too. {price} for the lot.",
    ),
    _listing(
        "gameboy", "Teal Game Boy Color with Pokemon Crystal", 145, GOOD, "Amara",
        "sharp and playful, enjoys the haggle more than the sale",
        "Teal Game Boy Color with a genuine Pokemon Crystal cartridge. The save battery in the game was replaced this year. Screen lens has light scratches. Battery cover is present.",
        "The Crystal still saves, I checked. You will not find the pair cheaper than {price}.",
    ),

    # ---- Rare games ----
    _listing(
        "defjam", "Def Jam: Fight for NY, PS2, complete in box", 185, GOOD, "Andre",
        "knows every print run by heart, cannot stand people who call it just an old game",
        "Black label copy with case, manual and disc. Disc has two light hairlines and plays through without a skip. Case has a small crack on the hinge.",
        "Black label, manual, disc is clean. People sleep on how rare this one got. {price}.",
        "Pickup or shipping",
    ),
    _listing(
        "ruleofrose", "Rule of Rose, PS2, complete", 720, GOOD, "Greta",
        "a serious horror collector, cool and exact, has turned down three offers this week",
        "North American release, complete with case and manual. Disc is clean with no scratches. Manual has a faint corner crease. Will only meet at a public place.",
        "Yes, it is available. Complete, clean disc. I am not in a hurry to sell. {price}.",
    ),
    _listing(
        "kuon", "Kuon, PS2, complete in box", 940, LIKE_NEW, "Silas",
        "terse, gets a dozen messages a day about this listing, allergic to stories",
        "Complete North American copy. Disc is near mint, manual is crisp, case has the original cover art with no fading. Stored upright in a smoke-free home.",
        "Available. Near mint, complete. Serious offers only. {price}.",
        "Pickup or shipping",
    ),
    _listing(
        "hauntingground", "Haunting Ground, PS2, disc and case, no manual", 310, GOOD, "Bianca",
        "apologetic about the missing manual, otherwise firm",
        "Disc and original case with cover art. No manual, which is why it is priced under complete copies. A few light scratches, tested through the first two hours.",
        "Hi, yes. It's missing the manual, so I priced it lower than complete ones. {price}.",
    ),
    _listing(
        "earthbound", "EarthBound, SNES, cartridge only", 380, GOOD, "Kenji",
        "quiet and exact, tests every cartridge himself, distrusts anyone in a hurry",
        "Authentic cartridge, I opened it to confirm the board. Label has a small tear at the top edge. Save battery was replaced and it holds saves.",
        "Authentic board, I opened it to check. The save battery is new. {price}.",
        "Pickup or shipping",
    ),
    _listing(
        "pathofradiance", "Fire Emblem: Path of Radiance, GameCube, complete", 235, GOOD, "Naomi",
        "a fan of the series, would rather sell to another fan, not to a flipper",
        "Complete with case, manual and the insert. Disc has light surface marks and loads every chapter I tested. Case has a sticker mark on the front.",
        "Hello, it's still available. Complete, plays perfectly. {price}.",
    ),
    _listing(
        "gotchaforce", "Gotcha Force, GameCube, complete", 340, GOOD, "Ravi",
        "delighted when anyone has heard of the game, loses patience with people who have not",
        "Complete North American copy. Disc is clean, manual has a little shelf wear. One of the hard ones to find for the console.",
        "Still available! Complete copy. Not many of these around. {price}.",
        "Pickup or shipping",
    ),
    _listing(
        "conker", "Conker's Bad Fur Day, N64, cartridge only", 165, GOOD, "Shane",
        "jokey, quotes the game, turns serious the moment price comes up",
        "Authentic cartridge, label is in good shape with slight fading. Saves work. Contacts cleaned.",
        "Yep, still got it. Real cart, saves fine. {price}.",
    ),
    _listing(
        "panzersaga", "Panzer Dragoon Saga, Sega Saturn, complete 4 discs", 1150, GOOD, "Edmund",
        "courteous and immovable, has owned it since release, treats it like an heirloom",
        "All four discs, both cases, manual and the cardboard sleeve. Sleeve has corner wear. Discs are clean. Bought new in 1998 and stored carefully since.",
        "Good evening. Yes, it is available. Complete with the sleeve, one owner. {price}.",
    ),
    _listing(
        "suikoden2", "Suikoden II, PS1, complete", 245, GOOD, "Lucia",
        "gentle and nostalgic, will talk about the story if you let her",
        "Case, manual and disc. Disc has a few light marks and plays without trouble. Manual is clean. The jewel case is a replacement.",
        "Hi, yes it's available. Disc plays perfectly, the jewel case is a replacement. {price}.",
        "Pickup or shipping",
    ),
    _listing(
        "sotn", "Castlevania: Symphony of the Night, PS1, black label", 135, GOOD, "Cyrus",
        "enthusiastic, slightly scattered, keeps remembering details mid conversation",
        "Black label original, complete with manual. Some scratches on the disc, I played to the inverted castle with no freezing. Case has a crack on the back.",
        "Still available! Black label with the manual. {price}.",
    ),
    _listing(
        "mvc2", "Marvel vs. Capcom 2, PS2, complete", 130, GOOD, "Deshawn",
        "competitive, still plays, sizes up whether you actually know the game",
        "Complete with manual. Disc is clean. This was my tournament practice copy and it has been looked after.",
        "Yeah it's available. Complete, clean disc. {price}.",
    ),
    _listing(
        "ncaa14", "NCAA Football 14, PS3", 95, GOOD, "Coach Riley",
        "a football dad, talks in sports cliches, firm because he knows everyone wants it",
        "Disc, case and cover art. Light scratches, plays fine. Last one they made before the long gap, which is why it holds value.",
        "Still available. Plays great. You know why these cost what they do. {price}.",
    ),
    _listing(
        "heartgold", "Pokemon HeartGold with the Pokewalker, boxed", 210, GOOD, "Liam",
        "a collector thinning the shelf, defensive about whether it is genuine",
        "Genuine cartridge, big box, both manuals and the Pokewalker with its clip. Box has a small dent on the back. Save file wiped.",
        "It is a real copy, I can send photos of the board. Box, manuals and the Pokewalker. {price}.",
        "Pickup or shipping",
    ),
    _listing(
        "silenthill", "Silent Hill 2, PS2, black label with manual", 140, GOOD, "Roz",
        "dry sense of humour, has sold four of these this month and knows it",
        "Black label, case and manual. Disc has light scratches and was tested to the apartments. Manual has a small pen mark on the back page.",
        "Still available. The last four I listed went in a day each. {price}.",
        "Pickup or shipping",
    ),
    _listing(
        "ttyd", "Paper Mario: The Thousand-Year Door, GameCube", 90, GOOD, "Jess",
        "friendly, replays it every year and is finally letting it go",
        "Original GameCube disc with case and manual. A couple of light scratches, no loading issues. Black label.",
        "Hi! Yes it's available. Case and manual included, plays perfectly. {price}.",
    ),

    # ---- Common games ----
    _listing(
        "melee", "Super Smash Bros. Melee, GameCube", 62, GOOD, "Marco",
        "blunt, used to compete, has no patience for people who say it is just an old game",
        "Disc, case and manual. Disc is scratched but loads every time. Player's Choice version.",
        "Still have it. Scratched but it works every time. {price}.",
    ),
    _listing(
        "doubledash", "Mario Kart: Double Dash, GameCube", 58, GOOD, "Katie",
        "light hearted, selling duplicates, easy to talk to",
        "Disc and case, no manual. Disc is in good shape. Bonus disc not included.",
        "Hey! Yep, available. No manual but the disc is in good shape. {price}.",
    ),
    _listing(
        "gtasa", "Grand Theft Auto: San Andreas, PS2, with map", 14, GOOD, "Tony",
        "cheerful and unfussy, selling a stack of old games one by one",
        "Greatest Hits copy with the case, manual and the fold-out map. Disc has a few scratches and plays fine.",
        "Yeah still available. Comes with the map. {price}.",
    ),
    _listing(
        "eldenring", "Elden Ring, PS5", 27, LIKE_NEW, "Sam",
        "tired, gave up on the game and admits it, wants a quick sale",
        "Played for a weekend and admitted defeat. Disc is spotless, case included. No code inside, it never had one.",
        "It's available. Disc is perfect, I just could not beat the first boss. {price}.",
    ),
    _listing(
        "bo6", "Call of Duty: Black Ops 6, PS5", 30, LIKE_NEW, "Jalen",
        "quick replies, plays on PC now, not going to budge much on a recent game",
        "Finished the campaign and moved to PC. Disc and case are like new.",
        "yeah still got it. like new. {price}",
    ),
    _listing(
        "minecraftswitch", "Minecraft, Nintendo Switch", 17, GOOD, "Pam",
        "a parent selling what the kids no longer play, polite, slow to reply",
        "Cartridge and case. The case has a sticker from my son on it that will not come off cleanly.",
        "Hello, yes it is still available. Case has a sticker on it, sorry. {price}.",
    ),
    _listing(
        "halo3", "Halo 3, Xbox 360", 8, FAIR, "Greg",
        "laconic, finds it funny that anyone haggles over this, will still do it",
        "Disc, case and manual. Disc is scratched but I played a level and it was fine. Case is cracked.",
        "Still here. Scratched, works. {price}.",
    ),
    _listing(
        "guitarhero", "Guitar Hero III bundle, PS2, with guitar", 68, GOOD, "Mandy",
        "fun and nostalgic, found it in the garage, tested the guitar before listing",
        "Game disc, case and the wireless Les Paul guitar with its dongle and strap. All fret buttons and the strum bar work. Whammy bar is a little loose.",
        "Yes it's available! Guitar works, I tested every button. {price}.",
    ),

    # ---- Lots ----
    _listing(
        "ps2lot", "PS2 game lot, 34 games", 160, GOOD, "Russ",
        "selling a whole collection in one go, refuses to split it and says so often",
        "34 games, all with cases, most with manuals. Mostly sports and racing, plus Ratchet and Clank, Jak 3, Kingdom Hearts, Burnout 3 and God of War. Not selling individually.",
        "Still available as one lot. 34 games, not splitting them. {price}.",
    ),
    _listing(
        "gclot", "GameCube lot: console, 2 controllers, 9 games", 285, GOOD, "Erin",
        "organised, photographed every disc, expects buyers to have read the list",
        "Platinum console, two official controllers, memory card and nine games: Wind Waker, Sunshine, Luigi's Mansion, Animal Crossing, Pikmin, Sonic Adventure 2 Battle and three sports titles. All tested.",
        "Hi, yes. Console, two controllers and nine games, all tested. The list is in the description. {price}.",
    ),
    _listing(
        "360games", "Box of 60 Xbox 360 games", 90, FAIR, "Vince",
        "wants the box out of his hallway, breezy, a little evasive about condition",
        "About 60 games, most in cases. Lots of sports, shooters and a few RPGs. I have not tested them. Some discs are scratched. Sold as one box.",
        "Yep, the whole box is still here. Around 60 games. {price} takes it all.",
    ),
    _listing(
        "retrolot", "Retro console lot: NES, SNES and Genesis, untested", 240, PARTS, "Lorraine",
        "clearing a late relative's house, kind, honest that she cannot test anything",
        "From my brother's attic. An NES, a Super Nintendo and a Sega Genesis with a tangle of controllers and cables and about fifteen cartridges. I have no way to test them. Sold as found.",
        "Hello, yes, it is all still here. I cannot test any of it, I am sorry. {price} for the lot.",
    ),
    _listing(
        "gaminglot", "Gaming lot: PS4 Pro, headset, 12 games, extra controller", 245, GOOD, "Tariq",
        "moving abroad, friendly, would rather sell once than deal with ten buyers",
        "PS4 Pro 1TB, two controllers, a Sony Pulse headset and 12 games including God of War, Spider-Man, The Last of Us Part II and Red Dead Redemption 2. Console fan is loud under load.",
        "Still available, all together. Console, two controllers, headset and 12 games. {price}.",
    ),
    _listing(
        "amiibo", "Amiibo collection, 42 figures", 370, GOOD, "Chloe",
        "a completionist who ran out of shelves, knows which ones are rare",
        "42 figures out of the box, displayed in a cabinet. Includes most of the Smash line, three Zelda ones that got expensive, and both Splatoon squids. No boxes.",
        "Hi! Yes, all 42 are still available. Selling as a set. {price}.",
    ),
    _listing(
        "pokemonbulk", "Pokemon card bulk lot, about 2,000 cards", 70, GOOD, "Eli",
        "a teenager who has already pulled the good ones and will admit it if asked",
        "Roughly 2,000 commons and uncommons from Sword and Shield and Scarlet and Violet, plus around 80 holos. The valuable cards have been pulled. Good for players or kids.",
        "yeah still have them. about 2000 cards, some holos. {price}",
    ),
    _listing(
        "skylanders", "Bin of Skylanders figures with two portals", 38, FAIR, "Joanne",
        "brisk mum, wants the bin gone, immune to flattery",
        "A storage bin of around 70 figures and two portals. Some are scuffed. No games included. I am not counting them again.",
        "Yes, still available. About 70 figures and two portals. {price} and you take the bin too.",
    ),

    # ---- Phones and laptops ----
    _listing(
        "iphone11", "iPhone 11, 64GB, cracked back glass", 220, FAIR, "Tyler",
        "types in lowercase, swears it works perfectly, keeps saying he has other people asking",
        "Black, 64GB, unlocked. Back glass is cracked across the bottom corner. Screen has no cracks. Battery health 79 percent. No charger.",
        "hey yeah still available. works perfect, the crack is just cosmetic. {price}",
    ),
    _listing(
        "iphone13", "iPhone 13 Pro, 128GB, Sierra Blue", 430, GOOD, "Mei",
        "polite and organised, has the box and the receipt, will not be rushed",
        "Unlocked, 128GB. Always in a case with a screen protector. Battery health 81 percent. Tiny scuff on the steel band near the charging port. Box and cable included.",
        "Hi! Yes, it is available. Always kept in a case, comes with the box. I am asking {price}.",
    ),
    _listing(
        "macbook", "2019 MacBook Pro 16-inch, battery needs service", 780, FAIR, "Priya",
        "an engineer, precise about specs, upfront about the battery and firm about everything else",
        "Intel i9, 32GB RAM, 1TB SSD. Screen is flawless and the keyboard works perfectly. Battery shows a service warning and lasts about two hours. Charger included.",
        "32GB of RAM and the screen is flawless. The battery does need service, which is why it is {price}.",
    ),

    # ---- Tickets ----
    _listing(
        "weeknd", "Two floor tickets to The Weeknd, tonight", 640, None, "Jasmine",
        "brisk, cannot go herself, watching the clock as closely as you are",
        "Floor section A, row 14, seats 7 and 8, side by side. Mobile tickets, transferred through the official app the moment you pay. Doors at 7.",
        "Floor, section A, transferred to your phone in two minutes. {price} for both.",
        "Mobile transfer",
    ),
    _listing(
        "beyonce", "One upper-deck ticket to Beyonce, Saturday", 190, None, "Carlos",
        "gutted to be selling, keeps reminding you it sold out in minutes",
        "Section 334, row 9, seat 12. Single ticket, mobile transfer. Clear view of the stage, just high up. My shift got moved.",
        "My shift got moved or I would never sell this. Face value was close to this anyway. {price}.",
        "Mobile transfer",
    ),
    _listing(
        "tickets", "Two tickets to tonight's sold-out show", 300, None, "Rico",
        "cocky, acts like the clock is on his side, mentions other buyers constantly",
        "General admission, standing. Two mobile tickets sent by transfer. Doors open in an hour. Selling as a pair only.",
        "Still got them. Doors open in an hour and these are the last two I have seen listed. {price} for the pair.",
        "Mobile transfer",
    ),

    # ---- Cars and bikes ----
    _listing(
        "civic", "2009 Honda Civic LX, 148,000 miles", 5200, FAIR, "Sal",
        "gruff and honest, kept every oil change receipt, thinks dealers are crooks",
        "Automatic, clean title, one owner. New battery and front brakes this year. Clear coat is peeling on the roof and there is a dent in the rear quarter panel. Air conditioning blows cold.",
        "Still for sale. She is not pretty but she starts every single morning. I have all the service records. {price}.",
    ),
    _listing(
        "car", "2014 Ford Fiesta hatchback, 96,000 miles", 7400, GOOD, "Dana",
        "fast talking and friendly, hates silence, always has another buyer coming at four",
        "Manual, clean title, two owners. New tyres in the autumn. Small scrape on the front bumper. Bluetooth works, rear wiper does not.",
        "Yes, available! Runs like a dream. I have someone coming to look at four, just so you know. {price}.",
    ),
    _listing(
        "tacoma", "2016 Toyota Tacoma SR5, 88,000 miles", 24500, GOOD, "Hank",
        "proud of the truck, slow to reply, believes Tacomas only go up in value",
        "Double cab, four wheel drive, clean title, one owner. Never off-road, never towed. Bed liner and tonneau cover. Small chip in the windscreen.",
        "It is available. Never been off-road and never towed. You know what these hold their value like. {price}.",
    ),
    _listing(
        "tesla", "2018 Tesla Model 3 Long Range, 71,000 miles", 19800, GOOD, "Irene",
        "brisk professional, has a spreadsheet of comparable listings, replies in full sentences",
        "Rear wheel drive, white on black, clean title. Battery health report shows 91 percent. Kerb rash on two wheels. Includes the mobile charger. Premium connectivity is not transferable.",
        "Battery health is at 91 percent and I have the report. It is priced at {price}, in line with the market.",
    ),
    _listing(
        "mustang", "1967 Ford Mustang coupe, project car", 14500, PARTS, "Earl",
        "an old-timer, sentimental, sizing up whether you will actually finish the car",
        "289 V8, automatic. Ran when parked eleven years ago. Floors are mostly solid, rust in the rear quarters. Interior is complete but tired. Clean title in my name. You will need a trailer.",
        "Still have her. She ran when I parked her. Floors are solid, mostly. I would want {price}.",
    ),
    _listing(
        "vespa", "2011 Vespa LX 150, 9,000 miles", 2600, GOOD, "Gio",
        "charming and chatty, insists it is the best thing he ever owned, moving abroad next week",
        "Red, garaged every winter. New tyres and a fresh service. A scuff on the left cowl from a tip over in a car park. Top case and two keys included.",
        "I am heartbroken to sell her. Garaged every winter, new tyres. {price}.",
    ),
    _listing(
        "trek", "Trek Marlin 5 mountain bike, medium frame", 380, GOOD, "Skye",
        "easygoing, knows the components, honest about the worn drivetrain",
        "2021 model, medium frame, 29 inch wheels. Fresh tune-up and new brake pads. Chain and cassette have some miles on them. A few scratches on the top tube.",
        "Still available. Fresh tune-up, new brake pads. The chain has some miles on it. {price}.",
    ),

    # ---- Everything else ----
    _listing(
        "jordans", "Air Jordan 1 Retro High, size 10, worn twice", 320, LIKE_NEW, "Malik",
        "a sneakerhead, quotes resale prices, will not tolerate the word fake",
        "Size 10 US. Worn twice, indoors. No creasing on the toe box, soles are clean. Original box, both lace sets and the receipt from the retailer.",
        "Still available. Worn twice, no creasing, original box and both lace sets. {price}.",
        "Pickup or shipping",
    ),
    _listing(
        "charizard", "1999 Base Set Charizard, lightly played", 420, GOOD, "Owen",
        "speaks in grades and centering, has looked up every recent sale",
        "Unlimited print, holo. Front is clean with no scratches on the foil. Light whitening on the back edges and one soft corner. Ungraded. Shipped in a top loader.",
        "Available. Unlimited, holo is clean, a little whitening on the back. Recent sales put it at {price}.",
        "Pickup or shipping",
    ),
    _listing(
        "lego", "LEGO Millennium Falcon 75192, bags still sealed", 720, NEW, "Dev",
        "methodical, selling because there is nowhere to put it, wary of time-wasters",
        "Outer box was opened to check the contents and is a little crushed on one corner. Every numbered bag is sealed, and the manual is still wrapped. Heavy, pickup preferred.",
        "Yes, available. Box was opened but every bag is sealed, and I have counted them. {price}.",
    ),
    _listing(
        "datejust", "1996 Rolex Datejust 16234, no papers", 5400, GOOD, "Viktor",
        "smooth and unreadable, leaves long gaps between messages, respects a buyer who knows references",
        "Reference 16234, white gold bezel, silver dial, jubilee bracelet with some stretch. Serviced last spring with the receipt. No box or papers. Happy to meet at a watchmaker of your choice.",
        "Good afternoon. It is available. Serviced last spring, original dial. Without papers I can do {price}.",
    ),
    _listing(
        "guitar", "1978 Fender Stratocaster with a repaired headstock", 1250, FAIR, "Marcus",
        "gruff, knows exactly what things are worth, respects people who know their stuff",
        "Natural finish, maple neck. The headstock was cracked and professionally repaired years ago and has been stable since. Original pickups. Frets have life left. Hard case included.",
        "Still available. The repair is solid and it plays better than new. {price}.",
    ),
    _listing(
        "camera", "Canon AE-1 film camera with a 50mm lens", 240, GOOD, "Nora",
        "patient and knowledgeable, warms up to anyone who actually shoots film",
        "Silver body with the 50mm f1.8. Light seals were replaced last year and the meter reads true. No shutter squeal. A small dent on the lens filter ring. Strap included.",
        "Hi, yes. Light seals were replaced last year and the meter reads true. {price} with the lens.",
        "Pickup or shipping",
    ),
    _listing(
        "vinyl", "Daft Punk, Discovery, original 2001 pressing", 160, GOOD, "Lena",
        "cool and unhurried, grades strictly, has heard every sob story about budgets",
        "Original 2001 double LP. Sleeve is VG plus with light ring wear. Both discs play clean with no skips. The membership card insert is missing.",
        "It is available. Sleeve is VG plus, both discs play clean. You do not see originals often. {price}.",
        "Pickup or shipping",
    ),
    _listing(
        "bulls", "1998 Chicago Bulls Jordan jersey, Champion replica", 110, GOOD, "Tasha",
        "funny and fast, knows what the vintage crowd will pay, short on patience for time-wasters",
        "Red, size 44. Genuine nineties Champion with the tag intact. No cracking on the numbers. One small pulled thread near the hem.",
        "Yes, still available. That is a real nineties Champion, check the tag in the photos. {price}.",
        "Pickup or shipping",
    ),
    _listing(
        "peloton", "Peloton Bike, barely used", 650, LIKE_NEW, "Chad",
        "a little embarrassed, just wants it out of the bedroom, pretends he is in no hurry",
        "Original Bike, under thirty rides. Includes the mat, weights and a pair of size 44 shoes. Screen is perfect. On the second floor, so bring help.",
        "Honestly it has been a clothes rack. Under thirty rides on it. {price}, you collect.",
    ),
    _listing(
        "sofa", "IKEA Kivik sofa, three seats, one cat", 250, GOOD, "Brenda",
        "cheerful, oversharing, moving on Friday and getting nervous about it",
        "Grey three seat Kivik, four years old. Covers are washable and were washed last week. A few claw marks on the left arm. Pet friendly, smoke free home. Must go by Friday.",
        "So comfy! The cat mostly ignored it, I promise. Covers are washable. {price}.",
    ),
    _listing(
        "mixer", "KitchenAid Artisan stand mixer, empire red", 190, LIKE_NEW, "Marge",
        "brisk grandmother, knows what it costs new, not here to be charmed",
        "Five quart tilt head in empire red. Used for Christmas baking and little else. Comes with the bowl, flat beater, dough hook and whisk. A small chip in the paint on the base.",
        "Yes, it is available. Used it for Christmas baking and that is all. They are twice that in the shops. {price}.",
    ),
    _listing(
        "rug", "Hand-knotted wool rug, 5 by 8 feet", 480, GOOD, "Yusuf",
        "theatrical and warm, loves a good story, swears every discount will ruin him",
        "Hand-knotted wool in red and navy, 5 by 8 feet. Brought back from my family's village. Professionally cleaned. Slight fraying on one corner of the fringe.",
        "Ah, you have an eye, my friend! Six months my cousin spent on this rug. For you, {price}.",
    ),
    _listing(
        "lamp", "Brass desk lamp, slightly dented", 65, FAIR, "Edith",
        "sweet but sharp, forty years of car boot sales behind her, has heard every line there is",
        "Solid brass banker's lamp with a green glass shade. Small dent in the base. Rewired two years ago and works well. Bulb included.",
        "Yes dear, it is still available. It came out of a bank manager's office. I could not let it go for less than {price}.",
    ),
    _listing(
        "map", "Hand-coloured 1820s map of the Mediterranean", 900, GOOD, "Beatrice",
        "dry and precise, despises being rushed, warms to anyone who asks about provenance",
        "Copper engraving with original hand colour, about 1825. No foxing to speak of, one old centre fold as issued. Framed behind conservation glass. Provenance letter included.",
        "It is available. Original colour, no foxing to speak of. It is priced at {price}, which is fair.",
    ),
    _listing(
        "coil", "Lightly used hyperdrive coil", 9800, GOOD, "Zex",
        "no time for sob stories, replies in clipped bursts, a sucker for flattery about the salvage yard",
        "Class 3 coil pulled from a decommissioned courier ship. Barely a scorch mark. Tested at 94 percent output. Buyer collects from the orbital yard. No returns, no deliveries.",
        "Coil is available. Pulled it from a courier ship myself. Barely a scorch mark. {price}, and I do not deliver.",
        "Orbital pickup",
    ),
]

assert len({s["id"] for s in SCENARIOS}) == len(SCENARIOS)
