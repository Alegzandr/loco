// protocolgen turns server/protocol into the client's TypeScript protocol.
//
// The wire used to be described three times: Go structs with json tags, a
// hand-written TypeScript file, and a third hand-written file of validation
// schemas. Nothing checked that the three agreed, and the way that fails is
// silent: a field renamed on one side, a pointer added on another, and the
// client keeps compiling while dropping a value it now cannot read. The mirrors
// the repository already pins by test (the nickname's shape, the table code's
// alphabet) exist because of exactly that failure mode; this removes the two
// remaining copies instead of pinning them.
//
// Go is the source because the server is authoritative. Everything the client
// needs has to be expressible in messages.go, which is why the wire enums are
// declared in enums.go rather than left as bare strings: see the note there.
//
// Deliberately stdlib-only. go/packages would read types properly instead of
// syntactically, and it would put golang.org/x/tools into a server module that
// has exactly one dependency. The protocol package is a handful of flat structs
// in one directory; go/ast is enough, and this program refuses anything it
// cannot read rather than guessing.
package main

import (
	"bytes"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// envelopeMarker opts a struct into envelope rules: every field but `type`
// becomes optional on the client side.
//
// ClientMsg and ServerMsg are one flat struct standing in for thirty message
// types, so most of their fields are absent from most messages. Go says so with
// `omitempty`, but not on `turn` and `drawn_count`, which are always marshalled
// because a zero is a real value there. Mirroring that literally would generate
// a validator that refuses every message not carrying them, which is the client
// being stricter than the server: the direction that fails silently and that
// nothing answers. The DTOs below are records rather than unions and keep the
// faithful reading.
const envelopeMarker = "protocolgen:envelope"

type enumConst struct {
	goName string
	value  string
	doc    string
}

type enumDef struct {
	name   string
	doc    string
	consts []enumConst
	// listed is the All* slice's contents, when the package declares one.
	listed    []string
	hasListed bool
}

type fieldDef struct {
	jsonName string
	goType   ast.Expr
	optional bool
	doc      string
	trailing string
}

type structDef struct {
	name     string
	doc      string
	envelope bool
	fields   []fieldDef
}

type pkg struct {
	enums        []*enumDef
	enumByName   map[string]*enumDef
	structs      []*structDef
	structByName map[string]*structDef
}

func main() {
	src := flag.String("src", "protocol", "directory holding the Go protocol package")
	outDir := flag.String("out", "../client/src/types", "directory to write the TypeScript into")
	check := flag.Bool("check", false, "exit non-zero if the files on disk differ from what would be written")
	flag.Parse()

	p, err := load(*src)
	if err != nil {
		fail(err)
	}
	if err := p.validate(); err != nil {
		fail(err)
	}

	types, err := p.emitTypes(*src)
	if err != nil {
		fail(err)
	}
	schemas, err := p.emitSchemas(*src)
	if err != nil {
		fail(err)
	}
	files := map[string][]byte{
		"protocol.ts":        types,
		"protocolSchemas.ts": schemas,
	}
	for name, want := range files {
		path := filepath.Join(*outDir, name)
		if *check {
			got, err := os.ReadFile(path)
			if err != nil {
				fail(fmt.Errorf("%s: %w", path, err))
			}
			if !bytes.Equal(normalise(got), normalise(want)) {
				fail(fmt.Errorf("%s is out of date; run `make protocol`", path))
			}
			continue
		}
		if err := os.WriteFile(path, want, 0o644); err != nil {
			fail(fmt.Errorf("%s: %w", path, err))
		}
		fmt.Fprintln(os.Stderr, "wrote", path)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "protocolgen:", err)
	os.Exit(1)
}

// normalise makes the -check comparison indifferent to the line ending a Windows
// checkout applies, which is otherwise a CI failure nobody can reproduce.
func normalise(b []byte) []byte { return bytes.ReplaceAll(b, []byte("\r\n"), []byte("\n")) }

// load reads every non-test file in the package.
//
// One ParseFile per file rather than ParseDir, which is deprecated for not
// honouring build tags: this package has none, but reading the directory
// explicitly is also what makes the file order visible. os.ReadDir sorts by
// name, so the output is a function of the source and nothing else.
func load(dir string) (*pkg, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	fset := token.NewFileSet()
	var files []*ast.File
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, filepath.Join(dir, name), nil, parser.ParseComments)
		if err != nil {
			return nil, err
		}
		files = append(files, f)
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("%s: no Go files to read", dir)
	}

	p, err := loadFiles(files)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", dir, err)
	}
	return p, nil
}

