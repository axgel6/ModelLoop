// The time of year, for the words that follow the calendar: the greeting on an empty chat and
// the lines under it. Only words: festive colours belong to their own theme, never to the
// others. Seasons are the northern hemisphere's, by month.

export type Season = "winter" | "spring" | "summer" | "autumn";

export function season(date = new Date()): Season {
  const m = date.getMonth(); // 0 is January
  if (m === 11 || m <= 1) return "winter";
  if (m <= 4) return "spring";
  if (m <= 7) return "summer";
  return "autumn";
}

export type HolidayId = "new-year" | "valentines" | "halloween" | "winter-holidays" | "new-years-eve";

// The days with a greeting of their own. Each runs for the whole local day.
const HOLIDAYS: { id: HolidayId; month: number; days: number[]; hello: string }[] = [
  { id: "new-year", month: 0, days: [1], hello: "Happy New Year" },
  { id: "valentines", month: 1, days: [14], hello: "Happy Valentine's Day" },
  { id: "halloween", month: 9, days: [31], hello: "Happy Halloween" },
  { id: "winter-holidays", month: 11, days: [24, 25, 26], hello: "Happy holidays" },
  { id: "new-years-eve", month: 11, days: [31], hello: "Happy New Year's Eve" },
];

export function holiday(date = new Date()): { id: HolidayId; hello: string } | null {
  const h = HOLIDAYS.find((d) => d.month === date.getMonth() && d.days.includes(date.getDate()));
  return h ? { id: h.id, hello: h.hello } : null;
}

// One line about the season, mixed in with the usual ones under the greeting.
export const SEASON_LINES: Record<Season, string[]> = {
  winter: ["A good day to stay in somewhere warm. What shall we look into?"],
  spring: ["Everything's starting to bloom. What are you working on?"],
  summer: ["Long days for long questions. What's on your mind?"],
  autumn: ["Leaves are turning. A cozy time to dig into something."],
};
