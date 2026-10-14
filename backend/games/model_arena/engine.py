"""Model Arena rules.

Two models debate a topic: one argues for it, one against. They trade a fixed
number of arguments, each makes closing remarks, and the player, as moderator,
names the winner. This file decides whose turn it is and what each model is
shown; the speeches themselves are the models' own words. No I/O in this file.
"""
import copy
import re
from typing import Optional

GAME_TYPE = "model-arena"

ROUNDS = 5                 # arguments each, before the closing remarks
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

_THINKING = re.compile(r"<think>.*?(</think>|$)", re.S | re.I)


def new_game(topic: str, sides: list[dict], rounds: int = ROUNDS) -> dict:
    """`sides` is two dicts of model, character (a label) and prompt (that character's system prompt)."""
    return {
        "status": "active",          # active | judging | done
        "turn": 0,                   # speeches made so far
        "topic": topic,
        "rounds": rounds,
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
        "sides": [{"model": s["model"], "character": s["character"]} for s in state.get("sides", [])],
        "winner": state.get("winner"),
    }


def next_up(state: dict) -> Optional[dict]:
    """Who speaks next and what kind of speech it is, or None once everyone has finished."""
    made = len(state["speeches"])
    arguments = state["rounds"] * 2
    if made < arguments:
        return {"side": made % 2, "kind": "argument", "round": made // 2 + 1}
    if made < arguments + 2:
        return {"side": made - arguments, "kind": "closing", "round": None}
    return None


def _cue(state: dict, up: dict) -> str:
    if up["kind"] == "closing":
        return "Moderator: Closing remarks. Sum up why your side won the debate. No new arguments."
    if up["round"] == 1 and up["side"] == 0:
        return "Moderator: You speak first. Give your opening argument."
    if up["round"] == 1:
        return "Moderator: Your opening argument. Answer what was just said, then make your case."
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
    messages = [{"role": "system", "content": f"{side['prompt']}\n\n{rules}".strip()}]

    def say(role: str, text: str) -> None:
        # Chat models expect turns to alternate, so back-to-back lines from one role are joined.
        if messages[-1]["role"] == role:
            messages[-1]["content"] += f"\n\n{text}"
        else:
            messages.append({"role": role, "content": text})

    for speech in state["speeches"]:
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
    if next_up(s) is None:
        s["status"] = "judging"
    return s


def set_winner(state: dict, winner: int) -> dict:
    """The moderator's verdict. It can be changed until the debate is deleted."""
    if state.get("status") == "active":
        raise ValueError("The debate is still going")
    if winner not in (0, 1):
        raise ValueError("Pick one of the two debaters")
    s = copy.deepcopy(state)
    s["winner"] = winner
    s["status"] = "done"
    return s
