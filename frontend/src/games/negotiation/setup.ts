// The choices on the start screen. Ids and prices mirror backend/games/negotiation/engine.py.

export type Difficulty = "easy" | "normal" | "hard";

export const DIFFICULTIES: { id: Difficulty; label: string; blurb: string }[] = [
  { id: "easy", label: "Easy", blurb: "A patient merchant who folds quickly." },
  { id: "normal", label: "Normal", blurb: "The standard haggle." },
  { id: "hard", label: "Hard", blurb: "Short on patience and slow to budge." },
];

export const SCENARIOS: { id: string; item: string; merchant: string; setting: string; listPrice: number }[] = [
  { id: "rug", item: "Hand-knotted wool rug", merchant: "Yusuf", setting: "A crowded bazaar stall", listPrice: 480 },
  { id: "car", item: "2014 hatchback, 96,000 miles", merchant: "Dana", setting: "A used car lot", listPrice: 7400 },
  { id: "guitar", item: "1978 electric guitar", merchant: "Marcus", setting: "A pawn shop", listPrice: 1250 },
  { id: "lamp", item: "Brass desk lamp, slightly dented", merchant: "Edith", setting: "A Sunday flea market", listPrice: 65 },
  { id: "map", item: "Hand-coloured 1820s map", merchant: "Beatrice", setting: "A quiet antiques shop", listPrice: 900 },
  { id: "tickets", item: "Two tickets to tonight's sold-out show", merchant: "Rico", setting: "Outside the venue", listPrice: 300 },
  { id: "coil", item: "Lightly used hyperdrive coil", merchant: "Zex", setting: "An orbital salvage yard", listPrice: 9800 },
];
