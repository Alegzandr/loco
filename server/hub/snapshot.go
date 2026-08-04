package hub

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"loco/server/game"
)

// The snapshot: what lets a deploy replace this process without ending the
// matches on it.
//
// The drain in drain.go gets the number of interrupted matches to zero in the
// ordinary case, by waiting. This is what covers the case where waiting is not
// an option, and with the drain deliberately short (90s, so that a deploy never
// waits on the tables that are up) that case is the ordinary one in production:
// a process replaced while a best-of-7 is on its third round. The state goes to
// disk on the way out and comes back on the way in, and the clients reconnect
// into it on their own with the token they hold in sessionStorage. From a seat
// it is a one-second "Reconnexion" overlay, the same one a dropped wifi frame
// produces, which is why none of this needed a new client screen.
//
// Three deliberate limits:
//
//   - **Only matches in flight travel.** A lobby has nothing to lose and its
//     players are on the table screen, not in a hand. Reviving one would put a
//     room on the new server that nobody is in.
//   - **A snapshot is never replayed.** The file is removed as it is read, so a
//     restore that goes wrong does not go wrong again on every subsequent boot.
//   - **The schema version is a hard gate, not a merge.** A room shaped by
//     another build is not a room this one can play, and there is no safe way to
//     guess the difference. A mismatch drops the whole file and logs it. This is
//     why the drain exists as well: it is what makes a dropped snapshot rare
//     rather than routine.

// SnapshotSchemaVersion is bumped by hand whenever the shape of what is written
// below changes, game.Room included. A restore refuses anything else.
const SnapshotSchemaVersion = 2

// SnapshotMaxAge is how old a snapshot may be and still be worth restoring.
//
// It is a bound on how long the players waited, not on how long the file is
// valid. A restart takes seconds; past a couple of minutes the clients have
// exhausted their reconnect attempts and the people have closed the tab, and
// restoring then would only put unreachable rooms on a fresh server.
var SnapshotMaxAge = 2 * time.Minute

type snapshotFile struct {
	SchemaVersion int            `json:"schema_version"`
	SavedAt       time.Time      `json:"saved_at"`
	Rooms         []roomSnapshot `json:"rooms"`
}

// roomSnapshot is one match plus the hub-side bookkeeping that makes it
// playable. Everything else the hub holds for a room is either rebuilt on
// restore (the reconnect windows, the turn timer, the bot schedule) or
// deliberately dropped (the map-loading gate, the rematch offers).
type roomSnapshot struct {
	Room *game.Room `json:"room"`
	// SessionTokens is the whole reason a restore is invisible: it is what lets
	// the returning client prove it owns the seat, with the token it has had
	// since it joined.
	SessionTokens map[int]string `json:"session_tokens,omitempty"`
	BotSlots      []int          `json:"bot_slots,omitempty"`
	Matchmade     bool           `json:"matchmade,omitempty"`
	AFKTimeouts   map[int]int    `json:"afk_timeouts,omitempty"`
	// MatchHistory is the evening behind this match. A table on its fourth
	// rematch has three finished matches nothing else on the server remembers,
	// and losing them to a deploy would mean the recap silently restarting at
	// "Match 1" for a group that has been playing for an hour.
	MatchHistory []matchRecord `json:"match_history,omitempty"`
}

// snapshotReq is a save or load asking to be run on the event loop.
type snapshotReq struct {
	path string
	done chan error
}

// SaveSnapshot writes every match in flight to path. An empty path disables the
// feature entirely, which is what local dev and the E2E suite run with.
//
// Safe from any goroutine: the work runs on the event loop, because it reads
// every room.
func (h *Hub) SaveSnapshot(path string) error {
	if path == "" {
		return nil
	}
	return h.runOnLoop(h.snapshotSave, path)
}

// LoadSnapshot restores a snapshot written by SaveSnapshot and deletes the
// file. A missing file, a stale one, an unreadable one and one from another
// build are all "nothing to restore", not errors: none of them is a reason for
// a server to refuse to boot.
func (h *Hub) LoadSnapshot(path string) error {
	if path == "" {
		return nil
	}
	return h.runOnLoop(h.snapshotLoad, path)
}

func (h *Hub) runOnLoop(ch chan snapshotReq, path string) error {
	req := snapshotReq{path: path, done: make(chan error, 1)}
	select {
	case ch <- req:
	case <-h.quit:
		return errors.New("hub stopped")
	}
	select {
	case err := <-req.done:
		return err
	case <-h.quit:
		return errors.New("hub stopped")
	}
}

// --- save ---

func (h *Hub) saveSnapshot(path string) error {
	// Every table is stopped before a single one is read, and that is not
	// tidiness. A room snapshot holds the room, the session tokens and the AFK
	// counters **by reference**, so marshalling them while their own goroutine
	// is still running would write a hand halfway through being dealt. Stopping
	// first is what makes the file describe one instant.
	//
	// It also means a hub stops serving its tables here. That is exactly what
	// this call is: the last thing a process does with them, after the drain and
	// immediately before it goes. Nothing plays on the far side of it.
	h.stopTables()

	snap := snapshotFile{
		SchemaVersion: SnapshotSchemaVersion,
		SavedAt:       time.Now(),
	}
	for _, t := range h.tables {
		if t.room.Status != game.StatusPlaying {
			continue
		}
		snap.Rooms = append(snap.Rooms, roomSnapshot{
			Room:          t.room,
			SessionTokens: t.tokens,
			BotSlots:      sortedKeys(t.bots),
			Matchmade:     t.isMatchmade(),
			AFKTimeouts:   t.afk,
			MatchHistory:  t.matchHistory,
		})
	}
	if len(snap.Rooms) == 0 {
		// The ordinary shutdown, and the one the drain is for: nothing was
		// interrupted, so there is nothing to hand over. Writing an empty file
		// anyway would leave one on disk after every clean deploy, for the next
		// boot to read and delete for no reason.
		log.Printf("no match in flight, no snapshot written")
		return nil
	}
	if err := writeAtomic(path, snap); err != nil {
		return err
	}
	log.Printf("snapshot written path=%s rooms=%d", path, len(snap.Rooms))
	return nil
}

