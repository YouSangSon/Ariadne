package domain

import (
	"errors"
	"slices"
)

func SourceFiles(paths []Text, reqID *string) ([]Text, error) {
	files := []Text{}
	seen := map[string]bool{}
	selected := ""
	if reqID != nil {
		selected = ".harness/reqs/" + *reqID + ".yaml"
	}
	for _, path := range paths {
		key := stringUnitsKey(path)
		if seen[key] {
			continue
		}
		seen[key] = true
		if reqID != nil && path.equal(selected) || path.equal(".harness/handoff") || path.starts(".harness/handoff/") {
			continue
		}
		excluded := false
		start := 0
		for i := 0; i <= len(path.units); i++ {
			if i < len(path.units) && path.units[i] != '/' {
				continue
			}
			component := Text{path.units[start:i]}
			if component.equal(".git") || component.equal("node_modules") {
				excluded = true
				break
			}
			start = i + 1
		}
		if !excluded {
			files = append(files, path)
		}
	}
	slices.SortFunc(files, func(a, b Text) int { return slices.Compare(a.units, b.units) })
	if len(files) > 10000 {
		return nil, errors.New("Source input file count exceeds 10000")
	}
	return files, nil
}
func stringUnitsKey(t Text) string {
	b := make([]byte, 2*len(t.units))
	for i, u := range t.units {
		b[2*i] = byte(u >> 8)
		b[2*i+1] = byte(u)
	}
	return string(b)
}
