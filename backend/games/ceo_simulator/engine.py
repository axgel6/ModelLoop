"""CEO Simulator rules.

The model narrates each week and proposes what changed (demand up 15%, hire
two people, reputation down 5). It never states revenue, profit or cash: those
are computed here from the proposed effects, after every value is clamped, so
the numbers stay consistent however the model behaves. No I/O in this file.
"""
import copy
import math
import random
import re
import uuid
from typing import Optional

GAME_TYPE = "ceo-simulator"

# A turn is one week, and every rate below is per week.
# The company opens with money and no staff: the first job is to hire a team with it.
START_CASH = 200_000
START_REPUTATION = 50
START_MORALE = 70
# Opening weekly revenue is split evenly across the starting products, so a
# company selling $5 coffees and one selling $900 chairs begin on equal footing.
START_REVENUE_TARGET = 14_000
NEW_PRODUCT_REVENUE_TARGET = 3_000

SALARY = 1_200                 # per employee, per week
HIRING_COST = 2_000            # per hire
LAUNCH_COST = 3_000            # to develop and release a new product
SEVERANCE = 3_000              # per layoff
REVENUE_PER_EMPLOYEE = 5_000   # weekly sales one person can support
FIXED_OVERHEAD = 750
OVERHEAD_RATE = 0.03           # of revenue
PRICE_ELASTICITY = 1.2         # % demand lost per % price increase
WORD_OF_MOUTH = 4000           # higher is slower: weekly demand drift per reputation point
DEMAND_BOOST = 1.5             # how much harder a good decision lands than the model's cautious figure
# Growth gets harder as a product outgrows its launch market: at 1 + MARKET_ROOM
# times its launch demand, a boost lands at half strength. Stops weekly gains compounding without end.
MARKET_ROOM = 1.0
# Spending the player did not put a number on: the model's figure, kept to a
# share of what the company can afford so one vague decision cannot sink it.
UNPROMPTED_COST_CASH_SHARE = 0.15
UNPROMPTED_COST_WEEKS = 1.5    # ...or this many weeks of revenue, if that is less
OVERDRAFT_WEEKS = 2            # weeks the bank tolerates a negative balance before the company folds

MAX_PRODUCTS = 8

# ---- Setup choices ----
# Each entry lists only what it changes; anything missing is 1x (or the normal value).
DIFFICULTIES = {
    "easy":   {"label": "Easy", "blurb": "More starting cash, bigger wins, a patient bank.",
               "cash": 1.5, "boost": 1.2, "overdraft": 3, "crisis": 0.4, "spend": 0.10},
    "normal": {"label": "Normal", "blurb": "The standard game.",
               "overdraft": 2, "crisis": 0.5, "spend": 0.15},
    "hard":   {"label": "Hard", "blurb": "Less cash, smaller wins, more crises, no overdraft.",
               "cash": 0.7, "boost": 0.8, "overdraft": 1, "crisis": 0.62, "spend": 0.25},
}
STYLES = {
    "bootstrapper":  {"label": "Bootstrapper",
                      "blurb": "Runs lean. Salaries cost 15% less, but investors offer 20% less.",
                      "salary": 0.85, "investor": 0.8},
    "growth":        {"label": "Growth at all costs",
                      "blurb": "Demand gains land 25% harder, and salaries cost 15% more.",
                      "boost": 1.25, "salary": 1.15},
    "perfectionist": {"label": "Perfectionist",
                      "blurb": "Products start better made and the company better regarded. Launches cost twice as much.",
                      "quality": 75, "reputation": 60, "launch": 2.0},
}

# ---- Team roles ----
# Everyone adds the same capacity. Specialists cost more and do one extra thing every week.
ROLES = {
    "general": {"label": "Generalists", "one": "generalist", "salary": 1.0,
                "blurb": "Keep things running. Every employee, whatever their role, adds capacity."},
    "sales":   {"label": "Sales", "one": "salesperson", "salary": 1.25,
                "blurb": "Each one grows demand a little every week."},
    "product": {"label": "Product", "one": "product person", "salary": 1.25,
                "blurb": "Each one raises product quality a little every week."},
    "support": {"label": "Support", "one": "support person", "salary": 1.25,
                "blurb": "Each one builds reputation a little every week."},
}
SALES_PULL = 0.5               # % demand a week per salesperson, before market saturation
PRODUCT_CRAFT = 0.4            # quality points a week per product person
SUPPORT_CARE = 0.25            # reputation points a week per support person
SPECIALISTS_COUNTED = 8        # only the best this many of a kind do their specialist work

# ---- People ----
# A level sets how much someone does (power) against what they cost. Juniors are
# the best value per dollar; stars do the most per seat, which is what matters once
# every seat that counts is taken.
LEVELS = {
    "junior": {"label": "Junior", "power": 0.6, "salary": 0.6, "fee": 1_000},
    "mid":    {"label": "Mid-level", "power": 1.0, "salary": 1.0, "fee": 2_000},
    "senior": {"label": "Senior", "power": 1.5, "salary": 1.7, "fee": 5_000},
    "star":   {"label": "Star", "power": 2.2, "salary": 2.8, "fee": 12_000},
}
DESK_COST = 150                # a week per head, whoever they are: space, kit, admin
MAX_TEAM = 40
DRAFT_POOL = 12                # candidates on offer before week one
HIRING_POOL = 5                # candidates on offer after that
POOL_REFRESH = 4               # weeks between new sets of candidates
SEVERANCE_WEEKS = 2            # weeks of salary paid to someone let go
FIRST_NAMES = [
    "Maya", "Dev", "Rosa", "Sam", "Nia", "Leo", "Ava", "Omar", "Iris", "Jon", "Tessa", "Kofi", "Mina", "Paul",
    "Zara", "Eli", "Lucia", "Hugo", "Priya", "Noah", "Ines", "Marc", "Yuki", "Ben", "Carla", "Amir", "Freya", "Theo",
    "Aaliyah", "Mateo", "Ingrid", "Kwame", "Sofia", "Rahul", "Chloe", "Tariq", "Nadia", "Oscar", "Mei", "Andre",
    "Fatima", "Lars", "Camila", "Jamal", "Anika", "Felix", "Leila", "Diego", "Hana", "Marcus", "Elena", "Tunde",
    "Bianca", "Ravi", "Greta", "Malik", "Aiko", "Pedro", "Simone", "Arjun", "Naomi", "Viktor", "Isla", "Emeka",
    "Paloma", "Darius", "Linh", "Callum", "Zainab", "Rafael", "Astrid", "Kenji", "Amara", "Luca", "Sana", "Jorge",
    "Wren", "Idris", "Daniela", "Soren", "Kavya", "Tomas", "Esme", "Babajide", "Mirela", "Javier", "Thandi", "Owen",
    "Yara", "Anton", "Keiko", "Desmond", "Alma", "Hassan", "Petra", "Caleb", "Noor", "Emil", "Renee", "Tobias",
    "Chidi", "Marisol", "Jasper", "Dalia", "Quentin", "Sunita", "Rory", "Valentina", "Ezra", "Halima", "Bruno", "Odessa",
]
LAST_NAMES = [
    "Chen", "Patel", "Alvarez", "Whitlock", "Brooks", "Okafor", "Lindqvist", "Reyes", "Hale", "Sokolova", "Tanaka",
    "Mbeki", "Novak", "Fischer", "Costa", "Hughes", "Rahman", "Dubois", "Kowalski", "Santos", "Greene", "Ito",
    "Nguyen", "Garcia", "Haddad", "Johansson", "Adeyemi", "Kim", "Moreau", "Singh", "Castillo", "Baker", "Yamamoto",
    "Petrov", "Mensah", "Walsh", "Romano", "Khan", "Lund", "Ferreira", "Osei", "Marchetti", "Banerjee", "Schmidt",
    "Delgado", "Abubakar", "Park", "Laurent", "Iyer", "Navarro", "Carter", "Sato", "Ivanov", "Nkosi", "Byrne",
    "Ricci", "Hussain", "Berg", "Oliveira", "Boateng", "Esposito", "Gupta", "Weber", "Ortega", "Eze", "Lee",
    "Fontaine", "Mehta", "Ramos", "Sullivan", "Kato", "Volkov", "Dlamini", "Doyle", "Bianchi", "Aziz", "Holm",
    "Pereira", "Owusu", "Conti", "Reddy", "Keller", "Mendoza", "Okonkwo", "Choi", "Girard", "Nair", "Vargas",
    "Bennett", "Mori", "Kuznetsov", "Zulu", "Murphy", "Greco", "Farouk", "Dahl", "Almeida", "Asante", "Ward",
    "Vasquez", "Thackeray", "Achebe", "Lindgren", "Montoya", "Quinn", "Hoang", "Bergstrom", "Castellanos", "Finch",
]
SUPPORT_CEILING = 85           # support alone cannot push reputation past this
MAX_START_PRODUCTS = 4
HISTORY_LIMIT = 60
LOG_LIMIT = 60

# ---- The run: one year, scored on what your stake is worth ----
GAME_LENGTH = 52               # weeks until the score is locked in; the company runs on after it
MAX_INFUSION = 1_000_000_000_000  # the most one cash infusion can be, only to keep the numbers sane
GOAL = 2_500_000               # stake value that counts as a win
RATINGS = [                    # (stake worth at least, verdict)
    (6_000_000, "Runaway success"),
    (2_500_000, "Goal reached"),
    (1_200_000, "Solid business"),
    (500_000, "Getting by"),
    (1, "Barely standing"),
    (0, "Wiped out"),
]

RESCUE_GRANT = 50_000          # cash handed to a bankrupt company that plays on

# ---- Offers ----
OFFER_COOLDOWN = 5             # quiet weeks after any offer
INVESTOR_FROM_WEEK = 3
INVESTOR_CHANCE = 0.11         # per week, doubled when cash is short
BUYOUT_FROM_WEEK = 8
BUYOUT_CHANCE = 0.035
MIN_EQUITY_TO_SELL = 0.5       # investors stop calling once you own less than this
INVESTORS = [
    ("Priya Raman", "Northgate Capital"), ("Marcus Hale", "Hale & Finch"), ("Elena Sokolova", "Red Kite Ventures"),
    ("Tom Okafor", "Lantern Partners"), ("Grace Lindqvist", "Fjord Growth"), ("Daniel Reyes", "Copper Mill Fund"),
]
# ---- Events: crises and opportunities ----
EVENT_FROM_WEEK = 2
EVENT_CHANCE = 0.2            # per week, when nothing else is on the table
EVENT_COOLDOWN = 3
LOCALS = ["Maya Chen", "Dev Patel", "Rosa Alvarez", "Sam Whitlock", "Nia Brooks"]

# ---- Loans ----
LOAN_WEEKS = 26                # repayment term
LOAN_INTEREST = 0.15           # of the amount borrowed, over the whole term
MAX_LOANS = 3
MIN_LOAN = 5_000
CREDIT_FLOOR = 25_000          # any company can borrow this much
CREDIT_WEEKS = 6               # ...or this many weeks of revenue, if that is more
EARLY_REPAY_INTEREST = 0.5     # share of the remaining interest still charged when a loan is paid off early

BUYERS = ["Harland Group", "Meridian Holdings", "Blue Anchor Brands", "Castellan & Co", "Vireo Industries"]