// writeAtomic writes the file through a temporary neighbour and renames it.
//
// A snapshot is written while the process is being torn down, which is exactly
// when a half-written file is plausible. A truncated JSON document would be
// read back as a schema failure and drop every match on it, so the rename is
// what makes "the file exists" mean "the file is complete".
func writeAtomic(path string, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("marshal snapshot: %w", err)
	}
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return fmt.Errorf("snapshot dir: %w", err)
		}
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return fmt.Errorf("write snapshot: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("rename snapshot: %w", err)
	}
	return nil
}

// --- load ---

func (h *Hub) loadSnapshot(path string) error {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		log.Printf("WARN snapshot unreadable, starting empty path=%s err=%v", path, err)
		return nil
	}
	// Removed before it is trusted: a snapshot that somehow breaks the restore
	// must break exactly one boot, not every boot from here on.
	if err := os.Remove(path); err != nil {
		log.Printf("WARN snapshot could not be removed path=%s err=%v", path, err)
	}

	var snap snapshotFile
	if err := json.Unmarshal(data, &snap); err != nil {
		log.Printf("WARN snapshot malformed, starting empty path=%s err=%v", path, err)
		return nil
	}
	if snap.SchemaVersion != SnapshotSchemaVersion {
		log.Printf("WARN snapshot from another build discarded schema=%d want=%d rooms=%d",
			snap.SchemaVersion, SnapshotSchemaVersion, len(snap.Rooms))
		return nil
	}
	if age := time.Since(snap.SavedAt); age > SnapshotMaxAge {
		log.Printf("WARN snapshot too old to be worth restoring age_sec=%d rooms=%d",
			int(age.Seconds()), len(snap.Rooms))
		return nil
	}

	restored := 0
	for _, rs := range snap.Rooms {
		if h.restoreRoom(rs) {
			restored++
		}
	}
	log.Printf("snapshot restored rooms=%d of=%d age_ms=%d",
		restored, len(snap.Rooms), time.Since(snap.SavedAt).Milliseconds())
	return nil
}

// restoreRoom puts one match back, with every seat marked absent.
//
// Nobody is connected yet, by construction: this runs before the listener is
// up. So every seat enters its reconnect window exactly as if its player had
// just dropped, which is the state the rest of the hub already knows how to
// handle, including the ending it needs when nobody comes back.
func (h *Hub) restoreRoom(rs roomSnapshot) bool {
	room := rs.Room
	if room == nil || room.Code == "" || room.State == nil || room.Status != game.StatusPlaying {
		return false
	}
	code := room.Code
	if _, taken := h.tables[code]; taken {
		log.Printf("WARN snapshot room code collides with a live room, dropped code=%s", code)
		return false
	}

	t := newTable(code, room)
	t.members = make([]*Client, len(room.Players))
	h.tables[code] = t
	h.metrics.rooms.Add(1)

	// A snapshot written by an older process may carry a null where this now
	// keeps a map, so the fields are only taken when they hold something.
	if len(rs.SessionTokens) > 0 {
		t.tokens = rs.SessionTokens
	}
	if len(rs.AFKTimeouts) > 0 {
		t.afk = rs.AFKTimeouts
	}
	if len(rs.MatchHistory) > 0 {
		t.matchHistory = rs.MatchHistory
	}
	for _, seat := range rs.BotSlots {
		t.bots[seat] = struct{}{}
	}
	bots := t.bots
	h.metrics.botsActive.Add(int32(len(bots)))
	// Set before the reconnect windows are armed: reconnectHold reads it, and a
	// matchmade seat is held for 15s rather than 60.
	if rs.Matchmade {
		t.matchmadeAt = time.Now()
	}

	// Started here, and not one line earlier: everything above is this function
	// filling the table in, and a goroutine reading fields still being written
	// is the race table.start exists to avoid. Everything below arms a timer,
	// which the table must be running to receive.
	t.start(h)

	now := time.Now()
	for seat := range room.Players {
		if t.isBot(seat) {
			continue
		}
		t.awayAt[seat] = now
		h.scheduleReconnectExpiry(t, seat, now)
	}

	// The turn clock restarts whole. The fraction of it that elapsed before the
	// restart is not recoverable from a wall-clock stamp anyway (the process was
	// down for part of it), and the error is in the player's favour.
	h.scheduleTurnTimer(t)
	h.maybeScheduleBot(t)

	// Nobody is at this table yet. If nobody arrives, this is what ends it
	// rather than leaving a room on the server for the rest of its life.
	h.scheduleRoomCleanup(t)

	log.Printf("room restored code=%s players=%d round=%d bots=%d matchmade=%t",
		code, len(room.Players), room.RoundNumber, len(bots), rs.Matchmade)
	return true
}

// sortedKeys returns a set's members in ascending order, so a snapshot of the
// same state is byte-identical from one run to the next.
func sortedKeys(set map[int]struct{}) []int {
	if len(set) == 0 {
		return nil
	}
	out := make([]int, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j] < out[j-1]; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}
