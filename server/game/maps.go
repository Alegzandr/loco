package game

// Maps: the room a match is played in.
//
// A map is four things and nothing else: a backdrop, a table, an accent colour
// and a name. It changes no rule, no card, no timing; the domain carries it
// purely so that the *choice* can be the server's.
//
// That choice has to be server-side even though the consequence is entirely
// visual. LOCO is built to be watched: two players in one room describing two
// different tables to a viewer is a table that does not exist, and a highlight
// clip cut between two seats would jump between two rooms. Deriving it from the
// room code client-side would agree just as well, but it would also mean a room
// keeps the same map forever, and a rematch is meant to feel like a new match.
type MapID string

const (
	// MapNeon is a rooftop club above a neon skyline: black marble, a lit ring.
	MapNeon MapID = "neon"
	// MapRune is an arcane tavern: carved wood, gems, candlelight.
	MapRune MapID = "rune"
	// MapVelvet is an art-deco lounge: brass, burgundy baize, lamplight.
	MapVelvet MapID = "velvet"
	// MapOrbit is a starship hangar: brushed alloy and a holographic surface.
	MapOrbit MapID = "orbit"
)

// MapIDs is every map a match can be dealt into, and the list the draw reads.
//
// The client keeps its own registry of the same ids (the art, the placement of
// the table, the accent) and falls back to the built-in felt for an id it does
// not know, so adding a map here before the client ships its art degrades to
// the plain table rather than to a blank screen.
var MapIDs = []MapID{MapNeon, MapRune, MapVelvet, MapOrbit}

// Valid reports whether m is a map this server can deal into.
func (m MapID) Valid() bool {
	for _, id := range MapIDs {
		if id == m {
			return true
		}
	}
	return false
}

// pickMap draws the room for a match. Uses the room's own rng so a seeded room
// deals a reproducible map alongside its reproducible hands.
func (r *Room) pickMap() MapID {
	if len(MapIDs) == 0 {
		return ""
	}
	return MapIDs[r.rng.Intn(len(MapIDs))]
}
