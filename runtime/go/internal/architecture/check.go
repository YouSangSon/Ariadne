package architecture

import (
	"encoding/json"
	"fmt"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type Record struct {
	Layer   string `json:"layer"`
	Context string `json:"context"`
	Public  bool   `json:"public,omitempty"`
}

type source struct {
	path    string
	imports []string
	record  Record
}

// Check includes every Go source, regardless of the current build tags or platform.
func Check(root string) ([]string, error) {
	data, err := os.ReadFile(filepath.Join(root, "architecture-map.json"))
	if err != nil {
		return nil, err
	}
	var inventory struct {
		Version int               `json:"schema_version"`
		Files   map[string]Record `json:"files"`
	}
	if err := json.Unmarshal(data, &inventory); err != nil {
		return nil, err
	}
	if inventory.Version != 1 || inventory.Files == nil {
		return nil, fmt.Errorf("unsupported architecture map")
	}
	data, err = os.ReadFile(filepath.Join(root, "runtime/go/go.mod"))
	if err != nil {
		return nil, err
	}
	module := ""
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && fields[0] == "module" {
			module = fields[1]
			if strings.HasPrefix(module, "\"") {
				module, err = strconv.Unquote(module)
			}
			break
		}
	}
	if err != nil || module == "" {
		return nil, fmt.Errorf("invalid runtime/go/go.mod module declaration")
	}
	var violations []string
	actual := map[string]bool{}
	packages := map[string][]source{}
	var sources []source
	err = filepath.WalkDir(filepath.Join(root, "runtime/go"), func(filename string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(filename, ".go") {
			return nil
		}
		relative, err := filepath.Rel(root, filename)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(relative)
		actual[name] = true
		record, owned := inventory.Files[name]
		if !owned {
			violations = append(violations, "unowned source "+name)
		}
		parsed, err := parser.ParseFile(token.NewFileSet(), filename, nil, 0)
		if err != nil {
			violations = append(violations, name+": "+err.Error())
			return nil
		}
		item := source{path: name, record: record}
		for _, spec := range parsed.Imports {
			dependency, err := strconv.Unquote(spec.Path.Value)
			if err != nil {
				return err
			}
			item.imports = append(item.imports, dependency)
		}
		sources = append(sources, item)
		if !strings.HasSuffix(name, "_test.go") {
			packages[path.Dir(name)] = append(packages[path.Dir(name)], item)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	for name, record := range inventory.Files {
		if !strings.HasPrefix(name, "runtime/go/") || !strings.HasSuffix(name, ".go") {
			continue
		}
		if !actual[name] {
			violations = append(violations, "stale ownership "+name)
		}
		if !validLayer(record.Layer) || strings.TrimSpace(record.Context) == "" || record.Public && record.Layer != "application" {
			violations = append(violations, "invalid ownership "+name)
		}
		if !strings.HasSuffix(name, "_test.go") {
			for _, segment := range strings.Split(path.Dir(name), "/") {
				prescribed := segment
				if segment == "adapters" {
					prescribed = "infrastructure"
				}
				if (prescribed == "domain" || prescribed == "application" || prescribed == "infrastructure" || prescribed == "composition" || prescribed == "interfaces") && record.Layer != prescribed {
					violations = append(violations, "incorrect layer classification "+name)
				}
			}
		}
	}
	for name, files := range packages {
		for _, file := range files[1:] {
			if file.record.Layer != files[0].record.Layer || file.record.Context != files[0].record.Context {
				violations = append(violations, "inconsistent package ownership "+name)
				break
			}
		}
	}
	graph := map[string][]string{}
	contexts := map[string][]string{}
	for _, file := range sources {
		inner := file.record.Layer == "domain" || file.record.Layer == "application"
		for _, dependency := range file.imports {
			if dependency != module && !strings.HasPrefix(dependency, module+"/") {
				if inner && !pureImport(dependency, file.record.Layer) {
					violations = append(violations, file.path+": inward layer imports platform/package "+dependency)
				}
				continue
			}
			target := "runtime/go" + strings.TrimPrefix(dependency, module)
			files := packages[target]
			if len(files) == 0 {
				violations = append(violations, file.path+": unowned local dependency "+dependency)
				continue
			}
			if !strings.HasSuffix(file.path, "_test.go") {
				graph[path.Dir(file.path)] = append(graph[path.Dir(file.path)], target)
			}
			public := false
			// Go exports belong to a package; one reviewed application record opens that package.
			for _, candidate := range files {
				public = public || candidate.record.Layer == "application" && candidate.record.Public
			}
			targetRecord := files[0].record
			if file.record.Layer != "tooling" && file.record.Layer != "composition" && file.record.Context != targetRecord.Context && !public {
				violations = append(violations, file.path+": cross-context internal dependency "+dependency)
			}
			if !strings.HasSuffix(file.path, "_test.go") && file.record.Context != targetRecord.Context &&
				file.record.Layer != "tooling" && file.record.Layer != "composition" &&
				targetRecord.Layer != "tooling" && targetRecord.Layer != "composition" {
				contexts[file.record.Context] = append(contexts[file.record.Context], targetRecord.Context)
			}
			if file.record.Layer == "domain" && targetRecord.Layer != "domain" {
				violations = append(violations, file.path+": domain depends outward on "+dependency)
			}
			if file.record.Layer == "application" && targetRecord.Layer != "domain" && targetRecord.Layer != "application" {
				violations = append(violations, file.path+": application depends outward on "+dependency)
			}
		}
	}
	violations = append(violations, cycleErrors(graph, "import cycle")...)
	violations = append(violations, cycleErrors(contexts, "module context cycle")...)
	sort.Strings(violations)
	return violations, nil
}

func cycleErrors(graph map[string][]string, kind string) []string {
	var violations []string
	state := map[string]int{}
	var visit func(string)
	visit = func(name string) {
		if state[name] == 2 {
			return
		}
		if state[name] == 1 {
			violations = append(violations, kind+" at "+name)
			return
		}
		state[name] = 1
		for _, dependency := range graph[name] {
			visit(dependency)
		}
		state[name] = 2
	}
	var names []string
	for name := range graph {
		names = append(names, name)
		sort.Strings(graph[name])
	}
	sort.Strings(names)
	for _, name := range names {
		visit(name)
	}
	return violations
}

func validLayer(layer string) bool {
	switch layer {
	case "domain", "application", "infrastructure", "interfaces", "composition", "compatibility", "tooling":
		return true
	}
	return false
}

func pureImport(dependency, layer string) bool {
	switch dependency {
	case "bytes", "cmp", "errors", "fmt", "io", "iter", "maps", "math", "math/big", "math/bits", "path", "reflect", "regexp", "regexp/syntax", "slices", "sort", "strconv", "strings", "unicode", "unicode/utf8", "unicode/utf16",
		"crypto", "crypto/sha256", "crypto/sha512", "crypto/subtle", "hash", "hash/adler32", "hash/crc32", "hash/crc64", "hash/fnv",
		"encoding", "encoding/ascii85", "encoding/asn1", "encoding/base32", "encoding/base64", "encoding/binary", "encoding/csv", "encoding/gob", "encoding/hex", "encoding/json", "encoding/pem", "encoding/xml":
		return true
	case "context", "time", "sync", "sync/atomic":
		return layer == "application"
	}
	return false
}
