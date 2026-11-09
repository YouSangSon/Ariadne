package application

import (
	"encoding/json"
	"errors"
)

type EnvironmentReport struct {
	Status           string   `json:"status"`
	RuntimeQualified bool     `json:"runtimeQualified"`
	Reasons          []string `json:"reasons"`
}

// AssessEnvironment checks reported metadata only; it cannot qualify a sandbox.
func AssessEnvironment(data []byte) (EnvironmentReport, error) {
	if len(data) > 1<<20 {
		return EnvironmentReport{}, errors.New("environment metadata exceeds limit")
	}
	var info struct {
		Host struct {
			OS       string `json:"os"`
			Arch     string `json:"arch"`
			Cgroup   string `json:"cgroupVersion"`
			Security struct {
				Rootless bool `json:"rootless"`
				Seccomp  bool `json:"seccompEnabled"`
			} `json:"security"`
		} `json:"host"`
	}
	if err := json.Unmarshal(data, &info); err != nil {
		return EnvironmentReport{}, errors.New("invalid environment metadata")
	}
	r := EnvironmentReport{Status: "unsupported", Reasons: []string{}}
	if !info.Host.Security.Rootless {
		r.Reasons = append(r.Reasons, "rootless server required")
	}
	if !info.Host.Security.Seccomp {
		r.Reasons = append(r.Reasons, "seccomp required")
	}
	if info.Host.Cgroup != "v2" {
		r.Reasons = append(r.Reasons, "cgroup v2 required")
	}
	if info.Host.OS != "linux" || (info.Host.Arch != "arm64" && info.Host.Arch != "amd64") {
		r.Reasons = append(r.Reasons, "unsupported server platform")
	}
	if len(r.Reasons) == 0 {
		r.Status = "qualification-required"
	}
	r.Reasons = append(r.Reasons, "metadata is not execution evidence: image, limits, logging, endpoint and parent-independent termination remain unqualified")
	return r, nil
}
