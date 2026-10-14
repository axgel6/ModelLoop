"""Model Arena rules.

Two models debate a topic: one argues for it, one against. They trade a fixed
number of arguments, each makes closing remarks, and the player, as moderator,
names the winner. This file decides whose turn it is and what each model is
shown; the speeches themselves are the models' own words. No I/O in this file.

There are two modes. In an argument the models go back and forth on their own.
A debate is split into rounds, and at the end of each one the moderator puts a
question to both sides: they answer it at the start of the next round, and the
last question is answered in the closing remarks.
"""
import copy
import re
from typing import Optional

GAME_TYPE = "model-arena"

MODES = ("argument", "debate")
ROUNDS = 5                 # argument: arguments each, before the closing remarks
DEBATE_ROUNDS = 3          # debate: rounds, each ending on a question from the moderator
DEBATE_EXCHANGES = 2       # debate: speeches each per round, an answer and then a rebuttal
MAX_QUESTION = 300         # characters kept of a moderator's question
WORD_LIMIT = 110           # what the debaters are asked to stay under
MAX_TOKENS = 320           # hard stop for a speech that ignores the word limit
MAX_SPEECH = 1500          # characters kept of any one speech
STANCES = ("for", "against")

DEBATE_RULES = """You are taking part in a formal one-on-one debate.
Topic: "{topic}"
You argue {stance} the topic. Your opponent argues the other side.

Rules:
- Never switch sides, never concede, and never suggest you both have a point.
- Speak in your own voice, straight to your opponent and the audience.{character}
- Keep every speech under {words} words of plain prose: no headings, no lists, no stage directions.
- Do not label your speech with a name and do not write your opponent's lines.
- After your opening, answer the strongest thing your opponent just said before making a new point. Do not repeat an argument you have already made."""

QUESTION_RULE = """
- When the moderator asks a question, answer it directly, from your side of the topic, before anything else."""

_THINKING = re.compile(r"<think>.*?(</think>|$)", re.S | re.I)


def new_game(topic: str, sides: list[dict], mode: str = "argument") -> dict:
    """`sides` is two dicts of model, character (a label) and prompt (that character's system prompt)."""
    debate = mode == "debate"
    return {
        "status": "active",          # active | question | judging | done
        "mode": "debate" if debate else "argument",
        "turn": 0,                   # speeches made so far
        "topic": topic,
        "rounds": DEBATE_ROUNDS if debate else ROUNDS,
        "exchanges": DEBATE_EXCHANGES if debate else 1,   # speeches each per round
        "questions": [],             # debate: one per finished round; "" where the moderator passed
        "sides": [
            {"model": side["model"], "character": side.get("character", ""), "prompt": side.get("prompt", ""), "stance": stance}
            for side, stance in zip(sides, STANCES)
        ],
        "speeches": [],
        "winner": None,
    }


def public(state: dict) -> dict:
    """The state without the characters' full system prompts, which the player already has."""
    return {**state, "sides": [{k: v for k, v in side.items() if k != "prompt"} for side in state["sides"]]}


def summary(state: dict) -> dict:
    """Enough to list a debate without its transcript."""
    return {
        "turn": state.get("turn", 0),
        "status": state.get("status"),
        "mode": state.get("mode", "argument"),
        "sides": [{"model": s["model"], "character": s["character"]} for s in state.get("sides", [])],
        "winner": state.get("winner"),
    }


def _per_round(state: dict) -> int:
    """Speeches in one round, both sides together. Debates saved before modes existed have one each."""
    return state.get("exchanges", 1) * 2


def awaiting_question(state: dict) -> Optional[int]:
    """The round the moderator still owes a question for, or None when the debaters have the floor."""
    if state.get("mode") != "debate":
        return None
    made = len(state["speeches"])
    per_round = _per_round(state)
    if made == 0 or made % per_round or made > state["rounds"] * per_round:
        return None
    finished = made // per_round
    return finished if len(state.get("questions", [])) < finished else None


