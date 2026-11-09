// Fahrenheit or Celsius for the weather, chosen per device. Sent with every request
// (see authHeaders in components/api.ts) so the server asks for the forecast in that unit.
export type TempUnit = "F" | "C";

const STORAGE_KEY = "temp_unit";
const DEFAULT: TempUnit = "F";

export const tempUnit = {
  get(): TempUnit {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === "C" || stored === "F" ? stored : DEFAULT;
    } catch {
      return DEFAULT;
    }
  },

  set(unit: TempUnit) {
    try {
      localStorage.setItem(STORAGE_KEY, unit);
    } catch {
      // the default is used instead
    }
  },
};
