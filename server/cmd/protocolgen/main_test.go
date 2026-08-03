package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
	"testing"
)

// What this generator gets right on the protocol as it stands today is already
// covered from the other end: protocol_check regenerates in CI and fails on any
// difference, and the committed output is what 689 client tests and `astro
// check` run against. So these tests are about the other half, the part nothing
// downstream can see: what it does when the Go source changes into a shape it
// should not accept. A generator that guesses produces a client that compiles
// and is wrong, which is the exact failure this whole change set exists to end.

func parseSrc(t *testing.T, src string) []*ast.File {
	t.Helper()
	f, err := parser.ParseFile(token.NewFileSet(), "x.go", src, parser.ParseComments)
	if err != nil {
		t.Fatalf("test source does not parse: %v", err)
	}
	return []*ast.File{f}
}

func mustLoad(t *testing.T, src string) *pkg {
	t.Helper()
	p, err := loadFiles(parseSrc(t, src))
	if err != nil {
		t.Fatalf("loadFiles: %v", err)
	}
	return p
}

func mustEmit(t *testing.T, p *pkg) (types, schemas string) {
	t.Helper()
	ts, err := p.emitTypes("protocol")
	if err != nil {
		t.Fatalf("emitTypes: %v", err)
	}
	sc, err := p.emitSchemas("protocol")
	if err != nil {
		t.Fatalf("emitSchemas: %v", err)
	}
	return string(ts), string(sc)
}

// A slice of pointers is the shape that has no honest spelling: the Go type says
// a slot can be null, and both readings of it in TypeScript are wrong in a way
// nobody would notice. ServerMsg.Cards was one until this generator existed.
func TestRefusesSliceOfPointers(t *testing.T) {
	p := mustLoad(t, `package protocol
type CardDTO struct {
	Color string `+"`json:\"color\"`"+`
}
type Msg struct {
	Cards []*CardDTO `+"`json:\"cards,omitempty\"`"+`
}`)

	if _, err := p.emitTypes("protocol"); err == nil {
		t.Fatal("a []*CardDTO field was accepted; it must stop the build instead")
	} else if !strings.Contains(err.Error(), "slice of pointers") {
		t.Errorf("error should say what is wrong and how to fix it, got: %v", err)
	}
}

// The All* slice is what enums_test.go checks against the domain. If the const
// block and the slice disagree, that test is checking a subset and the missing
// value silently never reaches the client.
func TestRefusesEnumSliceOutOfStepWithConsts(t *testing.T) {
	p := mustLoad(t, `package protocol
type CardColor string
const (
	ColorRed  CardColor = "red"
	ColorBlue CardColor = "blue"
)
var AllCardColors = []CardColor{ColorRed}
type Msg struct {
	Color CardColor `+"`json:\"color\"`"+`
}`)

	err := p.validate()
	if err == nil {
		t.Fatal("a const block with a value missing from its All slice was accepted")
	}
	if !strings.Contains(err.Error(), "ColorBlue") {
		t.Errorf("the error should name the value that would have vanished, got: %v", err)
	}
}

func TestAcceptsEnumSliceInStep(t *testing.T) {
	p := mustLoad(t, `package protocol
type CardColor string
const (
	ColorRed  CardColor = "red"
	ColorBlue CardColor = "blue"
)
var AllCardColors = []CardColor{ColorRed, ColorBlue}
type Msg struct {
	Color CardColor `+"`json:\"color\"`"+`
}`)

	if err := p.validate(); err != nil {
		t.Fatalf("a matching const block and slice were refused: %v", err)
	}
	types, schemas := mustEmit(t, p)
	if !strings.Contains(types, "export type CardColor =") ||
		!strings.Contains(types, "| 'red'") || !strings.Contains(types, "| 'blue'") {
		t.Errorf("enum did not reach the types file:\n%s", types)
	}
	if !strings.Contains(schemas, "export const cardColorSchema = v.picklist([") {
		t.Errorf("enum did not reach the schema file:\n%s", schemas)
	}
}

// An unknown type must stop the build. The alternative is emitting `unknown`
// or `any`, which type-checks everywhere and means the client stopped reading
// a field it used to read.
func TestRefusesUnknownType(t *testing.T) {
	p := mustLoad(t, `package protocol
type Msg struct {
	When SomeTimeType `+"`json:\"when\"`"+`
}`)

	if _, err := p.emitTypes("protocol"); err == nil {
		t.Fatal("a field of an unknown type was accepted")
	}
}

