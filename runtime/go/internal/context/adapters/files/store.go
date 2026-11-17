package contextfiles

import (
	contextapp "ariadne/runtime/internal/context/application"
	"ariadne/runtime/internal/context/domain"
	coreapp "ariadne/runtime/internal/core/application"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type Store struct {
	root           string
	reader         coreapp.ProjectTextReader
	observe        func(string)
	closeDirectory func(*os.File) error
}

// New performs no I/O: a missing workspace may have an empty pack or catalog.
func New(root string, reader coreapp.ProjectTextReader) Store {
	return Store{root: root, reader: reader}
}
func (s Store) ReadSkill(id string) (contextapp.SkillRecord, error) {
	if len(coreapp.Detect(domain.FromString(id).Units())) > 0 {
		return contextapp.SkillRecord{}, errors.New("secret-bearing skill identifiers are denied")
	}
	path := "skills/" + id + "/SKILL.md"
	file, err := s.reader.ReadProjectText(s.root, path)
	if err != nil {
		return contextapp.SkillRecord{}, err
	}
	if len(file.Bytes) > 64*1024 {
		return contextapp.SkillRecord{}, errors.New("skill exceeds 64 KiB")
	}
	text := domain.FromString(string(file.Bytes))
	metadata, err := domain.SkillMetadata(id, text)
	if err != nil {
		return contextapp.SkillRecord{}, err
	}
	content := scrub(text)
	return contextapp.SkillRecord{Name: metadata.Name, Description: scrub(metadata.Description), Path: path, SHA256: file.SHA256, Chars: content.Len(), Content: content}, nil
}
func scrub(t domain.Text) domain.Text { return domain.NewText(coreapp.Scrub(t.Units())) }
func (s Store) record(parts ...string) string {
	return filepath.Join(append([]string{s.root, ".harness"}, parts...)...)
}
func exists(path string) bool { _, err := os.Stat(path); return err == nil }
func (s Store) readIf(path string) (domain.Text, error) {
	if !exists(path) {
		return domain.Text{}, nil
	}
	if s.observe != nil {
		s.observe(path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return domain.Text{}, err
	}
	return scrub(domain.FromString(lossy(string(data)))), nil
}
func (s Store) ReadHandoff() (domain.Text, error)   { return s.readIf(s.record("handoff", "LATEST.md")) }
func (s Store) ReadDecisions() (domain.Text, error) { return s.readIf(s.record("decisions.md")) }
func (s Store) HasRequirement(slug string) (bool, error) {
	return exists(s.record("reqs", slug+".yaml")), nil
}
func (s Store) ReadRequirement(slug string) (domain.Text, error) {
	return s.readIf(s.record("reqs", slug+".yaml"))
}
func (s Store) ListRequirements() (names []string, err error) {
	path := s.record("reqs")
	names = []string{}
	if !exists(path) {
		return names, nil
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() {
		err = errors.Join(err, f.Close())
		if err != nil {
			names = nil
		}
	}()
	raw, err := f.Readdirnames(-1)
	if err != nil {
		return nil, err
	}
	for _, name := range raw {
		name = lossy(name)
		if strings.HasSuffix(name, ".yaml") {
			names = append(names, name)
		}
	}
	sortUTF16(names)
	for i := range names {
		names[i] = strings.TrimSuffix(names[i], ".yaml")
	}
	return names, nil
}
func sortUTF16(names []string) {
	sort.SliceStable(names, func(i, j int) bool {
		a, b := domain.FromString(names[i]).Units(), domain.FromString(names[j]).Units()
		for n := 0; n < len(a) && n < len(b); n++ {
			if a[n] != b[n] {
				return a[n] < b[n]
			}
		}
		return len(a) < len(b)
	})
}
