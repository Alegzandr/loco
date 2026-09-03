package game

import "testing"

func startedRoom(t *testing.T, players ...string) *Room {
	t.Helper()
	r := NewRoom("MAPTST")
	for _, name := range players {
		if err := r.Join(name); err != nil {
			t.Fatalf("Join(%q): %v", name, err)
		}
	}
	if err := r.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	return r
}

func TestStart_DrawsAValidMap(t *testing.T) {
	r := startedRoom(t, "Alice", "Bob")
	if !r.MapID.Valid() {
		t.Fatalf("MapID = %q, want one of %v", r.MapID, MapIDs)
	}
}

// A lobby has no map. The client falls back to the built-in felt for an empty
// id, and the loading gate has nothing to wait for before a match exists.
func TestNewRoom_HasNoMapUntilStarted(t *testing.T) {
	r := NewRoom("MAPTST")
	if r.MapID != "" {
		t.Errorf("MapID = %q on a fresh lobby, want empty", r.MapID)
	}
}

// The map is the room the whole match is played in. Redrawing it between rounds
// would move the table under the players mid-match and read as a bug.
func TestBeginNextRound_KeepsTheMap(t *testing.T) {
	r := NewRoom("MAPTST")
	for _, name := range []string{"Alice", "Bob"} {
		if err := r.Join(name); err != nil {
			t.Fatalf("Join(%q): %v", name, err)
		}
	}
	// BO3: the default BO1 ends the match on the round we are about to finish,
	// and there would be no next round to check.
	if err := r.SetFormat(BO3); err != nil {
		t.Fatalf("SetFormat: %v", err)
	}
	if err := r.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	first := r.MapID
	// Force a round end so the room is allowed to deal the next one.
	r.endRound(0)
	if r.MatchOver {
		t.Fatal("BO3 should not be over after one round")
	}
	if err := r.BeginNextRound(); err != nil {
		t.Fatalf("BeginNextRound: %v", err)
	}
	if r.MapID != first {
		t.Errorf("MapID = %q after round 2, want it to stay %q", r.MapID, first)
	}
}

// A rematch is a new match, so it gets a new room, and just as importantly a
// map the clients may not have downloaded yet, which is what re-arms the loading
// gate. Keeping the old id would silently skip that.
func TestResetForRematch_ClearsTheMap(t *testing.T) {
	r := startedRoom(t, "Alice", "Bob")
	r.Status = StatusFinished
	if err := r.ResetForRematch(); err != nil {
		t.Fatalf("ResetForRematch: %v", err)
	}
	if r.MapID != "" {
		t.Errorf("MapID = %q after a rematch reset, want empty", r.MapID)
	}
	if err := r.Start(); err != nil {
		t.Fatalf("Start after rematch: %v", err)
	}
	if !r.MapID.Valid() {
		t.Errorf("MapID = %q after restarting, want a fresh valid map", r.MapID)
	}
}

func TestMapID_Valid(t *testing.T) {
	for _, id := range MapIDs {
		if !id.Valid() {
			t.Errorf("%q is in MapIDs but reports invalid", id)
		}
	}
	for _, id := range []MapID{"", "atlantis", "Neon", "neon "} {
		if id.Valid() {
			t.Errorf("%q reports valid", id)
		}
	}
}

// Every registered map must actually be drawable: an id listed but never
// returned would be a room nobody ever plays in, and the miss would be silent.
func TestPickMap_ReachesEveryMap(t *testing.T) {
	seen := make(map[MapID]bool, len(MapIDs))
	r := NewRoom("MAPTST")
	for i := 0; i < 400; i++ {
		seen[r.pickMap()] = true
	}
	for _, id := range MapIDs {
		if !seen[id] {
			t.Errorf("pickMap never returned %q in 400 draws", id)
		}
	}
	if len(seen) != len(MapIDs) {
		t.Errorf("pickMap returned %d distinct maps, want %d", len(seen), len(MapIDs))
	}
}

// The hour and the sky are drawn with the map, and a match dealt without either
// is a scene the client cannot render the same way for every seat.
func TestStart_DrawsAnHourAndASky(t *testing.T) {
	r := startedRoom(t, "Alice", "Bob")
	if !r.MapTime.Valid() {
		t.Errorf("MapTime = %q, want one of %v", r.MapTime, TimesOfDay)
	}
	if !r.MapWeather.Valid() {
		t.Errorf("MapWeather = %q, want one of %v", r.MapWeather, Weathers)
	}
}

