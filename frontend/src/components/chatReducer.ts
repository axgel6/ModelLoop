export type EditState = { idx: number; value: string };
export type RenameState = { id: string; value: string };

export type ChatInteractionState = {
  deletingIds: Set<string>;
  renameState: RenameState | null;
  editState: EditState | null;
};

export type ChatInteractionAction =
  | { type: "delete_start"; id: string }
  | { type: "delete_finish"; id: string }
  | { type: "rename_start"; id: string; value: string }
  | { type: "rename_update"; value: string }
  | { type: "rename_cancel" }
  | { type: "edit_start"; idx: number; value: string }
  | { type: "edit_update"; value: string }
  | { type: "edit_cancel" };

export const initialChatInteractionState: ChatInteractionState = {
  deletingIds: new Set(),
  renameState: null,
  editState: null,
};

export function chatInteractionReducer(
  state: ChatInteractionState,
  action: ChatInteractionAction,
): ChatInteractionState {
  switch (action.type) {
    case "delete_start": {
      const nextDeletingIds = new Set(state.deletingIds);
      nextDeletingIds.add(action.id);
      return { ...state, deletingIds: nextDeletingIds };
    }
    case "delete_finish": {
      const nextDeletingIds = new Set(state.deletingIds);
      nextDeletingIds.delete(action.id);
      return { ...state, deletingIds: nextDeletingIds };
    }
    case "rename_start":
      return { ...state, renameState: { id: action.id, value: action.value } };
    case "rename_update":
      if (!state.renameState) return state;
      return {
        ...state,
        renameState: { ...state.renameState, value: action.value },
      };
    case "rename_cancel":
      return { ...state, renameState: null };
    case "edit_start":
      return { ...state, editState: { idx: action.idx, value: action.value } };
    case "edit_update":
      if (!state.editState) return state;
      return {
        ...state,
        editState: { ...state.editState, value: action.value },
      };
    case "edit_cancel":
      return { ...state, editState: null };
    default:
      return state;
  }
}