// omitempty and a pointer both mean "may be absent", and both have to reach the
// client as optional. A pointer without omitempty is the case that bites: Go
// marshals `null`, and a required field would refuse the whole message.
func TestOptionalityFollowsOmitemptyAndPointers(t *testing.T) {
	p := mustLoad(t, `package protocol
type Msg struct {
	Always   int   `+"`json:\"always\"`"+`
	Omitted  int   `+"`json:\"omitted,omitempty\"`"+`
	Pointer  *int  `+"`json:\"pointer\"`"+`
	Flag     *bool `+"`json:\"flag,omitempty\"`"+`
}`)

	types, schemas := mustEmit(t, p)
	for _, want := range []string{"always: number", "omitted?: number", "pointer?: number", "flag?: boolean"} {
		if !strings.Contains(types, want) {
			t.Errorf("types file is missing %q:\n%s", want, types)
		}
	}
	if !strings.Contains(schemas, "always: v.number(),") {
		t.Errorf("a required field should not be wrapped in v.optional:\n%s", schemas)
	}
	for _, want := range []string{"omitted: v.optional(v.number()),", "pointer: v.optional(v.number()),"} {
		if !strings.Contains(schemas, want) {
			t.Errorf("schema file is missing %q:\n%s", want, schemas)
		}
	}
}

// The envelope marker is what stops the generated validator from being stricter
// than the wire. ServerMsg carries `turn` and `drawn_count` without omitempty,
// because a zero is a real value there; requiring them would refuse every
// message that is not about a turn, which is most of them.
func TestEnvelopeMakesEverythingButTypeOptional(t *testing.T) {
	p := mustLoad(t, `package protocol
type ServerMsgType string
const SMsgError ServerMsgType = "error"
var AllServerMsgTypes = []ServerMsgType{SMsgError}

// ServerMsg is the envelope.
//
//protocolgen:envelope
type ServerMsg struct {
	Type ServerMsgType `+"`json:\"type\"`"+`
	Turn int           `+"`json:\"turn\"`"+`
}`)

	types, schemas := mustEmit(t, p)
	if !strings.Contains(types, "type: ServerMsgType") {
		t.Errorf("the discriminant must stay required:\n%s", types)
	}
	if !strings.Contains(types, "turn?: number") {
		t.Errorf("an envelope field without omitempty must still be optional:\n%s", types)
	}
	if !strings.Contains(schemas, "turn: v.optional(v.number()),") {
		t.Errorf("the schema must not require an envelope field:\n%s", schemas)
	}
	if strings.Contains(types, envelopeMarker) || strings.Contains(schemas, envelopeMarker) {
		t.Error("the marker is an instruction to this program and has no business in the output")
	}
}

// A schema is a `const`, so a reference to one declared further down is a
// temporal-dead-zone crash on the first message rather than a compile error.
// Source order does not give this for free: CardDTO is declared after ClientMsg
// in messages.go.
func TestSchemasAreDeclaredBeforeTheyAreUsed(t *testing.T) {
	p := mustLoad(t, `package protocol
type Outer struct {
	Inner InnerDTO `+"`json:\"inner\"`"+`
}
type InnerDTO struct {
	Leaf string `+"`json:\"leaf\"`"+`
}`)

	_, schemas := mustEmit(t, p)
	inner := strings.Index(schemas, "export const innerSchema")
	outer := strings.Index(schemas, "export const outerSchema")
	if inner < 0 || outer < 0 {
		t.Fatalf("both schemas should be emitted:\n%s", schemas)
	}
	if inner > outer {
		t.Errorf("innerSchema is declared after the schema referencing it:\n%s", schemas)
	}
}

// The reasoning in messages.go is most of what makes the protocol readable, and
// dropping it on the way out would make the generated file worse than the
// hand-written one it replaced.
func TestCarriesDocCommentsThrough(t *testing.T) {
	p := mustLoad(t, `package protocol
type Msg struct {
	// Turn is the seat whose turn it is. No omitempty: seat 0 is a turn like
	// any other.
	Turn int `+"`json:\"turn\"`"+`
}`)

	types, _ := mustEmit(t, p)
	if !strings.Contains(types, "seat 0 is a turn like") {
		t.Errorf("the field's reasoning did not survive generation:\n%s", types)
	}
}

// A field the server does not marshal must not appear at all: the client would
// be reading something the wire never carries.
func TestSkipsFieldsWithNoJSONTag(t *testing.T) {
	p := mustLoad(t, `package protocol
type Msg struct {
	OnWire   string `+"`json:\"on_wire\"`"+`
	Internal string
	Excluded string `+"`json:\"-\"`"+`
}`)

	types, _ := mustEmit(t, p)
	if !strings.Contains(types, "on_wire") {
		t.Errorf("a tagged field is missing:\n%s", types)
	}
	if strings.Contains(types, "Internal") || strings.Contains(types, "Excluded") {
		t.Errorf("an untagged or excluded field reached the client:\n%s", types)
	}
}
