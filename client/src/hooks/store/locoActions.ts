import { StateCreator } from 'zustand'
import { GameStore, LocoActions } from './types'

export const createLocoActions: StateCreator<GameStore, [], [], LocoActions> = (set) => ({
  setUnoDeclared: (unoDeclared) => set({ unoDeclared }),
  setUnoDeclaredByIndex: (unoDeclaredByIndex) => set({ unoDeclaredByIndex }),

  // One seat called it. The banner is for the table; `myDeclared` is the part
  // that spends our own button, and it is set from the server's confirmation
  // rather than from the click, so a refused call leaves the button live.
  applyUnoDeclared: (declarer) =>
    set((s) => {
      const catchWindows = s.catchWindows.filter((w) => w.seat !== declarer)
      return {
        unoDeclared: true,
        unoDeclaredByIndex: declarer,
        myDeclared: declarer === s.myIndex ? true : s.myDeclared,
        catchWindows,
      }
    }),

  // A Contre-LOCO! landed on `seat`. Two things at once, and they belong
  // together: the seat is settled (it took the penalty, so nobody else may
  // catch it: the others stay on the hook, since after a GlobalSwitch there
  // can be several and settling them all would hand the slow ones a free pass)
  // and the table is told, which until now it never was — the caught
  // player's hand simply grew by two with nothing on screen to say why, and the
  // catcher got no answer at all beyond a button that went quiet. It is the
  // game's hardest reaction and it was also its most silent.
  applyUnoCaught: (seat) =>
    set((s) => {
      const catchWindows = s.catchWindows.filter((w) => w.seat !== seat)
      return {
        catchWindows,
        catchFlash: { seat, at: Date.now() },
      }
    }),

  clearCatchFlash: () => set({ catchFlash: null }),

  // Drops windows whose 5 s ran out. The server enforces the same deadline, so
  // a late click would only earn an error toast.
  pruneCatchWindows: () =>
    set((s) => {
      const now = Date.now()
      const catchWindows = s.catchWindows.filter((w) => w.endsAt > now)
      if (catchWindows.length === s.catchWindows.length) return s
      return { catchWindows }
    }),

  // Spends the button on this seat the moment we press it, before the server has
  // answered. A missed Contre-LOCO! costs a card now, so the cost of leaving it
  // armed for one more round trip is a second penalty for the same call.
  noteCatchAttempt: (seat) =>
    set((s) => {
      const catchWindows = s.catchWindows.map((w) =>
        w.seat === seat ? { ...w, attempted: true } : w
      )
      return { catchWindows }
    }),

  // Somebody's call arrived too late and they drew for it. The +1 card itself
  // comes through the ordinary card_drawn path; this is only the notice.
  applyCatchFailed: (seat) => set({ catchFailed: { seat, at: Date.now() } }),

  clearCatchFailed: () => set({ catchFailed: null }),
})
