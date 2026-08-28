import { create } from 'zustand';

/**
 * Open/closed state for the search dialog.
 *
 * Kept in a store rather than in component state because the dialog is opened
 * from several places — the sidebar, the mobile header, and a global keyboard
 * shortcut — that share no common ancestor short of the layout.
 */
interface SearchState {
  /** Whether the dialog is showing */
  isOpen: boolean;
  /** Opens the dialog */
  open: () => void;
  /** Closes the dialog */
  close: () => void;
  /** Toggles the dialog */
  toggle: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
}));