// loadFiles is the half of load that does not touch the filesystem, so the
// tests can hand it parsed source instead of a directory.
func loadFiles(files []*ast.File) (*pkg, error) {
	p := &pkg{enumByName: map[string]*enumDef{}, structByName: map[string]*structDef{}}
	// Types first: a const block names a type that may be declared in another
	// file, and a field may name a struct declared further down.
	for _, f := range files {
		p.collectTypes(f)
	}
	for _, f := range files {
		if err := p.collectValues(f); err != nil {
			return nil, err
		}
	}
	if len(p.structs) == 0 {
		return nil, fmt.Errorf("no structs found, is that the protocol package?")
	}
	return p, nil
}

func (p *pkg) collectTypes(f *ast.File) {
	for _, decl := range f.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.TYPE {
			continue
		}
		for _, spec := range gen.Specs {
			ts, ok := spec.(*ast.TypeSpec)
			if !ok {
				continue
			}
			doc := docText(ts.Doc, gen.Doc)
			switch t := ts.Type.(type) {
			case *ast.Ident:
				// `type X string` is an enum once a const block fills it in.
				if t.Name == "string" {
					e := &enumDef{name: ts.Name.Name, doc: doc}
					p.enums = append(p.enums, e)
					p.enumByName[e.name] = e
				}
			case *ast.StructType:
				s := &structDef{
					name:     ts.Name.Name,
					doc:      doc,
					envelope: strings.Contains(doc, envelopeMarker),
				}
				s.fields = collectFields(t)
				p.structs = append(p.structs, s)
				p.structByName[s.name] = s
			}
		}
	}
}

func collectFields(t *ast.StructType) []fieldDef {
	var out []fieldDef
	for _, f := range t.Fields.List {
		if f.Tag == nil || len(f.Names) == 0 {
			continue
		}
		tag, err := strconv.Unquote(f.Tag.Value)
		if err != nil {
			continue
		}
		jsonTag := reflectTag(tag, "json")
		if jsonTag == "" || jsonTag == "-" {
			continue
		}
		parts := strings.Split(jsonTag, ",")
		name := parts[0]
		if name == "" {
			continue
		}
		_, isPtr := f.Type.(*ast.StarExpr)
		out = append(out, fieldDef{
			jsonName: name,
			goType:   f.Type,
			optional: isPtr || hasOpt(parts[1:], "omitempty"),
			doc:      docText(f.Doc, nil),
			trailing: strings.TrimSpace(strings.TrimPrefix(commentText(f.Comment), "//")),
		})
	}
	return out
}

func hasOpt(opts []string, want string) bool {
	for _, o := range opts {
		if o == want {
			return true
		}
	}
	return false
}

// reflectTag pulls one key out of a struct tag without importing reflect's
// StructTag, which would need the whole value quoted the way the compiler sees
// it. The protocol package's tags are plain.
func reflectTag(tag, key string) string {
	for _, part := range strings.Fields(tag) {
		k, v, ok := strings.Cut(part, ":")
		if !ok || k != key {
			continue
		}
		unquoted, err := strconv.Unquote(v)
		if err != nil {
			return ""
		}
		return unquoted
	}
	return ""
}

func (p *pkg) collectValues(f *ast.File) error {
	for _, decl := range f.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok {
			continue
		}
		switch gen.Tok {
		case token.CONST:
			for _, spec := range gen.Specs {
				vs, ok := spec.(*ast.ValueSpec)
				if !ok || vs.Type == nil || len(vs.Values) == 0 {
					continue
				}
				ident, ok := vs.Type.(*ast.Ident)
				if !ok {
					continue
				}
				e := p.enumByName[ident.Name]
				if e == nil {
					continue
				}
				for i, n := range vs.Names {
					if i >= len(vs.Values) {
						break
					}
					lit, ok := vs.Values[i].(*ast.BasicLit)
					if !ok || lit.Kind != token.STRING {
						return fmt.Errorf("%s: %s is not a string literal; protocolgen only reads plain constants",
							ident.Name, n.Name)
					}
					val, err := strconv.Unquote(lit.Value)
					if err != nil {
						return err
					}
					e.consts = append(e.consts, enumConst{
						goName: n.Name,
						value:  val,
						doc:    docText(vs.Doc, nil),
					})
				}
			}
		case token.VAR:
			for _, spec := range gen.Specs {
				vs, ok := spec.(*ast.ValueSpec)
				if !ok || len(vs.Values) != 1 || len(vs.Names) != 1 {
					continue
				}
				lit, ok := vs.Values[0].(*ast.CompositeLit)
				if !ok {
					continue
				}
				arr, ok := lit.Type.(*ast.ArrayType)
				if !ok {
					continue
				}
				elem, ok := arr.Elt.(*ast.Ident)
				if !ok {
					continue
				}
				e := p.enumByName[elem.Name]
				if e == nil {
					continue
				}
				e.hasListed = true
				for _, el := range lit.Elts {
					if id, ok := el.(*ast.Ident); ok {
						e.listed = append(e.listed, id.Name)
					}
				}
			}
		}
	}
	return nil
}

