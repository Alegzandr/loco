package game

// Maps: the room a match is played in, and the moment it is played at.
//
// A map is a scene, a table, an accent colour and a name. It changes no rule,
// no card, no timing; the domain carries it purely so that the *choice* can be
// the server's.
//
// That choice has to be server-side even though the consequence is entirely
// visual. LOCO is built to be watched: two players in one room describing two
// different tables to a viewer is a table that does not exist, and a highlight
// clip cut between two seats would jump between two rooms. Deriving it from the
// room code client-side would agree just as well, but it would also mean a room
// keeps the same map forever, and a rematch is meant to feel like a new match.
//
// A match is dealt at an hour and under a sky as well as in a room, and both are
// drawn here for the same reason: the client renders the scene from the three
// ids, so every seat has to be handed the same three.
type MapID string

const (
	// MapNeon is a rooftop terrace above a neon city.
	MapNeon MapID = "neon"
	// MapRune is the square of a village around an arcane tavern.
	MapRune MapID = "rune"
	// MapVelvet is a boulevard of art-deco hotels and marquees.
	MapVelvet MapID = "velvet"
	// MapOrbit is a base on an airless moon, under the home planet.
	MapOrbit MapID = "orbit"
	// MapSakura is a hot-spring village under cherry trees.
	MapSakura MapID = "sakura"
	// MapMarina is a harbour front: pier, lighthouse, boats.
	MapMarina MapID = "marina"
)

// MapIDs is every map a match can be dealt into, and the list the draw reads.
//
// The client keeps its own registry of the same ids (the scene, the table's
// materials, the accent) and falls back to the built-in felt for an id it does
// not know, so adding a map here before the client ships its scene degrades to
// the plain table rather than to a blank screen. `maps.test.ts` pins the
// client's list to this one.
var MapIDs = []MapID{MapNeon, MapRune, MapVelvet, MapOrbit, MapSakura, MapMarina}

// TimeOfDay is the hour a match is dealt at. It decides the light the scene is
// rendered in and the tint the table's highlight takes, and nothing else.
type TimeOfDay string

const (
	TimeDawn  TimeOfDay = "dawn"
	TimeDay   TimeOfDay = "day"
	TimeDusk  TimeOfDay = "dusk"
	TimeNight TimeOfDay = "night"
)

// TimesOfDay is every hour a match can be dealt at, and the list the draw reads.
var TimesOfDay = []TimeOfDay{TimeDawn, TimeDay, TimeDusk, TimeNight}

// Weather is the sky a match is dealt under. Like the hour it is presentation
// only: rain on the roof changes nothing about a card.
type Weather string

const (
	WeatherClear  Weather = "clear"
	WeatherCloudy Weather = "cloudy"
	WeatherRain   Weather = "rain"
	WeatherStorm  Weather = "storm"
	WeatherSnow   Weather = "snow"
	WeatherFog    Weather = "fog"
)

// Weathers is every weather any map can be dealt under.
var Weathers = []Weather{WeatherClear, WeatherCloudy, WeatherRain, WeatherStorm, WeatherSnow, WeatherFog}

// MapWeathers is the weather each room can be dealt under, and the list its
// draw reads. A room says what its sky can do: it does not snow on a moon with
// no air, and a harbour is more often in fog than a rooftop above the clouds.
// Every list is non-empty and `clear` is on every one of them, which
// maps_test.go pins.
var MapWeathers = map[MapID][]Weather{
	MapNeon:   {WeatherClear, WeatherCloudy, WeatherRain, WeatherStorm, WeatherSnow, WeatherFog},
	MapRune:   {WeatherClear, WeatherCloudy, WeatherRain, WeatherStorm, WeatherSnow, WeatherFog},
	MapVelvet: {WeatherClear, WeatherCloudy, WeatherRain, WeatherSnow, WeatherFog},
	MapOrbit:  {WeatherClear, WeatherFog, WeatherStorm},
	MapSakura: {WeatherClear, WeatherCloudy, WeatherRain, WeatherSnow, WeatherFog},
	MapMarina: {WeatherClear, WeatherCloudy, WeatherRain, WeatherStorm, WeatherFog},
}

// Valid reports whether m is a map this server can deal into.
func (m MapID) Valid() bool {
	for _, id := range MapIDs {
		if id == m {
			return true
		}
	}
	return false
}

// Weathers is the skies this room can be dealt under. Nil for a map the server
// does not know.
func (m MapID) Weathers() []Weather {
	return MapWeathers[m]
}

// Valid reports whether t is an hour a match can be dealt at.
func (t TimeOfDay) Valid() bool {
	for _, v := range TimesOfDay {
		if v == t {
			return true
		}
	}
	return false
}

// Valid reports whether w is a weather any map can be dealt under.
func (w Weather) Valid() bool {
	for _, v := range Weathers {
		if v == w {
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

// pickTime draws the hour a match is dealt at, from the same source as the map.
func (r *Room) pickTime() TimeOfDay {
	if len(TimesOfDay) == 0 {
		return ""
	}
	return TimesOfDay[r.rng.Intn(len(TimesOfDay))]
}

// pickWeather draws the sky for a match, among the ones the room allows. A map
// with no list (which no shipped map has) is dealt clear rather than nothing:
// the client would render a clear sky for an empty id anyway, and an empty
// field is one more thing a reload has to explain.
func (r *Room) pickWeather(m MapID) Weather {
	list := m.Weathers()
	if len(list) == 0 {
		return WeatherClear
	}
	return list[r.rng.Intn(len(list))]
}
