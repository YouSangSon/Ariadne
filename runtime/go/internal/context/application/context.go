package application

import (
	"ariadne/runtime/internal/context/domain"
	"errors"
	"fmt"
)

// SkillRecord is already scrubbed by the port. SHA256 identifies original bytes.
type SkillRecord struct {
	Name, Path, SHA256   string
	Chars                int
	Description, Content domain.Text
}
type PackStore interface {
	ReadSkill(string) (SkillRecord, error)
	ReadHandoff() (domain.Text, error)
	ReadDecisions() (domain.Text, error)
	HasRequirement(string) (bool, error)
	ReadRequirement(string) (domain.Text, error)
	ListRequirements() ([]string, error)
}
type CatalogStore interface {
	ListSkills() ([]string, error)
	ReadSkill(string) (SkillRecord, error)
}
type BuildOptions struct {
	Budget  string
	ReqSlug *string
	Skills  []string
}
type CatalogSkill struct {
	Name, Path, SHA256, Selection string
	Chars                         int
	Description                   domain.Text
}
type Catalog struct {
	SchemaVersion int
	Trust         string
	Skills        []CatalogSkill
}

func BuildPack(store PackStore, options BuildOptions) (domain.Text, error) {
	if len(options.Skills) > 20 {
		return domain.Text{}, errors.New("select at most 20 skills")
	}
	selected := make([]domain.Selection, len(options.Skills))
	for i, value := range options.Skills {
		var err error
		selected[i], err = domain.SkillSelection(value)
		if err != nil {
			return domain.Text{}, err
		}
	}
	seen := map[string]bool{}
	for _, selection := range selected {
		if seen[selection.ID] {
			return domain.Text{}, errors.New("duplicate skill selection")
		}
		seen[selection.ID] = true
	}
	skills := make([]domain.SelectedSkill, len(selected))
	for i, selection := range selected {
		skill, err := store.ReadSkill(selection.ID)
		if err != nil {
			return domain.Text{}, err
		}
		if skill.SHA256 != selection.SHA256 {
			return domain.Text{}, fmt.Errorf("skill %s: SHA changed; select again", selection.ID)
		}
		skills[i] = domain.SelectedSkill{Selection: selection.ID + "@" + selection.SHA256, Path: skill.Path, Content: skill.Content}
	}
	if options.ReqSlug != nil && !domain.ValidRequirementSlug(*options.ReqSlug) {
		return domain.Text{}, errors.New("REQ slug는 소문자·숫자·하이픈만 허용한다")
	}
	handoffText, err := store.ReadHandoff()
	if err != nil {
		return domain.Text{}, err
	}
	handoff, err := domain.HandoffSections(handoffText)
	if err != nil {
		return domain.Text{}, err
	}
	decisions, err := store.ReadDecisions()
	if err != nil {
		return domain.Text{}, err
	}
	var requirement domain.Text
	if options.ReqSlug != nil {
		slug := *options.ReqSlug
		exists, err := store.HasRequirement(slug)
		if err != nil {
			return domain.Text{}, err
		}
		if !exists {
			return domain.Text{}, fmt.Errorf("REQ %s: 파일이 없다", slug)
		}
		requirement, err = store.ReadRequirement(slug)
		if err != nil {
			return domain.Text{}, err
		}
		if _, err = domain.RequirementStatus(requirement, slug); err != nil {
			return domain.Text{}, err
		}
	} else {
		slugs, err := store.ListRequirements()
		if err != nil {
			return domain.Text{}, err
		}
		active := 0
		for _, slug := range slugs {
			text, err := store.ReadRequirement(slug)
			if err != nil {
				return domain.Text{}, err
			}
			status, err := domain.RequirementStatus(text, slug)
			if err != nil {
				return domain.Text{}, err
			}
			if status != "verified" {
				active++
				requirement = text
			}
		}
		if active > 1 {
			return domain.Text{}, errors.New("활성 REQ가 여러 개다. --req <slug>로 선택한다")
		}
	}
	return domain.RenderPack(domain.RenderInput{Requirement: requirement, Handoff: handoff, Decisions: decisions, Budget: options.Budget, SelectedSkills: skills})
}
func SkillCatalog(store CatalogStore) (Catalog, error) {
	ids, err := store.ListSkills()
	if err != nil {
		return Catalog{}, err
	}
	catalog := Catalog{SchemaVersion: 1, Trust: "untrusted_reference_not_permission", Skills: make([]CatalogSkill, 0, len(ids))}
	for _, id := range ids {
		skill, err := store.ReadSkill(id)
		if err != nil {
			return Catalog{}, err
		}
		catalog.Skills = append(catalog.Skills, CatalogSkill{Name: skill.Name, Path: skill.Path, SHA256: skill.SHA256, Selection: skill.Name + "@" + skill.SHA256, Chars: skill.Chars, Description: skill.Description})
	}
	return catalog, nil
}