// validate is where the All* slices earn their place. enums_test.go pins those
// slices to the domain, and this pins the const block to those slices, so a
// constant declared and left out of its slice is caught here instead of
// silently vanishing from the generated client.
func (p *pkg) validate() error {
	for _, e := range p.enums {
		if len(e.consts) == 0 {
			return fmt.Errorf("%s: declared as a string type with no constants", e.name)
		}
		if !e.hasListed {
			continue
		}
		declared := make([]string, len(e.consts))
		for i, c := range e.consts {
			declared[i] = c.goName
		}
		if strings.Join(declared, ",") != strings.Join(e.listed, ",") {
			return fmt.Errorf("%s: the const block declares [%s] but the All slice lists [%s]; "+
				"the slice is what enums_test.go checks against the domain, so the two must agree",
				e.name, strings.Join(declared, ", "), strings.Join(e.listed, ", "))
		}
	}
	return nil
}

// tsType renders a Go type as TypeScript. It refuses rather than guesses: a
// shape nobody anticipated should stop the build, not reach the client as
// `unknown` or as a silently narrowed type.
func (p *pkg) tsType(e ast.Expr) (string, error) {
	switch t := e.(type) {
	case *ast.StarExpr:
		return p.tsType(t.X)
	case *ast.ArrayType:
		if star, ok := t.Elt.(*ast.StarExpr); ok {
			return "", fmt.Errorf("slice of pointers (%s): a null slot has no honest spelling here; "+
				"make it a slice of values on the Go side", exprString(star))
		}
		inner, err := p.tsType(t.Elt)
		if err != nil {
			return "", err
		}
		return inner + "[]", nil
	case *ast.Ident:
		switch t.Name {
		case "string":
			return "string", nil
		case "bool":
			return "boolean", nil
		case "int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64",
			"float32", "float64":
			return "number", nil
		}
		if _, ok := p.enumByName[t.Name]; ok {
			return t.Name, nil
		}
		if _, ok := p.structByName[t.Name]; ok {
			return t.Name, nil
		}
		return "", fmt.Errorf("unknown type %q", t.Name)
	}
	return "", fmt.Errorf("unsupported type %s", exprString(e))
}

// tsSchema mirrors tsType in Valibot.
func (p *pkg) tsSchema(e ast.Expr) (string, error) {
	switch t := e.(type) {
	case *ast.StarExpr:
		return p.tsSchema(t.X)
	case *ast.ArrayType:
		inner, err := p.tsSchema(t.Elt)
		if err != nil {
			return "", err
		}
		return "v.array(" + inner + ")", nil
	case *ast.Ident:
		switch t.Name {
		case "string":
			return "v.string()", nil
		case "bool":
			return "v.boolean()", nil
		case "int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64",
			"float32", "float64":
			return "v.number()", nil
		}
		if _, ok := p.enumByName[t.Name]; ok {
			return schemaName(t.Name), nil
		}
		if _, ok := p.structByName[t.Name]; ok {
			return schemaName(t.Name), nil
		}
		return "", fmt.Errorf("unknown type %q", t.Name)
	}
	return "", fmt.Errorf("unsupported type %s", exprString(e))
}

// schemaName turns a Go type name into the client's schema constant, which is
// the convention the hand-written file already used: drop DTO, lowercase the
// first letter, append Schema. CardDTO -> cardSchema, ServerMsg -> serverMsgSchema.
func schemaName(goName string) string {
	base := strings.TrimSuffix(goName, "DTO")
	if base == "" {
		return "schema"
	}
	return strings.ToLower(base[:1]) + base[1:] + "Schema"
}

func (p *pkg) emitTypes(src string) ([]byte, error) {
	var b strings.Builder
	writeHeader(&b, src, "the protocol's TypeScript types")

	for _, e := range p.enums {
		b.WriteString("\n")
		writeDoc(&b, e.doc, "")
		values := make([]string, len(e.consts))
		for i, c := range e.consts {
			values[i] = "'" + c.value + "'"
		}
		fmt.Fprintf(&b, "export type %s =\n", e.name)
		for i, c := range e.consts {
			writeDoc(&b, c.doc, "  ")
			fmt.Fprintf(&b, "  | %s\n", values[i])
		}
	}

	for _, s := range p.structs {
		b.WriteString("\n")
		writeDoc(&b, stripMarker(s.doc), "")
		fmt.Fprintf(&b, "export interface %s {\n", s.name)
		for _, f := range s.fields {
			writeDoc(&b, f.doc, "  ")
			typ, err := p.tsType(f.goType)
			if err != nil {
				return nil, fmt.Errorf("%s.%s: %w", s.name, f.jsonName, err)
			}
			opt := ""
			if f.optional || (s.envelope && f.jsonName != "type") {
				opt = "?"
			}
			fmt.Fprintf(&b, "  %s%s: %s", f.jsonName, opt, typ)
			if f.trailing != "" {
				fmt.Fprintf(&b, " // %s", f.trailing)
			}
			b.WriteString("\n")
		}
		b.WriteString("}\n")
	}
	return []byte(b.String()), nil
}