// A lobby has no hour and no sky, for the reason it has no map.
func TestNewRoom_HasNoSceneUntilStarted(t *testing.T) {
	r := NewRoom("MAPTST")
	if r.MapTime != "" || r.MapWeather != "" {
		t.Errorf("fresh lobby carries time=%q weather=%q, want both empty", r.MapTime, r.MapWeather)
	}
}

// Rain does not stop between two rounds of the same match, and the sun does not
// set: the scene is the match's, exactly as the map is.
func TestBeginNextRound_KeepsTheHourAndTheSky(t *testing.T) {
	r := NewRoom("MAPTST")
	for _, name := range []string{"Alice", "Bob"} {
		if err := r.Join(name); err != nil {
			t.Fatalf("Join(%q): %v", name, err)
		}
	}
	if err := r.SetFormat(BO3); err != nil {
		t.Fatalf("SetFormat: %v", err)
	}
	if err := r.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	firstTime, firstWeather := r.MapTime, r.MapWeather
	r.endRound(0)
	if err := r.BeginNextRound(); err != nil {
		t.Fatalf("BeginNextRound: %v", err)
	}
	if r.MapTime != firstTime || r.MapWeather != firstWeather {
		t.Errorf("round 2 dealt at %q/%q, want the match's %q/%q", r.MapTime, r.MapWeather, firstTime, firstWeather)
	}
}

// A rematch clears the whole scene: a new match at the same hour under the same
// sky in the same room would read as nothing having happened.
func TestResetForRematch_ClearsTheHourAndTheSky(t *testing.T) {
	r := startedRoom(t, "Alice", "Bob")
	r.Status = StatusFinished
	if err := r.ResetForRematch(); err != nil {
		t.Fatalf("ResetForRematch: %v", err)
	}
	if r.MapTime != "" || r.MapWeather != "" {
		t.Errorf("after reset time=%q weather=%q, want both empty", r.MapTime, r.MapWeather)
	}
}

// Every room lists what its sky can do, every list is dealt clear at least, and
// nothing a list names is a weather the server does not have. The client's
// registry mirrors these lists and `maps.test.ts` pins it to this file, so a
// weather a map lists here is a weather the client can draw for it.
func TestMapWeathers_CoverEveryMap(t *testing.T) {
	for _, id := range MapIDs {
		list := id.Weathers()
		if len(list) == 0 {
			t.Errorf("%q lists no weather", id)
			continue
		}
		clear := false
		for _, w := range list {
			if !w.Valid() {
				t.Errorf("%q lists %q, which is not a weather", id, w)
			}
			if w == WeatherClear {
				clear = true
			}
		}
		if !clear {
			t.Errorf("%q cannot be dealt clear", id)
		}
	}
	for id := range MapWeathers {
		if !id.Valid() {
			t.Errorf("MapWeathers names %q, which is not a map", id)
		}
	}
	if MapID("atlantis").Weathers() != nil {
		t.Error("an unknown map should list no weather")
	}
}

// The sky a match is dealt under has to be one the room allows: it does not
// snow on the moon.
func TestPickWeather_StaysInsideTheMapsList(t *testing.T) {
	r := NewRoom("MAPTST")
	for _, id := range MapIDs {
		allowed := make(map[Weather]bool)
		for _, w := range id.Weathers() {
			allowed[w] = true
		}
		seen := make(map[Weather]bool)
		for i := 0; i < 300; i++ {
			w := r.pickWeather(id)
			if !allowed[w] {
				t.Fatalf("%q dealt %q, which it does not list", id, w)
			}
			seen[w] = true
		}
		for w := range allowed {
			if !seen[w] {
				t.Errorf("%q never dealt %q in 300 draws", id, w)
			}
		}
	}
	if got := r.pickWeather(MapID("atlantis")); got != WeatherClear {
		t.Errorf("an unknown map dealt %q, want clear", got)
	}
}

// Same discipline as the map: an hour listed but never drawn is a sky nobody
// ever plays under.
func TestPickTime_ReachesEveryHour(t *testing.T) {
	seen := make(map[TimeOfDay]bool)
	r := NewRoom("MAPTST")
	for i := 0; i < 300; i++ {
		seen[r.pickTime()] = true
	}
	for _, h := range TimesOfDay {
		if !seen[h] {
			t.Errorf("pickTime never returned %q in 300 draws", h)
		}
	}
}

func TestTimeAndWeather_Valid(t *testing.T) {
	for _, bad := range []string{"", "noon", "Day", "day "} {
		if TimeOfDay(bad).Valid() {
			t.Errorf("time %q reports valid", bad)
		}
		if Weather(bad).Valid() {
			t.Errorf("weather %q reports valid", bad)
		}
	}
}