def next_up(state: dict) -> Optional[dict]:
    """Who speaks next and what kind of speech it is, or None when nobody does:
    everyone has finished, or the moderator has a question to ask first."""
    if awaiting_question(state) is not None:
        return None
    made = len(state["speeches"])
    per_round = _per_round(state)
    arguments = state["rounds"] * per_round
    if made < arguments:
        return {"side": made % 2, "kind": "argument", "round": made // per_round + 1}
    if made < arguments + 2:
        return {"side": made - arguments, "kind": "closing", "round": None}
    return None


def _question(state: dict, after_round: int) -> str:
    """What the moderator asked at the end of a round, or "" if nothing was asked."""
    questions = state.get("questions", [])
    return questions[after_round - 1] if 0 < after_round <= len(questions) else ""


def _cue(state: dict, up: dict) -> str:
    made = len(state["speeches"])
    if up["kind"] == "closing":
        question = _question(state, state["rounds"])
        if question:
            return (f'Moderator: A final question: "{question}" Answer it in a sentence or two, '
                    "then sum up why your side won the debate. No other new arguments.")
        return "Moderator: Closing remarks. Sum up why your side won the debate. No new arguments."
    if made == 0:
        return "Moderator: You speak first. Give your opening argument."
    if made == 1:
        return "Moderator: Your opening argument. Answer what was just said, then make your case."
    question = _question(state, up["round"] - 1)
    if question:
        if made % _per_round(state) < 2:
            return (f'Moderator: Round {up["round"]} of {state["rounds"]}. My question to you both: "{question}" '
                    "Answer it directly, then press your case.")
        return f"Moderator: Round {up['round']} of {state['rounds']}. Your rebuttal. Stay on the question I asked."
    return f"Moderator: Round {up['round']} of {state['rounds']}. Your reply."


def messages_for_model(state: dict) -> list[dict]:
    """The debate as the next speaker sees it: their own speeches as theirs, the opponent's as incoming."""
    up = next_up(state)
    if up is None:
        raise ValueError("This debate is over")
    side = state["sides"][up["side"]]
    rules = DEBATE_RULES.format(
        topic=state["topic"],
        stance=side["stance"].upper(),
        words=WORD_LIMIT,
        character=" Keep the personality described above in every speech." if side["prompt"] else "",
    )
    if state.get("mode") == "debate":
        rules += QUESTION_RULE
    messages = [{"role": "system", "content": f"{side['prompt']}\n\n{rules}".strip()}]

    def say(role: str, text: str) -> None:
        # Chat models expect turns to alternate, so back-to-back lines from one role are joined.
        if messages[-1]["role"] == role:
            messages[-1]["content"] += f"\n\n{text}"
        else:
            messages.append({"role": role, "content": text})

    per_round = _per_round(state)
    for i, speech in enumerate(state["speeches"]):
        # A question asked at the end of a round sits in the transcript where it was asked
        if i and i % per_round == 0 and _question(state, i // per_round):
            say("user", f'Moderator: My question to you both: "{_question(state, i // per_round)}"')
        if speech["side"] == up["side"]:
            say("assistant", speech["text"])
        else:
            say("user", f"Opponent: {speech['text']}")
    say("user", _cue(state, up))
    return messages


def apply_speech(state: dict, text: str, model: Optional[str] = None) -> dict:
    """Add the next speaker's speech. `model` is the model that actually wrote it."""
    up = next_up(state)
    if up is None:
        raise ValueError("This debate is over")
    cleaned = _THINKING.sub("", str(text or "")).strip().strip('"').strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)[:MAX_SPEECH]
    if not cleaned:
        raise ValueError("The speech came back empty")
    s = copy.deepcopy(state)
    if model:
        s["sides"][up["side"]]["model"] = model  # the server may have swapped in a model it has
    s["speeches"].append({**up, "text": cleaned})
    s["turn"] = len(s["speeches"])
    if awaiting_question(s) is not None:
        s["status"] = "question"
    elif next_up(s) is None:
        s["status"] = "judging"
    return s


def ask_question(state: dict, text: str) -> dict:
    """The moderator's question at the end of a round. Empty text passes, and the debate carries on without one."""
    if awaiting_question(state) is None:
        raise ValueError("It is not time for a question")
    s = copy.deepcopy(state)
    s.setdefault("questions", []).append(" ".join(str(text or "").split())[:MAX_QUESTION])
    s["status"] = "active"
    return s


def set_winner(state: dict, winner: int) -> dict:
    """The moderator's verdict. It can be changed until the debate is deleted."""
    if state.get("status") in ("active", "question"):
        raise ValueError("The debate is still going")
    if winner not in (0, 1):
        raise ValueError("Pick one of the two debaters")
    s = copy.deepcopy(state)
    s["winner"] = winner
    s["status"] = "done"
    return s