func (p *pkg) emitSchemas(src string) ([]byte, error) {
	var b strings.Builder
	writeHeader(&b, src, "the inbound validation schemas")
	b.WriteString("\nimport * as v from 'valibot'\n")

	for _, e := range p.enums {
		b.WriteString("\n")
		writeDoc(&b, e.doc, "")
		values := make([]string, len(e.consts))
		for i, c := range e.consts {
			values[i] = "'" + c.value + "'"
		}
		fmt.Fprintf(&b, "export const %s = v.picklist([\n", schemaName(e.name))
		for _, val := range values {
			fmt.Fprintf(&b, "  %s,\n", val)
		}
		b.WriteString("])\n")
	}

	for _, s := range p.ordered() {
		b.WriteString("\n")
		writeDoc(&b, stripMarker(s.doc), "")
		fmt.Fprintf(&b, "export const %s = v.object({\n", schemaName(s.name))
		for _, f := range s.fields {
			writeDoc(&b, f.doc, "  ")
			schema, err := p.tsSchema(f.goType)
			if err != nil {
				return nil, fmt.Errorf("%s.%s: %w", s.name, f.jsonName, err)
			}
			if f.optional || (s.envelope && f.jsonName != "type") {
				schema = "v.optional(" + schema + ")"
			}
			fmt.Fprintf(&b, "  %s: %s,\n", f.jsonName, schema)
		}
		b.WriteString("})\n")
	}
	return []byte(b.String()), nil
}

// ordered sorts the structs so a schema is declared before anything referencing
// it. Interfaces are hoisted and do not care; `const` bindings do, and getting
// this wrong is a temporal-dead-zone crash on the first message rather than a
// compile error.
func (p *pkg) ordered() []*structDef {
	var out []*structDef
	seen := map[string]bool{}
	var visit func(s *structDef)
	visit = func(s *structDef) {
		if seen[s.name] {
			return
		}
		seen[s.name] = true
		for _, f := range s.fields {
			if dep := p.structByName[baseIdent(f.goType)]; dep != nil {
				visit(dep)
			}
		}
		out = append(out, s)
	}
	for _, s := range p.structs {
		visit(s)
	}
	return out
}

// baseIdent digs through pointers and slices to the named type underneath.
func baseIdent(e ast.Expr) string {
	switch t := e.(type) {
	case *ast.StarExpr:
		return baseIdent(t.X)
	case *ast.ArrayType:
		return baseIdent(t.Elt)
	case *ast.Ident:
		return t.Name
	}
	return ""
}

func writeHeader(b *strings.Builder, src, what string) {
	fmt.Fprintf(b, `// Code generated by server/cmd/protocolgen. DO NOT EDIT.
//
// Source: server/%s. Regenerate with "make protocol"; CI fails the build if
// this file and the Go source have drifted apart, so editing it by hand is
// undone by the next run rather than merged.
//
// This file carries %s.
`, src, what)
}

func stripMarker(doc string) string {
	var kept []string
	for _, line := range strings.Split(doc, "\n") {
		if strings.Contains(line, envelopeMarker) {
			continue
		}
		kept = append(kept, line)
	}
	return strings.TrimRight(strings.Join(kept, "\n"), "\n")
}

func writeDoc(b *strings.Builder, doc, indent string) {
	if strings.TrimSpace(doc) == "" {
		return
	}
	for _, line := range strings.Split(doc, "\n") {
		if line == "" {
			fmt.Fprintf(b, "%s//\n", indent)
			continue
		}
		fmt.Fprintf(b, "%s// %s\n", indent, line)
	}
}

// docText flattens a doc comment, preferring the spec's own over the block's.
func docText(primary, fallback *ast.CommentGroup) string {
	g := primary
	if g == nil {
		g = fallback
	}
	if g == nil {
		return ""
	}
	var lines []string
	for _, c := range g.List {
		text := strings.TrimPrefix(c.Text, "//")
		lines = append(lines, strings.TrimSpace(text))
	}
	return strings.Join(lines, "\n")
}

func commentText(g *ast.CommentGroup) string {
	if g == nil {
		return ""
	}
	return g.List[0].Text
}

// exprString names a type well enough for an error message. The errors it
// feeds all stop the build, so the reader has the source open anyway.
func exprString(e ast.Expr) string {
	if name := baseIdent(e); name != "" {
		return name
	}
	return "an unnamed type"
}