DEFAULT_OPTIONS = [
    "Launch a marketing campaign",
    "Hire two more people",
    "Raise prices by 10%",
]

# What the model must return. Passed to Ollama as the `format` schema, which
# constrains the reply to this shape.
REPLY_SCHEMA = {
    "type": "object",
    "properties": {
        "narrative": {"type": "string"},
        "reactions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "source": {"type": "string"},
                    "text": {"type": "string"},
                    "sentiment": {"type": "string", "enum": ["positive", "neutral", "negative"]},
                },
                "required": ["source", "text", "sentiment"],
            },
        },
        "effects": {
            "type": "object",
            "properties": {
                "product_changes": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "product": {"type": "string"},
                            "demand_change_pct": {"type": "number"},
                            "new_price": {"type": "number"},
                            "quality_change": {"type": "number"},
                        },
                        "required": ["product", "demand_change_pct"],
                    },
                },
                "new_products": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "price": {"type": "number"},
                            "unit_cost": {"type": "number"},
                        },
                        "required": ["name", "price"],
                    },
                },
                "discontinued_products": {"type": "array", "items": {"type": "string"}},
                "hires": {"type": "integer"},
                "reputation_change": {"type": "number"},
                "morale_change": {"type": "number"},
                "one_time_cost": {"type": "number"},
                "one_time_income": {"type": "number"},
            },
            "required": ["product_changes", "hires", "reputation_change", "morale_change", "one_time_cost"],
        },
        "options": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["narrative", "reactions", "effects", "options"],
}

SYSTEM_PROMPT = """You are the game master of a CEO simulator. Each turn is one week. The player is the CEO and tells you one decision; you decide what happens as a result and reply with JSON only.

How to judge a decision:
- Be realistic and fair. Good ideas help, careless or greedy ones backfire, and most things are a trade-off. Do not reward every decision.
- Reward good ideas clearly. A sensible decision moves demand for the products it touches by 5 to 15 percent, a strong or well-funded one by 20 to 40. Reserve drops for decisions that would really put customers off.
- A decision usually affects every product it plausibly touches, so list each of them in product_changes.
- Launching a product costs $3,000, which the game charges itself. Do not add it to one_time_cost.
- When the player says money came in and gives the amount, treat it as having happened: put it in one_time_income and do not question it.
- Anything that costs money (campaigns, equipment, research, events, lawsuits) must appear in one_time_cost, in dollars. Money raised or won goes in one_time_income, and investors are hard to convince.
- Use the exact product names you are given in product_changes and discontinued_products.
- When the player changes a price, you MUST put the new price in new_price for every product affected. The game works out how price affects demand, so do not also change demand for it.
- Never write a specific price in the narrative. The game shows prices itself.
- Add to new_products only when the player launches something. hires is the number of people hired this week, negative for layoffs, 0 if staffing is untouched.
- reputation_change and morale_change are between -15 and 15.

What to write:
- narrative: 2 or 3 sentences, second person, on what you did and what came of it this week: who responded, what went right, what went wrong. Be concrete and specific to this company and this decision.
- No speeches or quoted announcements, no scene-setting, no deep breaths, no meetings with investors unless the decision involves one. Never reuse a sentence or an opening from an earlier week.
- Do not state revenue, profit or cash figures, and do not call the finances good or bad beyond what "how it is doing" tells you. The game reports the numbers.
- reactions: exactly 3 short posts, one from each of the voices you are given, each with a sentiment. They should sound different from each other and react to this week's decision in particular.
- options: exactly 3 different decisions the player could make next, each under 12 words, fitting the company's current situation. Never suggest launching a product that is already on sale."""


