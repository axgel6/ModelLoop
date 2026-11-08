import { createContext } from "react";

/** Opens the web studio from a project card in the chat */
export const WebDevContext = createContext<(() => void) | null>(null);