def _num(value, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _text(value, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit].strip()


def _money(amount: float) -> str:
    return f"${amount:,.2f}" if amount < 100 and amount != int(amount) else f"${amount:,.0f}"


# ---- Reading the player's decision ----
# Small models misreport the plain facts of a decision: they lay people off
# during an ad campaign, or skip a price change the player spelled out. So what
# the player said outright is read here, and the model's version of it is only
# trusted when the decision is at least about that subject.

_NUMBER_WORDS = {
    "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "twelve": 12, "fifteen": 15, "twenty": 20,
}
_COUNT = r"(\d{1,3}|" + "|".join(_NUMBER_WORDS) + r")\b"
# Verbs that are only ever about staff, and looser ones that need a staff word nearby
# ("add 2 people" is a hire, "add a product" is not).
_HIRE_VERB = re.compile(r"\b(?:(hire|hiring|recruit\w*|onboard\w*)|(bring(?:ing)? on|add(?:ing)?|grow|expand))\b", re.I)
_FIRE_VERB = re.compile(r"\b(?:(lay(?:ing)? ?off|fire|firing|let(?:ting)? go(?: of)?|dismiss\w*|sack\w*)|(cut(?:ting)?|drop|shed|reduce))\b", re.I)
_CLAUSE_END = re.compile(r"[.;!?]|,|\b(?:and|then|but|while)\b", re.I)
_STAFF_NOUN = re.compile(
    r"\b(people|person|staff|employees?|workers?|team|hires?|engineers?|developers?|designers?|baristas?|"
    r"sales\w*|reps?|managers?|assistants?|drivers?|cooks?|chefs?|marketers?|interns?|technicians?|agents?|"
    r"members?|specialists?|crew|headcount|recruits?|staffers?|testers?|writers?|analysts?)\b", re.I)
# Hiring one of these is buying a service, not adding to the payroll
_OUTSIDE_HELP = re.compile(r"\b(firm|agency|agencies|consultan\w*|contractors?|freelanc\w*|lawyers?|accountan\w*|compan(?:y|ies)|studio|influencers?)\b", re.I)
# A head count written as a figure: "20 production workers", but not "$3,000" or "3 weeks"
_HEADS = re.compile(r"(?<![$\d,.])\b(\d{1,3})\b(?![\d,.%]|\s?(?:k\b|percent|dollars|weeks?|months?|days?|hours?|years?))")
_HEADS_WORD = re.compile(r"\b(" + "|".join(w for w in _NUMBER_WORDS if w not in ("a", "an")) + r")\b", re.I)
_SINGLE = re.compile(r"^\s*(a|an|another)\b", re.I)
_STAFF_TOPIC = re.compile(
    r"\b(hir(e|es|ed|ing)|recruit\w*|staff\w*|employ\w*|lay ?offs?|fir(e|ed|ing)|headcount|"
    r"team|people|workers?|engineers?|sales ?(people|reps?)|downsiz\w*|let go)\b", re.I)
_PRICE_TOPIC = re.compile(r"\b(pric\w*|discount\w*|cheaper|sale|markup|mark up|charge|\$\s?\d)", re.I)
_PRICE_UP = re.compile(r"\b(rais\w*|increas\w*|hik\w*|bump\w*|up)\b", re.I)
_PRICE_DOWN = re.compile(r"\b(lower\w*|cut\w*|drop\w*|reduc\w*|decreas\w*|discount\w*|slash\w*|cheaper|down)\b", re.I)
_PRICE_RESTORE = re.compile(r"\b(original|restor\w*|revert\w*|back to (normal|before|what|where|the old|their old))\b", re.I)
# Used when the player changes prices without saying by how much ("reduce prices")
DEFAULT_PRICE_STEP = 0.10
_PERCENT = re.compile(r"(\d{1,3}(?:\.\d+)?)\s?(?:%|percent)", re.I)
_PRICE_TO = re.compile(r"\bto\s+\$?\s?(\d[\d,]*(?:\.\d{1,2})?)\b", re.I)
_INCOME_TOPIC = re.compile(
    # Money coming in, not going out: "investors" and "an investment", but not "invest in ads"
    r"\b((investors?|investment)(?!\s+(in|into|on)\b)|funding|fundrais\w*|funded by|"
    r"rais(e|ed|ing) (money|capital|a round|\$)|loan|borrow\w*|grant|"
    r"sell (a stake|shares|equity|the)|licens\w*|sponsorship|sponsored by|crowdfund\w*|ipo|"
    r"(cash|capital) (infusion|injection)|partner\w*|backer\w*|donations?|donors?|inherit\w*|settlement|refund|"
    r"(got|get|receiv\w*|secur\w*|land\w*|won|win) .{0,30}\$?\d)\b", re.I)
_LAUNCH_TOPIC = re.compile(
    r"\b(launch\w*|introduc\w*|releas\w*|new (product|line|item|service|flavou?r|model|version)|"
    r"start selling|add (a|an|new)|develop\w*|creat\w*|build\w*|expand\w*|"
    r"announc\w*|unveil\w*|roll(ing)? out|debut\w*)\b", re.I)
# "Launch a new product called Cold Brew for $6" -> everything before the name, then the price
_LAUNCH_LEAD = re.compile(
    r"^.*?\b(?:launch\w*|introduc\w*|releas\w*|announc\w*|unveil\w*|roll(?:ing)? out|debut\w*|"
    r"start selling|sell|add|develop\w*|creat\w*|build\w*)\b"
    # then any run of filler: "an all new product, the ..."
    r"(?:[\s:!,.\-]*\b(?:a|an|the|our|my|all|brand|new|product|item|line|service|offering|called|named)\b)*"
    r"[\s:!,.\-]*", re.I)
_LAUNCH_PRICE = re.compile(
    r"[\s,]*(?:\b(?:only|just|priced|selling|sells|costing|costs|starting|starts|retailing|retails)\b\s*)*"
    r"(?:\b(?:for|at|from)\b\s*)?(?:only\s+|just\s+)?"
    r"\$\s?(\d[\d,]*(?:\.\d{1,2})?).*$", re.I | re.S)
# A "launch" with a price that is not a product
_NOT_A_PRODUCT = re.compile(
    r"\b(campaigns?|ads?|advert\w*|marketing|promo\w*|events?|programs?|sales?|partnerships?|surveys?|"
    r"training|contests?|giveaways?|websites?|budget|bonus\w*|raises?|offices?|stores?|locations?)\b", re.I)
_DISCONTINUE_TOPIC = re.compile(r"\b(discontinu\w*|drop\w*|kill\w*|retir\w*|stop (selling|making)|remov\w*|axe|scrap\w*)\b", re.I)


# "$50,000", "50000", "50k", "1.5 million", but not "10%" or "2 people"
_AMOUNT = re.compile(
    r"\$\s?(\d[\d,]*(?:\.\d+)?)\s?(k|thousand|m|mil|million|b|bn|billion|tn|trillion)?\b"
    r"|\b(\d[\d,]*(?:\.\d+)?)\s?(k|thousand|m|mil|million|b|bn|billion|tn|trillion)\b"
    r"|\b((?:\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?)\b(?!\s?%)", re.I)
_AMOUNT_SCALE = {
    "k": 1e3, "thousand": 1e3, "m": 1e6, "mil": 1e6, "million": 1e6,
    "b": 1e9, "bn": 1e9, "billion": 1e9, "tn": 1e12, "trillion": 1e12,
}


def _stated_income(decision: str) -> Optional[float]:
    """Money the player says came in ("got a cash infusion of 50000"), else None.

    When a decision names several amounts, the one nearest the words about
    money coming in is taken, so "raise $50k and spend $10k on ads" reads as 50k.
    """
    topic = _INCOME_TOPIC.search(decision)
    if not topic:
        return None
    best = None
    for m in _AMOUNT.finditer(decision):
        number = m.group(1) or m.group(3) or m.group(5)
        unit = (m.group(2) or m.group(4) or "").lower()
        value = float(number.replace(",", "")) * _AMOUNT_SCALE.get(unit, 1)
        distance = min(abs(m.start() - topic.end()), abs(topic.start() - m.end()))
        if value > 0 and (best is None or distance < best[0]):
            best = (distance, value)
    return best[1] if best else None


_SPEND_TOPIC = re.compile(
    r"\b(spend\w*|spent|invest(s|ed|ing)?|pay\w*|paid|budget\w*|buy\w*|bought|purchas\w*|"
    r"allocat\w*|put|commit\w*|donat(e|es|ed|ing)|sponsor(s|ed|ing)?|fund(s|ed|ing)? (a|an|the|our|new))\b", re.I)


def _nearest_amount(decision: str, topic) -> Optional[float]:
    """The amount of money written closest to a matched phrase."""
    best = None
    for m in _AMOUNT.finditer(decision):
        number = m.group(1) or m.group(3) or m.group(5)
        unit = (m.group(2) or m.group(4) or "").lower()
        value = float(number.replace(",", "")) * _AMOUNT_SCALE.get(unit, 1)
        distance = min(abs(m.start() - topic.end()), abs(topic.start() - m.end()))
        if value > 0 and (best is None or distance < best[0]):
            best = (distance, value)
    return best[1] if best else None


def _stated_cost(decision: str) -> Optional[float]:
    """Money the player says to spend ("invest $10,000 in marketing"), else None."""
    topic = _SPEND_TOPIC.search(decision)
    if not topic:
        return None
    amount = _nearest_amount(decision, topic)
    # "Raise $50k and spend it on ads" names one amount, and it is the money coming in
    income = _INCOME_TOPIC.search(decision)
    if income and income.start() < topic.start() and len(_AMOUNT.findall(decision)) == 1:
        return None
    return amount


def _count(word: str) -> int:
    return int(word) if word.isdigit() else _NUMBER_WORDS.get(word.lower(), 0)


_SENTENCE_END = re.compile(r"[.;!?]|\b(?:then|but|while)\b", re.I)
_LIST_SPLIT = re.compile(r",|\band\b|\bplus\b", re.I)


def _stated_staffing(decision: str) -> Optional[dict]:
    """Hires and layoffs the player spelled out, as net head count by role, else None.

    "Hire 3 engineers and a support rep" is {"product": 3, "support": 1};
    "lay off two people" is {"general": -2}.
    """
    net: dict = {}

    def read(verbs, sign: int) -> None:
        for m in verbs.finditer(decision):
            rest = decision[m.end():]
            end = _SENTENCE_END.search(rest)
            parts = _LIST_SPLIT.split(rest[: end.start()] if end else rest)
            for i, part in enumerate(parts):
                staff = _STAFF_NOUN.search(part)
                if i and (not staff or _HIRE_VERB.search(part) or _FIRE_VERB.search(part)):
                    break  # the list of people has ended: "...and raise prices", "...and lay off 1"
                if _OUTSIDE_HELP.search(part) or (m.group(2) and not staff):
                    continue
                # "a new team of 20 workers" is 20, not the 1 that "a" suggests
                number = _HEADS.search(part) or _HEADS_WORD.search(part) or _SINGLE.search(part)
                if number:
                    role = next((r for r, words in _ROLE_WORDS if words.search(part)), "general")
                    net[role] = net.get(role, 0) + sign * (_count(number.group(1)) or 1)  # "another" is one

    read(_HIRE_VERB, 1)
    read(_FIRE_VERB, -1)
    return net or None


def _price_direction(decision: str) -> int:
    """+1 if the decision raises prices, -1 if it lowers them, 0 if neither or unclear."""
    if not _PRICE_TOPIC.search(decision):
        return 0
    up, down = bool(_PRICE_UP.search(decision)), bool(_PRICE_DOWN.search(decision))
    return 0 if up == down else (1 if up else -1)


def _stated_prices(decision: str, products: list[dict]) -> dict[str, float]:
    """New prices the player spelled out, by product id."""
    if not _PRICE_TOPIC.search(decision):
        return {}
    named = [p for p in products if p["name"].lower() in decision.lower()]
    if _PRICE_RESTORE.search(decision):
        return {p["id"]: p["start_price"] for p in (named or products) if p.get("start_price")}
    percent = _PERCENT.search(decision)
    if percent:
        direction = _price_direction(decision)
        if not direction:
            return {}  # no direction, or both: leave it to the model
        factor = 1 + float(percent.group(1)) / 100 * direction
        return {p["id"]: p["price"] * factor for p in (named or products)}
    target = _PRICE_TO.search(decision)
    targets = named or (products if len(products) == 1 else [])
    if target and len(targets) == 1:
        return {targets[0]["id"]: float(target.group(1).replace(",", ""))}
    return {}


# "Rename the company to X", "rebrand Donut as Glazed Ring", "change our name to X"
_RENAME_RE = re.compile(
    r"\b(?:renam\w*|rebrand\w*|chang\w*\s+(?:the\s+|our\s+|my\s+)?(?:(?:company|brand|business|product)(?:'s)?\s+)?name(?:\s+of)?)"
    r"\s*(?P<subject>.*?)\s*\b(?:to|as|into)\s+[\"“]?(?P<name>[^\"“”.!,;\n]{2,60}?)[\"”]?"
    r"\s*(?:$|[.!,;\n]|\s+(?:and|with|so|because|then)\b)", re.I)
_SUBJECT_FILLER = re.compile(r"\b(the|our|my|company|brand|business|product|name|whole|entire|us|it|ourselves)\b", re.I)


def _stated_rename(decision: str, company: str, products: list[dict]) -> Optional[tuple]:
    """("company", None, new_name) or ("product", product, new_name) if the player renamed something."""
    match = _RENAME_RE.search(decision)
    if not match:
        return None
    subject = match.group("subject").lower()
    name = _text(match.group("name"), 60).strip("'‘’ ")
    if len(name) < 2:
        return None
    # Longest name first, so "Dozen Donuts" is not mistaken for "Donut"
    for product in sorted(products, key=lambda p: -len(p["name"])):
        if product["name"].lower() in subject:
            return ("product", product, name[:40])
    leftover = _SUBJECT_FILLER.sub("", subject.replace(company.lower(), ""))
    if leftover.strip(" '’s"):
        return None  # renaming something the game does not track
    return ("company", None, name)


def _stated_launch(decision: str, taken: set) -> Optional[dict]:
    """A product the player launched by name and price, else None."""
    if not _LAUNCH_TOPIC.search(decision):
        return None
    price = _LAUNCH_PRICE.search(decision)
    if not price:
        return None
    name = _text(_LAUNCH_LEAD.sub("", decision[: price.start()], count=1), 40).strip(" .,!:-\"'")
    if len(name) < 2 or name.lower() in taken or _NOT_A_PRODUCT.search(name):
        return None
    return {"name": name, "price": float(price.group(1).replace(",", ""))}


def _product(name: str, price: float, unit_cost: float, revenue_target: float, quality: int) -> dict:
    return {
        "id": uuid.uuid4().hex[:8],
        "name": name,
        "price": round(price, 2),
        "start_price": round(price, 2),
        "unit_cost": round(unit_cost, 2),
        # Units a week at average reputation and quality
        "demand": max(1, round(revenue_target / price)),
        "base_demand": max(1, round(revenue_target / price)),
        "quality": quality,
        "active": True,
        "units_sold": 0,
        "revenue": 0,
    }


def _mod(state: dict, key: str) -> float:
    """A multiplier from the run's difficulty and founder style combined."""
    difficulty = DIFFICULTIES.get(state.get("difficulty"), {})
    style = STYLES.get(state.get("style"), {})
    return difficulty.get(key, 1.0) * style.get(key, 1.0)


def _setting(state: dict, key: str):
    """A plain setting that only difficulty controls."""
    return DIFFICULTIES.get(state.get("difficulty"), DIFFICULTIES["normal"])[key]


def _person(s: dict, rng: random.Random, role: str, level: str) -> dict:
    """Someone who could be hired, or has been. Their salary is fixed when they are created."""
    taken = {p["name"] for p in (s.get("staff") or []) + (s.get("candidates") or [])}
    name = next(
        (n for n in (f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}" for _ in range(40)) if n not in taken),
        f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}",
    )
    return {
        # From the same random source as the rest, so a seeded run gives the same people
        "id": f"{rng.getrandbits(32):08x}",
        "name": name,
        "role": role,
        "level": level,
        "power": LEVELS[level]["power"],
        "salary": round(SALARY * ROLES[role]["salary"] * LEVELS[level]["salary"] * _mod(s, "salary")),
        "fee": LEVELS[level]["fee"],
    }


def _candidates(s: dict, rng: random.Random, count: int) -> list[dict]:
    """A fresh set of people looking for work, spread across roles and levels."""
    roles = ["general"] * 5 + ["sales"] * 3 + ["product"] * 2 + ["support"] * 2
    levels = ["junior"] * 4 + ["mid"] * 4 + ["senior"] * 3 + ["star"]
    pool: list[dict] = []
    scratch = {**s, "candidates": pool}
    for i in range(count):
        # The first few cover each role once, so no draft is missing a kind of person.
        role = list(ROLES)[i] if i < len(ROLES) and count >= DRAFT_POOL else rng.choice(roles)
        pool.append(_person(scratch, rng, role, rng.choice(levels)))
    return sorted(pool, key=lambda p: (list(ROLES).index(p["role"]), -p["power"]))


def _sync(s: dict) -> None:
    """Keep the head counts in step with the roster. The roster is the truth; these are for display."""
    staff = s.get("staff") or []
    s["employees"] = len(staff)
    s["team"] = {role: sum(1 for p in staff if p["role"] == role) for role in ROLES}


def team(state: dict) -> dict:
    """Head count by role."""
    staff = state.get("staff") or []
    return {role: sum(1 for p in staff if p["role"] == role) for role in ROLES}


def _strength(state: dict, role: str) -> float:
    """How much specialist work a role gets done: the combined power of its best few people."""
    powers = sorted((p["power"] for p in state.get("staff") or [] if p["role"] == role), reverse=True)
    return sum(powers[:SPECIALISTS_COUNTED])


def _capacity_power(state: dict) -> float:
    return sum(p["power"] for p in state.get("staff") or [])


def _staff_change(s: dict, count: int, role: str = "general", rng: Optional[random.Random] = None) -> int:
    """Hire (count > 0) or let go (count < 0) without naming anyone. Returns the change made.

    Used for typed decisions and events. Hires are mid-level. Layoffs take the
    least experienced first: from the named role, then generalists, then anyone.
    The company never drops below one person.
    """
    rng = rng or random.Random()
    staff = list(s.get("staff") or [])
    role = role if role in ROLES else "general"
    if count > 0:
        count = min(count, MAX_TEAM - len(staff))
        for _ in range(max(0, count)):
            staff.append(_person({**s, "staff": staff}, rng, role, "mid"))
        count = max(0, count)
    else:
        to_go = min(-count, max(0, len(staff) - 1))
        count = -to_go
        for pool in (role, "general", None):
            ranked = sorted((p for p in staff if pool is None or p["role"] == pool), key=lambda p: p["power"])
            for person in ranked[:to_go]:
                staff.remove(person)
                to_go -= 1
            if not to_go:
                break
    s["staff"] = staff
    _sync(s)
    return count


def payroll_for(state: dict) -> float:
    staff = state.get("staff") or []
    return sum(p["salary"] for p in staff) + DESK_COST * len(staff)


def hire_candidate(state: dict, candidate_id: str) -> dict:
    """Hire someone from the pool. Costs their signing fee now and their salary every week. No turn used."""
    s = copy.deepcopy(state)
    person = next((c for c in s.get("candidates") or [] if c["id"] == candidate_id), None)
    if s["status"] != "active" or not person:
        raise ValueError("That person is no longer available.")
    if len(s.get("staff") or []) >= MAX_TEAM:
        raise ValueError(f"A team tops out at {MAX_TEAM} people.")
    if person["fee"] > s["cash"]:
        raise ValueError(f"You need {_money(person['fee'])} in cash to hire {person['name']}.")
    s["cash"] -= person["fee"]
    s["candidates"] = [c for c in s["candidates"] if c["id"] != candidate_id]
    s["staff"] = (s.get("staff") or []) + [person]
    _sync(s)
    if s["turn"] > 0:
        s["pending"] = (s.get("pending") or []) + [
            f"Hired {person['name']}, {LEVELS[person['level']]['label'].lower()} {ROLES[person['role']]['one']}",
        ]
    s["valuation"] = valuation(s)
    return s


def release_staff(state: dict, staff_id: str) -> dict:
    """Let one named person go. No turn used.

    Before week one this is undoing a draft pick: the fee comes back and they
    return to the pool. After that it costs severance and the team notices.
    """
    s = copy.deepcopy(state)
    staff = s.get("staff") or []
    person = next((p for p in staff if p["id"] == staff_id), None)
    if s["status"] != "active" or not person:
        raise ValueError("That person is not on the team.")
    if s["turn"] == 0:
        s["cash"] += person["fee"]
        s["candidates"] = (s.get("candidates") or []) + [person]
    else:
        if len(staff) <= 1:
            raise ValueError("A company needs at least one person.")
        severance = person["salary"] * SEVERANCE_WEEKS
        s["cash"] -= severance
        s["morale"] = round(_clamp(s["morale"] - 3, 0, 100))
        s["pending"] = (s.get("pending") or []) + [f"Let {person['name']} go, paying {_money(severance)} severance"]
    s["staff"] = [p for p in staff if p["id"] != staff_id]
    _sync(s)
    s["valuation"] = valuation(s)
    return s


def launch_cost_for(state: dict) -> int:
    return round(LAUNCH_COST * _mod(state, "launch"))


_ROLE_WORDS = [
    ("sales", re.compile(r"\b(sales\w*|sellers?|account (managers?|execs?)|marketers?|marketing (people|staff|hires?|team))\b", re.I)),
    ("support", re.compile(r"\b(support|customer service|service (reps?|agents?|staff)|helpdesk|community managers?)\b", re.I)),
    ("product", re.compile(r"\b(engineers?|developers?|designers?|product (people|staff|team|managers?)|researchers?|r&d|quality (control|assurance)|qa|testers?)\b", re.I)),
]


def _week_summary(s: dict, revenue: float, profit: float, lost: float) -> str:
    """One plain sentence of what the numbers did, so the story never has to be trusted for them."""
    previous = s["history"][-2]["revenue"] if len(s["history"]) > 1 else None
    if previous is None or previous <= 0:
        text = f"Sales of {_money(round(revenue))}"
    else:
        change = round(100 * (revenue - previous) / previous)
        text = (f"Sales flat at {_money(round(revenue))}" if change == 0
                else f"Sales {'up' if change > 0 else 'down'} {abs(change)}% to {_money(round(revenue))}")
    sellers = [p for p in s["products"] if p["active"] and p["revenue"] > 0]
    if len(sellers) > 1:
        text += f", led by {max(sellers, key=lambda p: p['revenue'])['name']}"
    text += f". {'Profit' if profit >= 0 else 'Loss'} of {_money(abs(round(profit)))}."
    if lost >= 100:
        text += f" About {_money(round(lost, -2))} of orders went unfilled."
    return text


def _expected_revenue(state: dict) -> float:
    """A week's sales at the current demand, reputation and quality."""
    reputation_factor = 0.5 + state["reputation"] / 100
    return sum(
        p["demand"] * p["price"] * reputation_factor * (0.7 + 0.5 * p["quality"] / 100)
        for p in state["products"] if p["active"]
    )


def valuation(state: dict) -> int:
    """What the whole company is worth: cash, plus a year of sales and profit at a multiple.

    Uses the last four weeks so one good or bad week does not swing it, and profit
    before one-off spending so an ad campaign is not read as a failing business.
    """
    recent = state["history"][-4:]
    if recent:
        revenue = sum(h["revenue"] for h in recent) / len(recent)
        profit = sum(h.get("operating", h["profit"]) for h in recent) / len(recent)
    else:
        revenue, profit = _expected_revenue(state), 0
    sales_multiple = 0.1 + 0.4 * state["reputation"] / 100
    profit_multiple = 3 if profit > 0 else 2
    worth = max(0, state["cash"]) + 52 * revenue * sales_multiple + 52 * profit * profit_multiple
    owed = sum(loan["weekly"] * loan["weeks_left"] for loan in state.get("loans") or [])
    return max(0, round(worth - owed))


def stake_value(state: dict) -> int:
    return round(state["valuation"] * state["equity"])


# (id, label, test). Each is reached once per company and marked in that week's story.
MILESTONES = [
    ("profit", "First profitable week", lambda s: s["last"]["profit"] > 0),
    ("rev20", "$20,000 in a week", lambda s: s["last"]["revenue"] >= 20_000),
    ("rev50", "$50,000 in a week", lambda s: s["last"]["revenue"] >= 50_000),
    ("rev100", "$100,000 in a week", lambda s: s["last"]["revenue"] >= 100_000),
    ("staff10", "A team of 10", lambda s: s["employees"] >= 10),
    ("staff25", "A team of 25", lambda s: s["employees"] >= 25),
    ("val500", "Worth half a million", lambda s: s["valuation"] >= 500_000),
    ("val1m", "A million-dollar company", lambda s: s["valuation"] >= 1_000_000),
    ("val2m", "Worth $2.5 million", lambda s: s["valuation"] >= 2_500_000),
    ("val5m", "Worth $5 million", lambda s: s["valuation"] >= 5_000_000),
    ("rep75", "A name people trust", lambda s: s["reputation"] >= 75),
    ("range5", "Five products on sale", lambda s: sum(p["active"] for p in s["products"]) >= 5),
    ("half", "Half a year in business", lambda s: s["turn"] >= 26),
    ("debtfree", "Debt free again", lambda s: s.get("borrowed") and not s.get("loans")),
]


def _new_milestones(s: dict) -> list[str]:
    """Record any milestones reached this week and return their labels."""
    reached = s.setdefault("milestones", [])
    have = {m["id"] for m in reached}
    labels = []
    for mid, label, test in MILESTONES:
        if mid not in have and test(s):
            reached.append({"id": mid, "label": label, "turn": s["turn"]})
            labels.append(label)
    return labels


def _finish(s: dict, outcome: str, company_value: float) -> None:
    """End the run and record the result. The score is what the player's stake is worth."""
    score = 0 if outcome == "bankrupt" else round(company_value * s["equity"])
    s["status"] = outcome
    s["offer"] = None
    s["options"] = []
    s["result"] = {
        "outcome": outcome,
        "score": score,
        "company_value": round(company_value),
        "weeks": s["turn"],
        "rating": next(label for floor, label in RATINGS if score >= floor),
        "goal_met": score >= GOAL,
        # Cash the player typed into existence, so a score can be read for what it is
        "typed_cash": round(s.get("typed_cash", 0)),
    }


def continue_game(state: dict) -> dict:
    """Play on after a run has ended, as free play.

    The result already recorded stays as the official score; nothing after this
    changes it. A bankrupt company is put back on its feet with a grant. A sold
    company cannot be continued: selling is the one ending that is final.
    """
    s = copy.deepcopy(state)
    if s["status"] == "active":
        raise ValueError("This game is still going.")
    if s["status"] == "sold":
        raise ValueError("You sold this company. It is no longer yours to run.")
    s["official_result"] = s.get("official_result") or s.get("result")
    if s["status"] == "bankrupt":
        s["cash"] = max(0, s["cash"]) + RESCUE_GRANT
        s["pending"] = (s.get("pending") or []) + [f"Took a {_money(RESCUE_GRANT)} rescue grant"]
    s["status"] = "active"
    s["result"] = None
    s["free_play"] = True
    s["options"] = list(DEFAULT_OPTIONS)
    s["valuation"] = valuation(s)
    return s


YES_NO = [{"id": "accept", "label": "Accept"}, {"id": "reject", "label": "Reject"}]


def _effect_hint(fx: dict) -> str:
    """What a choice does, in a few plain words for the button's caption."""
    parts = []
    if fx.get("cash", 0) < 0:
        parts.append(f"Costs {_money(-fx['cash'])}")
    if fx.get("cash", 0) > 0:
        parts.append(f"Brings in {_money(fx['cash'])}")
    for key, word in (("reputation", "Reputation"), ("morale", "Morale"), ("demand_pct", "Demand"), ("quality", "Quality")):
        if fx.get(key):
            parts.append(f"{word} {'up' if fx[key] > 0 else 'down'}")
    if fx.get("unit_cost_pct"):
        parts.append(f"Costs to make {'up' if fx['unit_cost_pct'] > 0 else 'down'} {abs(fx['unit_cost_pct'])}%")
    if fx.get("employees"):
        parts.append(f"Lose {-fx['employees']} staff" if fx["employees"] < 0 else f"Gain {fx['employees']} staff")
    if fx.get("staff_id"):
        parts.append("They leave")
    return ". ".join(parts) + "." if parts else "Nothing changes."


def _choice(cid: str, label: str, note: str, later: Optional[tuple] = None, **fx) -> dict:
    """One answer to an event. `later` is (follow-up key, earliest week, latest week):
    a consequence that turns up some weeks on. The caption never mentions it."""
    choice = {"id": cid, "label": label, "note": note, "effects": fx, "hint": _effect_hint(fx)}
    if later:
        choice["later"] = {"key": later[0], "min": later[1], "max": later[2]}
    return choice


def _schedule(s: dict, choice: dict) -> None:
    """Queue the follow-up to a choice, if it has one."""
    later = choice.get("later")
    if not later:
        return
    # Spread across the window without needing a random source here
    delay = later["min"] + (s["turn"] * 7 + len(choice["note"])) % (later["max"] - later["min"] + 1)
    s["scheduled"] = (s.get("scheduled") or [])[-9:] + [
        {"key": later["key"], "due": s["turn"] + delay, "ctx": later.get("ctx") or {}},
    ]


def _followup(s: dict, item: dict) -> Optional[dict]:
    """The event a past choice has led to. Built when it comes due, so costs fit the company as it is now."""
    active = [p for p in s["products"] if p["active"]]
    if not active:
        return None
    ctx = item.get("ctx") or {}
    product = next((p for p in active if p["id"] == ctx.get("pid")), active[0])
    name, pid = product["name"], product["id"]
    company = s["company"]["name"]
    local = ctx.get("local") or LOCALS[0]
    week = max(2_000, s["last"]["revenue"] or _expected_revenue(s))

    def cost(share: float) -> int:
        return -int(max(500, round(week * share, -2)))

    events = {
        "supplier_quality": ("crisis", {
            "title": "Quality complaints",
            "text": f"Since you changed supplier, customers say {company}'s products are not what they were.",
            "choices": [
                _choice("revert", "Go back to the old supplier", "Went back to the old supplier", unit_cost_pct=8, quality=8),
                _choice("checks", "Pay for tighter quality checks", "Brought in tighter quality checks", cash=cost(0.4), quality=4),
                _choice("live", "Live with it", "Lived with complaints about quality", reputation=-3),
            ],
            "default": "live",
        }),
        "defect_lawsuit": ("crisis", {
            "title": "Lawsuit",
            "text": f"A customer says the faulty {name} you ignored cost them, and is suing.",
            "choices": [
                _choice("settle", "Settle out of court", f"Settled a lawsuit over {name}", cash=cost(0.8)),
                _choice("fight", "Fight it in court", f"Fought a lawsuit over {name} in court", cash=cost(0.3), reputation=-3),
            ],
            "default": "fight",
        }),
        "coverup": ("crisis", {
            "title": "The quiet fix comes out",
            "text": f"A journalist has learned you fixed the {name} defect without telling anyone.",
            "choices": [
                _choice("admit", "Come clean", f"Admitted to quietly fixing {name}", reputation=-3),
                _choice("deny", "Deny it", f"Denied quietly fixing {name}", reputation=-8),
            ],
            "default": "deny",
        }),
        "breakdown": ("crisis", {
            "title": "A second breakdown",
            "text": "The equipment you kept running broken has taken another machine with it.",
            "choices": [
                _choice("replace", "Replace both", "Replaced two broken machines", cash=cost(0.7)),
                _choice("limp", "Keep going as you are", "Kept going with two broken machines", demand_pct=-4, morale=-3),
            ],
            "default": "limp",
        }),
        "boycott": ("crisis", {
            "title": "Boycott call",
            "text": f"The reviewer you argued with is urging people to stop buying from {company}.",
            "choices": [
                _choice("apologise", "Apologise after all", "Apologised to a reviewer after a boycott call", cash=cost(0.2), reputation=-1),
                _choice("ignore", "Ignore it", "Ignored a boycott call", reputation=-3, demand_pct=-3),
            ],
            "default": "ignore",
        }),
        "recall_praise": ("opportunity", {
            "title": "Praise for the recall",
            "text": f"A consumer group has praised how {company} handled the {name} recall.",
            "choices": [
                _choice("campaign", "Build a campaign around it", "Ran a campaign on the recall praise", cash=cost(0.3), reputation=5, demand_pct=3),
                _choice("modest", "Let it speak for itself", "Let praise for the recall speak for itself", reputation=2),
            ],
        }),
        "referral": ("opportunity", {
            "title": "A referral",
            "text": "Someone on the team has a friend who wants to join, with no recruiter fee.",
            "choices": [
                _choice("hire", "Hire them", "Hired a friend of the team", employees=1, morale=2),
                _choice("pass", "Not now", "Passed on a referred hire"),
            ],
        }),
        "endorsement_repeat": ("opportunity", {
            "title": "A second endorsement",
            "text": f"{local}'s followers loved the first promotion. A second round is on offer at half the price.",
            "choices": [
                _choice("pay", "Do it again", f"Paid {local} for a second endorsement", cash=cost(0.5), reputation=3, demand_pct=3),
                _choice("pass", "Leave it there", f"Passed on a second endorsement from {local}"),
            ],
        }),
        "distributor": ("opportunity", {
            "title": "Distributor interest",
            "text": f"A distributor you met at the trade show wants to carry {name}, for a cut.",
            "choices": [
                _choice("sign", "Sign with them", f"Signed a distributor for {name}", demand_pct=10, unit_cost_pct=4, product_id=pid),
                _choice("pass", "Stay independent", f"Turned down a distributor for {name}"),
            ],
        }),
    }
    if item["key"] not in events:
        return None
    kind, event = events[item["key"]]
    return {"type": "event", "kind": kind, "from": "", "followup": True, **event}


def _event(s: dict, rng: random.Random) -> Optional[dict]:
    """A crisis or an opportunity, with every number fixed here.

    Costs scale with weekly sales so an event stings the same at any size. A crisis
    has a `default`: the choice that happens if the player just plays on.
    """
    active = [p for p in s["products"] if p["active"]]
    if not active:
        return None
    company = s["company"]["name"]
    product = rng.choice(active)
    name, pid = product["name"], product["id"]
    week = max(2_000, s["last"]["revenue"] or _expected_revenue(s))

    def cost(share: float) -> int:
        return -int(max(500, round(week * share, -2)))

    crises = [
        {
            "title": "Product defect",
            "text": f"A batch of {name} has a defect, and customers are starting to notice.",
            "choices": [
                _choice("recall", "Recall and refund", f"Recalled a faulty batch of {name}", later=("recall_praise", 4, 7), cash=cost(0.6), reputation=2),
                _choice("patch", "Fix it quietly", f"Quietly fixed a defect in {name}", later=("coverup", 4, 8), cash=cost(0.15), reputation=-4, demand_pct=-6, product_id=pid),
                _choice("ignore", "Ignore it", f"Ignored a defect in {name}", later=("defect_lawsuit", 3, 6), reputation=-6, demand_pct=-10, product_id=pid),
            ],
            "default": "ignore",
        },
        {
            "title": "Bad review going viral",
            "text": f"A scathing review of {company} is spreading online.",
            "choices": [
                _choice("apologise", "Apologise and make it right", "Apologised publicly for a bad review", cash=cost(0.2), reputation=1),
                _choice("argue", "Push back publicly", "Argued with a reviewer in public", later=("boycott", 2, 4), reputation=-5),
                _choice("silent", "Say nothing", "Stayed silent about a viral bad review", reputation=-3),
            ],
            "default": "silent",
        },
        {
            "title": "Supplier price rise",
            "text": "Your main supplier is putting prices up.",
            "choices": [
                _choice("absorb", "Accept the new prices", "Accepted a supplier price rise", unit_cost_pct=5),
                _choice("commit", "Lock in the old price with a bulk order", "Locked in supplier prices with a bulk order", cash=cost(0.5)),
                _choice("switch", "Switch to a cheaper supplier", "Switched to a cheaper supplier", later=("supplier_quality", 4, 7), unit_cost_pct=-5, quality=-8),
            ],
            "default": "absorb",
        },
        {
            "title": "Equipment failure",
            "text": "A key piece of equipment has broken down.",
            "choices": [
                _choice("repair", "Repair it now", "Paid for an urgent equipment repair", cash=cost(0.5)),
                _choice("limp", "Make do without it", "Carried on with broken equipment", later=("breakdown", 3, 5), demand_pct=-5, morale=-3),
            ],
            "default": "limp",
        },
    ]
    if s["employees"] > 2:
        key = max(s["staff"], key=lambda p: p["power"])
        title = f"{LEVELS[key['level']]['label'].lower()} {ROLES[key['role']]['one']}"
        crises.append({
            "title": "Key employee may leave",
            "text": f"{key['name']}, your {title}, has an offer from a competitor and is thinking it over.",
            "choices": [
                _choice("bonus", "Pay a retention bonus", f"Paid a bonus to keep {key['name']}", cash=cost(0.4), morale=3),
                _choice("go", "Let them go", f"Lost {key['name']} to a competitor", staff_id=key["id"], morale=-6),
            ],
            "default": "go",
        })

    local = rng.choice(LOCALS)
    opportunities = [
        {
            "title": "Bulk order",
            "text": f"A local chain wants a large one-off order of {name} at a discount. It would stretch the team.",
            "choices": [
                _choice("take", "Take the order", f"Took a large discounted order of {name}", cash=-cost(0.6), morale=-5),
                _choice("pass", "Turn it down", f"Turned down a bulk order of {name}"),
            ],
        },
        {
            "title": "Endorsement",
            "text": f"{local}, well known locally, will promote {company} for a fee.",
            "choices": [
                _choice("pay", "Pay for the endorsement", f"Paid {local} to endorse {company}", later=("endorsement_repeat", 4, 7), cash=cost(1.0), reputation=4, demand_pct=3),
                _choice("pass", "Pass", f"Passed on an endorsement from {local}"),
            ],
        },
        {
            "title": "Cheap equipment",
            "text": "A competitor is closing down and selling good equipment cheaply.",
            "choices": [
                _choice("buy", "Buy it", "Bought a closing competitor's equipment", cash=cost(0.9), quality=4),
                _choice("pass", "Pass", "Passed on cheap equipment"),
            ],
        },
        {
            "title": "Trade show",
            "text": "There is a stand free at next month's trade show.",
            "choices": [
                _choice("go", "Book the stand", "Booked a stand at a trade show", later=("distributor", 3, 5), cash=cost(0.5), demand_pct=3, reputation=1),
                _choice("pass", "Skip it", "Skipped a trade show"),
            ],
        },
        {
            "title": "Team day out",
            "text": "The team has been working hard and is hinting at a day off together.",
            "choices": [
                _choice("treat", "Pay for a day out", "Paid for a team day out", later=("referral", 3, 6), cash=cost(0.25), morale=8),
                _choice("pass", "Not right now", "Said no to a team day out", morale=-2),
            ],
        },
    ]
    kind, pool = ("crisis", crises) if rng.random() < _setting(s, "crisis") else ("opportunity", opportunities)
    # Not the same event twice running
    pool = [e for e in pool if e["title"] != s.get("last_event")] or pool
    event = rng.choice(pool)
    for choice in event["choices"]:
        if "later" in choice:
            # What the follow-up needs to refer back to
            choice["later"]["ctx"] = {"pid": pid, "local": local}
    return {"type": "event", "kind": kind, "from": "", **event}


def _apply_event_effects(s: dict, fx: dict) -> None:
    s["cash"] += fx.get("cash", 0)
    s["reputation"] = round(_clamp(s["reputation"] + fx.get("reputation", 0), 0, 100))
    s["morale"] = round(_clamp(s["morale"] + fx.get("morale", 0), 0, 100))
    if fx.get("employees"):
        _staff_change(s, fx["employees"])
    if fx.get("staff_id") and len(s.get("staff") or []) > 1:
        s["staff"] = [p for p in s["staff"] if p["id"] != fx["staff_id"]]
        _sync(s)
    for p in s["products"]:
        if not p["active"] or fx.get("product_id") not in (None, p["id"]):
            continue
        if fx.get("demand_pct"):
            p["demand"] = max(0, round(p["demand"] * (1 + _grow(p, fx["demand_pct"]) / 100)))
        if fx.get("quality"):
            p["quality"] = round(_clamp(p["quality"] + fx["quality"], 0, 100))
        if fx.get("unit_cost_pct"):
            p["unit_cost"] = round(_clamp(p["unit_cost"] * (1 + fx["unit_cost_pct"] / 100), 0.01, p["price"] * 0.95), 2)


def _maybe_offer(s: dict, rng: random.Random) -> Optional[dict]:
    """Now and then something lands on the CEO's desk. The numbers are worked out here, never by the model."""
    # A consequence that has come due goes first; it has waited long enough.
    due = next((item for item in s.get("scheduled") or [] if item["due"] <= s["turn"]), None)
    if due:
        s["scheduled"].remove(due)
        followup = _followup(s, due)
        if followup:
            return followup

    company = s["company"]["name"]
    worth = s["valuation"]
    weekly_costs = max(1, s["last"]["costs"])
    short_of_cash = s["cash"] < 5 * weekly_costs

    if s["turn"] - s.get("last_offer_turn", -OFFER_COOLDOWN) >= OFFER_COOLDOWN:
        if s["turn"] >= BUYOUT_FROM_WEEK and worth >= 150_000 and rng.random() < BUYOUT_CHANCE:
            buyer = rng.choice(BUYERS)
            price = int(round(worth * rng.uniform(0.8, 1.4), -3))
            yours = round(price * s["equity"])
            return {
                "type": "buyout", "from": buyer, "amount": price, "yours": yours, "title": "Buyout offer",
                "text": f"{buyer} wants to buy {company} outright for {_money(price)}. "
                        + (f"Your share would be {_money(yours)}. " if s["equity"] < 1 else "")
                        + "Accepting ends the game.",
                "choices": YES_NO,
            }

        chance = INVESTOR_CHANCE * (2 if short_of_cash else 1)
        if s["turn"] >= INVESTOR_FROM_WEEK and s["equity"] >= MIN_EQUITY_TO_SELL and worth > 0 and rng.random() < chance:
            person, firm = rng.choice(INVESTORS)
            stake = rng.choice([5, 8, 10, 12, 15, 20, 25])
            # Investors can tell when you need the money, and pay less for the same slice.
            generosity = (rng.uniform(0.5, 0.75) if short_of_cash else rng.uniform(0.75, 1.15)) * _mod(s, "investor")
            amount = int(max(5_000, round(worth * stake / 100 * generosity, -3)))
            return {
                "type": "investment", "from": f"{person} of {firm}", "amount": amount, "stake": stake,
                "title": "Investment offer",
                "text": f"{person} of {firm} offers {_money(amount)} for a {stake}% stake in {company}. "
                        f"From then on they take {stake}% of every profitable week.",
                "choices": YES_NO,
            }

    if (
        s["turn"] >= EVENT_FROM_WEEK
        and s["turn"] - s.get("last_event_turn", -EVENT_COOLDOWN) >= EVENT_COOLDOWN
        and rng.random() < EVENT_CHANCE
    ):
        return _event(s, rng)
    return None


def answer_offer(state: dict, choice_id: str) -> dict:
    """Answer whatever is on the table: an offer or an event. Does not use a turn."""
    s = copy.deepcopy(state)
    offer = s.get("offer")
    if not offer or s["status"] != "active":
        raise ValueError("There is nothing to answer.")
    notes = s.get("pending") or []

    if offer["type"] == "event":
        choice = next((c for c in offer["choices"] if c["id"] == choice_id), None)
        if not choice:
            raise ValueError("That is not one of the choices.")
        s["offer"] = None
        _apply_event_effects(s, choice["effects"])
        _schedule(s, choice)
        s["pending"] = notes + [choice["note"]]
        s["valuation"] = valuation(s)
        return s

    if choice_id not in ("accept", "reject"):
        raise ValueError("That is not one of the choices.")
    s["offer"] = None
    if choice_id == "reject":
        s["pending"] = notes + [f"Turned down an offer from {offer['from']}"]
    elif offer["type"] == "buyout":
        _finish(s, "sold", offer["amount"])
    else:
        s["cash"] += offer["amount"]
        s["equity"] = round(s["equity"] * (1 - offer["stake"] / 100), 4)
        s["valuation"] = valuation(s)
        s["pending"] = notes + [f"Took {_money(offer['amount'])} from {offer['from']} for {offer['stake']}%"]
    return s


# ---- Loans ----

def debt(state: dict) -> int:
    """Everything still owed, interest included."""
    return sum(loan["weekly"] * loan["weeks_left"] for loan in state.get("loans") or [])


def credit_available(state: dict) -> int:
    """How much more the bank will lend, to the nearest thousand."""
    if len(state.get("loans") or []) >= MAX_LOANS:
        return 0
    limit = max(CREDIT_FLOOR, CREDIT_WEEKS * state["last"]["revenue"])
    owed_principal = sum(loan["principal"] * loan["weeks_left"] / LOAN_WEEKS for loan in state.get("loans") or [])
    return max(0, int((limit - owed_principal) // 1000 * 1000))


def payoff_amount(loan: dict) -> int:
    """What it costs to clear a loan today: what is left of the principal, plus part of the interest still to come."""
    principal_left = loan["principal"] * loan["weeks_left"] / LOAN_WEEKS
    return math.ceil(principal_left * (1 + LOAN_INTEREST * EARLY_REPAY_INTEREST))


def repay_loan(state: dict, index: int) -> dict:
    """Pay a loan off early, saving some of its remaining interest. Does not use a turn."""
    s = copy.deepcopy(state)
    loans = s.get("loans") or []
    if s["status"] != "active" or not 0 <= index < len(loans):
        raise ValueError("That loan cannot be repaid.")
    cost = payoff_amount(loans[index])
    if cost > s["cash"]:
        raise ValueError(f"You need {_money(cost)} in cash to pay that loan off.")
    s["cash"] -= cost
    s["loans"] = loans[:index] + loans[index + 1:]
    s["credit"] = credit_available(s)
    s["valuation"] = valuation(s)
    s["pending"] = (s.get("pending") or []) + [f"Paid off a loan early for {_money(cost)}"]
    return s


def take_loan(state: dict, amount: float) -> dict:
    """Borrow from the bank: cash now, repaid weekly with interest. Does not use a turn."""
    s = copy.deepcopy(state)
    amount = int(_num(amount))
    if s["status"] != "active":
        raise ValueError("This game is over.")
    if len(s.get("loans") or []) >= MAX_LOANS:
        raise ValueError(f"The bank will not carry more than {MAX_LOANS} loans at once.")
    available = credit_available(s)
    if amount < MIN_LOAN:
        raise ValueError(f"The smallest loan is {_money(MIN_LOAN)}.")
    if amount > available:
        raise ValueError(f"The bank will lend you {_money(available)} at most right now.")
    weekly = math.ceil(amount * (1 + LOAN_INTEREST) / LOAN_WEEKS)
    s["loans"] = (s.get("loans") or []) + [{"principal": amount, "weekly": weekly, "weeks_left": LOAN_WEEKS}]
    s["borrowed"] = True
    s["cash"] += amount
    s["credit"] = credit_available(s)
    s["valuation"] = valuation(s)
    s["pending"] = (s.get("pending") or []) + [f"Borrowed {_money(amount)} from the bank"]
    return s


def infuse(state: dict, amount: float) -> dict:
    """The founder puts in their own money: as much as they like, as often as they like. Does not use a turn."""
    s = copy.deepcopy(state)
    amount = int(_num(amount))
    if s["status"] != "active":
        raise ValueError("This game is over.")
    if not 0 < amount <= MAX_INFUSION:
        raise ValueError(f"Put in between $1 and {_money(MAX_INFUSION)}.")
    s["cash"] += amount
    # Counted with the rest of the cash typed into existence, so a score can be read for what it is
    s["typed_cash"] = s.get("typed_cash", 0) + amount
    if s["cash"] >= 0:
        s["weeks_in_red"] = 0
    s["valuation"] = valuation(s)
    s["pending"] = (s.get("pending") or []) + [f"Put {_money(amount)} of your own money in"]
    return s


def new_game(
    company: str,
    pitch: str,
    products: list[dict],
    difficulty: str = "normal",
    style: Optional[str] = None,
) -> dict:
    share = START_REVENUE_TARGET / len(products)
    setup = {"difficulty": difficulty if difficulty in DIFFICULTIES else "normal",
             "style": style if style in STYLES else None}
    cash = round(START_CASH * _mod(setup, "cash"))
    quality = STYLES.get(setup["style"], {}).get("quality", 60)
    state = {
        "company": {"name": company, "pitch": pitch},
        **setup,
        "period": "week",
        "start_cash": cash,
        "status": "active",
        "turn": 0,
        "cash": cash,
        "staff": [],
        "reputation": STYLES.get(setup["style"], {}).get("reputation", START_REPUTATION),
        "morale": START_MORALE,
        "products": [_product(p["name"], p["price"], p["price"] * 0.4, share, quality) for p in products],
        "last": {"revenue": 0, "costs": 0, "profit": 0},
        "history": [],
        "reactions": [],
        "options": list(DEFAULT_OPTIONS),
        "log": [],
        "equity": 1.0,
        "loans": [],
        "credit": CREDIT_FLOOR,
        "offer": None,
        "result": None,
        "goal": GOAL,
        "length": GAME_LENGTH,
    }
    _sync(state)
    state["candidates"] = _candidates(state, random.Random(), DRAFT_POOL)
    state["candidates_turn"] = 0
    # What the products should sell in a week, to size the first team against
    state["start_revenue"] = round(_expected_revenue(state))
    state["launch_cost"] = launch_cost_for(state)
    state["valuation"] = valuation(state)
    return state


def upgrade(state: dict) -> dict:
    """Bring a save from an older version of the rules up to date.

    Turns used to be months. A monthly save keeps its cash, staff and history,
    and its products' demand is scaled down to a week's worth.
    """
    if state.get("period") == "week" and "valuation" in state and "staff" in state:
        return state
    s = copy.deepcopy(state)
    if s.get("period") != "week":
        for p in s["products"]:
            p["demand"] = max(1, round(p["demand"] * 12 / 52))
        s["period"] = "week"
        s["start_cash"] = 250_000
    if "valuation" not in s:
        # Saves from before valuation, offers and the one-year run. A company already
        # past the old finish line gets a year from where it stands.
        s.update(equity=1.0, offer=None, result=None, goal=GOAL)
        s["length"] = GAME_LENGTH if s["turn"] < GAME_LENGTH - 8 else s["turn"] + GAME_LENGTH
        s["valuation"] = valuation(s)
        if s["status"] == "bankrupt":
            _finish(s, "bankrupt", 0)
    if "team" not in s and "staff" not in s:
        s["difficulty"] = s.get("difficulty", "normal")
        s["style"] = s.get("style")
        s["launch_cost"] = launch_cost_for(s)
    if "staff" not in s:
        # Saves from before people had names: the same head count, as mid-level staff.
        # An old save is upgraded afresh on every read until something is written back,
        # so the people have to come out the same each time. Otherwise the candidates
        # the player is shown are not the ones that exist when they click Hire.
        rng = random.Random(f"{s['company']['name']}|{s['turn']}|{s['cash']}|{s.get('employees')}")
        counts = s.get("team") or {"general": s.get("employees", 1)}
        s["staff"] = []
        for role in ROLES:
            for _ in range(int(counts.get(role, 0))):
                s["staff"].append(_person(s, rng, role, "mid"))
        _sync(s)
        s["candidates"] = _candidates(s, rng, HIRING_POOL)
        s["candidates_turn"] = s["turn"]
    return s


def _grow(product: dict, pct: float) -> float:
    """A demand change as it actually lands. Gains shrink as the product outgrows its launch market; losses do not."""
    if pct <= 0:
        return pct
    base = product.setdefault("base_demand", max(1, product["demand"]))
    outgrown = max(0.0, product["demand"] / base - 1)
    return pct / (1 + outgrown / MARKET_ROOM)


def _find_product(state: dict, product_id: str) -> Optional[dict]:
    return next((p for p in state["products"] if p["id"] == product_id and p["active"]), None)


def rename_product(state: dict, product_id: str, name: str) -> dict:
    """Fix or change a product's name from the dashboard. A label only: nothing reacts to it."""
    s = copy.deepcopy(state)
    product = _find_product(s, product_id)
    name = _text(name, 40)
    if not product or not name:
        raise ValueError("That product cannot be renamed.")
    if any(p["active"] and p["id"] != product_id and p["name"].lower() == name.lower() for p in s["products"]):
        raise ValueError("Another product already has that name.")
    product["name"] = name
    return s


def set_price(state: dict, product_id: str, price: float) -> dict:
    """Reprice a product from the dashboard, between turns.

    Demand shifts at once by the same rule a priced decision uses, and the change
    is noted so the coming week's story and public reaction can take it into account.
    """
    s = copy.deepcopy(state)
    product = _find_product(s, product_id)
    price = _num(price)
    if not product or price <= 0:
        raise ValueError("That price cannot be set.")
    old = product["price"]
    price = round(_clamp(price, max(0.01, product["unit_cost"] * 0.5), 1_000_000), 2)
    if abs(price - old) / old <= 0.005:
        return s
    demand_pct = _clamp(-PRICE_ELASTICITY * (price - old) / old * 100, -70, 80)
    product["price"] = price
    product["demand"] = max(0, round(product["demand"] * (1 + demand_pct / 100)))
    s["pending"] = (s.get("pending") or [])[-11:] + [
        f"{product['name']} price {_money(old)} to {_money(price)}",
    ]
    return s


def check_action(state: dict, action: dict) -> tuple:
    """Validate a dashboard action that is played as the week's decision.

    Returns (cleaned action, decision text for the story). Unlike a typed decision,
    nothing here has to be worked out from a sentence.
    """
    active = [p for p in state["products"] if p["active"]]
    kind = action.get("type")
    if kind == "launch":
        name = _text(action.get("name"), 40)
        price = _num(action.get("price"))
        if not name or price <= 0:
            raise ValueError("A new product needs a name and a price.")
        if len(active) >= MAX_PRODUCTS:
            raise ValueError(f"You can sell at most {MAX_PRODUCTS} products. Discontinue one first.")
        if any(p["name"].lower() == name.lower() for p in active):
            raise ValueError("You already sell a product with that name.")
        price = round(_clamp(price, 0.5, 1_000_000), 2)
        return {"type": "launch", "name": name, "price": price}, f"Launch a new product: {name} at {_money(price)}"
    if kind == "discontinue":
        product = _find_product(state, str(action.get("product_id")))
        if not product:
            raise ValueError("That product is not on sale.")
        if len(active) <= 1:
            raise ValueError("You need at least one product on sale.")
        return {"type": "discontinue", "product_id": product["id"]}, f"Discontinue {product['name']}"
    if kind == "hire":
        role = action.get("role")
        count = int(_num(action.get("count")))
        if role not in ROLES or not 1 <= count <= 25:
            raise ValueError("Choose a role and between 1 and 25 people.")
        people = ROLES[role]["one"] if count == 1 else (ROLES[role]["label"].lower() if role == "general" else f"{ROLES[role]['label'].lower()} people")
        return {"type": "hire", "role": role, "count": count}, f"Hire {count} {people}"
    raise ValueError("Unknown action.")


VOICES = [
    "a regular customer", "a first-time customer", "a customer who is annoyed", "a local journalist",
    "a trade blogger", "an employee", "a former employee", "a competitor", "an investor", "a supplier",
    "an industry analyst", "a neighbouring business owner", "a reviewer", "a fan of the brand",
]


def _health_line(state: dict) -> str:
    """How the company is really doing, so the story does not invent a crisis or a boom."""
    profit, cash = state["last"]["profit"], state["cash"]
    if state["turn"] == 0:
        return "The company has not traded yet."
    money = ("It made money last week." if profit >= 0
             else f"At last week's loss, the cash would last about {max(0, round(cash / -profit))} weeks.")
    load = state.get("workload", 0)
    work = ("The team cannot keep up and orders are being lost." if load >= 100
            else "The team is nearly at full stretch." if load >= 85
            else "The team has room to take on more.")
    return f"{money} {work}"


def describe_for_model(state: dict, decision: str) -> str:
    """The turn's user message: everything the model needs, sent fresh each time."""
    lines = [
        f"Company: {state['company']['name']}",
        f"What it does: {state['company']['pitch'] or 'not stated'}",
        f"Week: {state['turn'] + 1}",
        f"Cash: ${state['cash']:,.0f}",
        f"Company valuation: ${state['valuation']:,.0f}" + (
            f" (the CEO owns {state['equity'] * 100:.0f}%, investors own the rest)" if state["equity"] < 1 else ""
        ),
        "Team: " + ", ".join(
            f"{n} {ROLES[role]['label'].lower()}" for role, n in team(state).items() if n
        ) + f" ({state['employees']} in all)",
        f"Bank debt: ${debt(state):,.0f}",
        f"Reputation: {state['reputation']}/100",
        f"Team morale: {state['morale']}/100",
        f"Last week: revenue ${state['last']['revenue']:,.0f}, profit ${state['last']['profit']:,.0f}",
        _health_line(state),
        "Products:",
    ]
    for p in state["products"]:
        if p["active"]:
            lines.append(
                f"- {p['name']}: price {_money(p['price'])}, costs {_money(p['unit_cost'])} to make, "
                f"sold {p['units_sold']:,} last week, quality {p['quality']}/100"
            )
    if not any(p["active"] for p in state["products"]):
        lines.append("- none on sale")
    # Past weeks are given as facts, not as the stories written about them: shown
    # its own prose, the model copies it, and every week starts to sound the same.
    recent = state["log"][-4:]
    if recent:
        lines.append("Recent weeks:")
        for entry in recent:
            money = entry["financials"]
            lines.append(
                f"- Week {entry['turn']}: the CEO chose \"{entry['decision']}\". "
                f"Revenue ${money['revenue']:,.0f}, profit ${money['profit']:,.0f}."
            )
        openings = {" ".join(entry["narrative"].split()[:5]) for entry in recent if entry["narrative"]}
        lines.append("Do not open the narrative with any of these: " + "; ".join(f'"{o}..."' for o in sorted(openings)))
    lines.append("Voices for this week's reactions, one each: " + ", ".join(random.sample(VOICES, 3)) + ".")
    if state.get("pending"):
        lines.append("Since last week the CEO also changed: " + "; ".join(state["pending"]) + ". Customers will have noticed.")
    lines.append(f"\nThis week the CEO decides: \"{decision}\"")
    return "\n".join(lines)


def apply_turn(
    state: dict,
    decision: str,
    reply: dict,
    rng: Optional[random.Random] = None,
    action: Optional[dict] = None,
) -> dict:
    """Apply the model's proposed effects, then play out one week. Returns the new state.

    `action` is a decision made with a dashboard form (see check_action): it is
    carried out exactly, whatever the model says about it.
    """
    action = action or {}
    if not state.get("staff"):
        raise ValueError("Hire at least one person before the first week.")
    # Kept so the week can be taken back. Never nested: a snapshot holds no snapshot.
    before = {k: v for k, v in state.items() if k != "undo"}
    rng = rng or random.Random()
    s = copy.deepcopy(before)
    effects = reply.get("effects") if isinstance(reply.get("effects"), dict) else {}
    # Changes made from the dashboard since last week lead this week's list.
    changes: list[str] = list(s.pop("pending", None) or [])
    lapsed = s.get("offer")
    if lapsed:
        s["offer"] = None
        default = next((c for c in lapsed.get("choices", []) if c["id"] == lapsed.get("default")), None)
        if lapsed["type"] != "event":
            changes.append(f"Let the offer from {lapsed['from']} lapse")
        elif default:
            # A crisis does not go away because it was not answered.
            _apply_event_effects(s, default["effects"])
            _schedule(s, default)
            changes.append(default["note"])
        else:
            changes.append(f"Let it pass: {lapsed['title'].lower()}")
    active = {p["name"].lower(): p for p in s["products"] if p["active"]}

    stated_prices = _stated_prices(decision, list(active.values()))
    price_talk = bool(_PRICE_TOPIC.search(decision))
    proposed = {}
    for change in (effects.get("product_changes") or [])[:MAX_PRODUCTS]:
        if isinstance(change, dict):
            proposed.setdefault(_text(change.get("product"), 60).lower(), change)
    # The player changed prices without giving numbers ("reduce prices"). The model
    # tends to describe new prices in its story and leave them out of the effects,
    # so the change is made here: its figure if it gave a sensible one, else a step.
    direction = 0 if stated_prices else _price_direction(decision)
    named = [p for p in active.values() if p["name"].lower() in decision.lower()]
    repriced = {p["id"] for p in (named or active.values())} if direction else set()
    # A product whose price changes gets an entry even if the model left it out.
    for product in active.values():
        if product["id"] in stated_prices or product["id"] in repriced:
            proposed.setdefault(product["name"].lower(), {})

    for key, change in proposed.items():
        product = active.get(key)
        if not product:
            continue
        demand_pct = _num(change.get("demand_change_pct"))
        demand_pct = _clamp(demand_pct * DEMAND_BOOST * _mod(s, "boost") if demand_pct > 0 else demand_pct, -50, 60)
        demand_pct = _grow(product, demand_pct)
        new_price = stated_prices.get(product["id"]) or (_num(change.get("new_price")) if price_talk else 0)
        if product["id"] in repriced and (new_price <= 0 or (new_price - product["price"]) * direction <= 0):
            # Missing, unchanged, or moved the wrong way
            new_price = product["price"] * (1 + direction * DEFAULT_PRICE_STEP)
        if new_price > 0 and abs(new_price - product["price"]) / product["price"] > 0.005:
            new_price = round(_clamp(new_price, product["price"] * 0.4, product["price"] * 2.5), 2)
            price_pct = (new_price - product["price"]) / product["price"] * 100
            demand_pct = _clamp(demand_pct - PRICE_ELASTICITY * price_pct, -70, 80)
            changes.append(f"{product['name']} price {_money(product['price'])} to {_money(new_price)}")
            product["price"] = new_price
        quality = _clamp(_num(change.get("quality_change")), -20, 20)
        if quality:
            product["quality"] = round(_clamp(product["quality"] + quality, 0, 100))
        if abs(demand_pct) >= 0.5:
            product["demand"] = max(0, round(product["demand"] * (1 + demand_pct / 100)))
            changes.append(f"{product['name']} demand {demand_pct:+.0f}%")

    rename = _stated_rename(decision, s["company"]["name"], list(active.values()))
    if rename:
        kind, product, new_name = rename
        if kind == "company" and new_name != s["company"]["name"]:
            changes.append(f"Renamed the company to {new_name}")
            s["company"]["name"] = new_name
        elif kind == "product" and new_name.lower() not in active:
            changes.append(f"Renamed {product['name']} to {new_name}")
            del active[product["name"].lower()]
            product["name"] = new_name
            active[new_name.lower()] = product

    discontinued = effects.get("discontinued_products") if _DISCONTINUE_TOPIC.search(decision) else []
    if action.get("type"):
        dropped = _find_product(s, action.get("product_id", "")) if action["type"] == "discontinue" else None
        discontinued = [dropped["name"]] if dropped else []
    for name in (discontinued or [])[:MAX_PRODUCTS]:
        product = active.pop(_text(name, 60).lower(), None)
        if product:
            product["active"] = False
            changes.append(f"Discontinued {product['name']}")

    # What the player spelled out comes first: the model often tells the story of a
    # launch and forgets to list the product.
    launches = list(effects.get("new_products") or []) if _LAUNCH_TOPIC.search(decision) else []
    stated_launch = _stated_launch(decision, set(active))
    if stated_launch:
        launches = [stated_launch]
    if action.get("type"):
        launches = [action] if action["type"] == "launch" else []
    launch_cost = 0
    for item in launches[:2]:
        if not isinstance(item, dict) or len(active) >= MAX_PRODUCTS:
            continue
        name = _text(item.get("name"), 40)
        price = _num(item.get("price"))
        if not name or name.lower() in active or price <= 0:
            continue
        price = _clamp(price, 0.5, 1_000_000)
        unit_cost = _num(item.get("unit_cost")) or price * 0.4
        product = _product(name, price, _clamp(unit_cost, price * 0.05, price * 0.9), NEW_PRODUCT_REVENUE_TARGET, 55)
        s["products"].append(product)
        active[name.lower()] = product
        changes.append(f"Launched {name} at {_money(product['price'])}")
        launch_cost += launch_cost_for(s)
    if launch_cost:
        changes.append(f"Launch cost {_money(launch_cost)}")

    # Who joins or leaves, by role. What the player spelled out wins; the model's
    # single number only counts when the decision is about staff at all.
    staffing = _stated_staffing(decision)
    if action.get("type") == "hire":
        staffing = {action["role"]: action["count"]}
    elif action.get("type"):
        staffing = {}
    elif staffing is None:
        staffing = {"general": int(_num(effects.get("hires")))} if _STAFF_TOPIC.search(decision) else {}
    staffing_cost = 0
    laid_off = 0
    morale_change = _clamp(_num(effects.get("morale_change")), -15, 15)
    for role, wanted in staffing.items():
        moved = _staff_change(s, int(_clamp(wanted, -25, 25)), role, rng)
        if not moved:
            continue
        staffing_cost += moved * HIRING_COST if moved > 0 else -moved * SEVERANCE
        laid_off += max(0, -moved)
        kind = "" if role == "general" else f" {ROLES[role]['label'].lower()}"
        changes.append(f"{moved:+d}{kind} staff")
    if laid_off:
        morale_change = max(-15, morale_change - 2 * laid_off)

    s["reputation"] = round(_clamp(s["reputation"] + _clamp(_num(effects.get("reputation_change")), -15, 15), 0, 100))

    one_time_cost = _stated_cost(decision)
    if one_time_cost is not None:
        # The player chose the figure, so it stands, even if it is reckless.
        one_time_cost = _clamp(one_time_cost, 0, max(0, s["cash"]) + 50_000)
    else:
        affordable = max(1_000, min(
            _setting(s, "spend") * max(0, s["cash"]),
            UNPROMPTED_COST_WEEKS * max(s["last"]["revenue"], _expected_revenue(s)),
        ))
        one_time_cost = _clamp(_num(effects.get("one_time_cost")), 0, affordable)
    # An amount the player named is taken as said; otherwise the model's figure
    # counts, but only when the decision is about money coming in.
    # A figure the player names is founder money: taken in full, however large.
    one_time_income = _stated_income(decision)
    if one_time_income is not None:
        one_time_income = _clamp(one_time_income, 0, MAX_INFUSION)
    else:
        one_time_income = _num(effects.get("one_time_income")) if _INCOME_TOPIC.search(decision) else 0
        one_time_income = _clamp(one_time_income, 0, max(100_000, 16 * s["last"]["revenue"]))
    if one_time_cost >= 1:
        changes.append(f"Spent {_money(one_time_cost)}")
    if one_time_income >= 1:
        changes.append(f"Raised {_money(one_time_income)}")
        s["typed_cash"] = s.get("typed_cash", 0) + one_time_income

    # ---- Play out the week ----
    # Specialists do their one thing before the week's sales are counted.
    pull = SALES_PULL * _strength(s, "sales")
    s["craft"] = s.get("craft", 0) + PRODUCT_CRAFT * _strength(s, "product")
    crafted, s["craft"] = int(s["craft"]), s["craft"] % 1
    for p in s["products"]:
        if p["active"]:
            p["demand"] = max(0, round(p["demand"] * (1 + _grow(p, pull) / 100)))
            p["quality"] = min(100, p["quality"] + crafted)
    if s["reputation"] < SUPPORT_CEILING:
        s["care"] = s.get("care", 0) + SUPPORT_CARE * _strength(s, "support")
        cared, s["care"] = int(s["care"]), s["care"] % 1
        s["reputation"] = min(SUPPORT_CEILING, s["reputation"] + cared)

    reputation_factor = 0.5 + s["reputation"] / 100
    wanted = []
    for p in s["products"]:
        if not p["active"]:
            p["units_sold"], p["revenue"] = 0, 0
            continue
        quality_factor = 0.7 + 0.5 * p["quality"] / 100
        wanted.append((p, p["demand"] * reputation_factor * quality_factor * rng.uniform(0.93, 1.07)))

    capacity = _capacity_power(s) * REVENUE_PER_EMPLOYEE * (0.6 + 0.6 * (s["morale"] + morale_change) / 100)
    wanted_revenue = sum(units * p["price"] for p, units in wanted)
    workload = round(100 * wanted_revenue / capacity) if capacity > 0 else 0
    scale = 1.0
    lost = 0.0
    if wanted_revenue > capacity > 0:
        scale = capacity / wanted_revenue
        morale_change = max(-15, morale_change - 3)
        lost = wanted_revenue - capacity
        changes.append(f"Team at capacity: about {_money(round(lost, -2))} of orders went unfilled. Hire to sell more")

    revenue = cost_of_goods = 0.0
    for p, units in wanted:
        sold = max(0, round(units * scale))
        p["units_sold"] = sold
        p["revenue"] = round(sold * p["price"])
        revenue += sold * p["price"]
        cost_of_goods += sold * p["unit_cost"]
        # Word of mouth: a well-liked company slowly grows, a disliked one shrinks.
        p["demand"] = max(0, round(p["demand"] * (1 + (s["reputation"] - 50) / WORD_OF_MOUTH)))

    s["morale"] = round(_clamp(s["morale"] + morale_change, 0, 100))
    payroll = payroll_for(s)
    overhead = FIXED_OVERHEAD + OVERHEAD_RATE * revenue
    costs = cost_of_goods + payroll + overhead + one_time_cost + staffing_cost + launch_cost
    profit = revenue + one_time_income - costs
    operating = revenue - cost_of_goods - payroll - overhead

    # Investors take their share of a profitable week.
    payout = round(profit * (1 - s["equity"])) if profit > 0 and s["equity"] < 1 else 0
    if payout:
        changes.append(f"Investor payout {_money(payout)}")

    repayment = 0
    for loan in s.get("loans") or []:
        repayment += loan["weekly"]
        loan["weeks_left"] -= 1
    if repayment:
        changes.append(f"Loan repayment {_money(repayment)}")
    cleared = [loan for loan in s.get("loans") or [] if loan["weeks_left"] <= 0]
    if cleared:
        changes.append("Paid off a loan" if len(cleared) == 1 else f"Paid off {len(cleared)} loans")
    s["loans"] = [loan for loan in s.get("loans") or [] if loan["weeks_left"] > 0]

    s["turn"] += 1
    s["cash"] = round(s["cash"] + profit - payout - repayment)
    s["last"] = {"revenue": round(revenue), "costs": round(costs), "profit": round(profit)}
    # Demand as a share of what the team can handle; over 100 means sales were turned away
    s["workload"] = workload
    s["history"] = (s["history"] + [{
        "turn": s["turn"], "revenue": round(revenue), "profit": round(profit), "operating": round(operating),
        "cash": s["cash"], "employees": s["employees"],
    }])[-HISTORY_LIMIT:]
    s["valuation"] = valuation(s)
    s["history"][-1]["valuation"] = s["valuation"]
    s["credit"] = credit_available(s)

    reactions = []
    for item in (reply.get("reactions") or [])[:4]:
        if isinstance(item, dict) and _text(item.get("text"), 240):
            sentiment = item.get("sentiment")
            reactions.append({
                "source": _text(item.get("source"), 40) or "Someone",
                "text": _text(item.get("text"), 240),
                "sentiment": sentiment if sentiment in ("positive", "neutral", "negative") else "neutral",
            })
    s["reactions"] = reactions

    options = [_text(o, 90) for o in (reply.get("options") or []) if _text(o, 90)][:3]
    s["options"] = options if len(options) == 3 else list(DEFAULT_OPTIONS)

    narrative = _text(reply.get("narrative"), 900) or "The week passes without much to report."
    # A negative balance is a warning first: the company only folds if it stays in the red.
    s["weeks_in_red"] = s.get("weeks_in_red", 0) + 1 if s["cash"] < 0 else 0
    if s["weeks_in_red"] >= _setting(s, "overdraft"):
        _finish(s, "bankrupt", 0)
        narrative += " The company has run out of money."
    elif s["weeks_in_red"]:
        left = _setting(s, "overdraft") - s["weeks_in_red"]
        changes.append(
            "Overdrawn: get cash above zero by next week or the company folds" if left <= 1
            else f"Overdrawn: the bank will wait {left} more weeks"
        )
    else:
        if s["turn"] >= s["length"] and not s.get("free_play"):
            # A year in: the score is locked in and recorded, and the company keeps going as free play
            _finish(s, "finished", s["valuation"])
            s["official_result"] = s["result"]
            s["result"] = None
            s["status"] = "active"
            s["free_play"] = True
            s["year_scored"] = True
            changes.append(
                f"One year in: your score of {_money(s['official_result']['score'])} is locked in. The company keeps going."
            )
        if s["turn"] - s.get("candidates_turn", 0) >= POOL_REFRESH:
            s["candidates"] = _candidates(s, rng, HIRING_POOL)
            s["candidates_turn"] = s["turn"]
        s["offer"] = _maybe_offer(s, rng)
        if s["offer"] and s["offer"]["type"] == "event":
            s["last_event_turn"] = s["turn"]
            s["last_event"] = s["offer"]["title"]
        elif s["offer"]:
            s["last_offer_turn"] = s["turn"]

    s["log"] = (s["log"] + [{
        "turn": s["turn"],
        "decision": decision,
        "narrative": narrative,
        "summary": _week_summary(s, revenue, profit, lost),
        "changes": changes,
        "milestones": _new_milestones(s),
        "reactions": reactions,
        "financials": {**s["last"], "cash": s["cash"]},
    }])[-LOG_LIMIT:]
    if s["status"] == "active" and not s.get("year_scored"):
        s["undo"] = copy.deepcopy(before)
    else:
        # The week that locked in the score cannot be taken back and played again
        s.pop("undo", None)
    return s


def undo_turn(state: dict) -> dict:
    """Take back the last week, and anything done since. One step only."""
    if state.get("status") != "active" or not state.get("undo"):
        raise ValueError("There is no week to undo.")
    return copy.deepcopy(state["undo"])
