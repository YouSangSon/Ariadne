package domain

import (
	"errors"
	"regexp"
	"unicode/utf8"
)

const (
	World            = "ariadne:extensions/report-projector@1.0.0"
	MaxManifestBytes = 32 << 10
	MaxArtifactBytes = 8 << 20
	MaxPackageBytes  = 16 << 20
	MaxInputBytes    = 1 << 20
	MaxOutputBytes   = 256 << 10
	MaxSections      = 32
	MaxTableCells    = 1024
	MaxStringBytes   = 8 << 10
)

type Manifest struct {
	SchemaVersion         int      `json:"schemaVersion"`
	ExtensionID           string   `json:"extensionId"`
	Version               string   `json:"version"`
	World                 string   `json:"world"`
	ArtifactSHA256        string   `json:"artifactSha256"`
	SDKMajor              int      `json:"sdkMajor"`
	Description           string   `json:"description"`
	RequestedCapabilities []string `json:"requestedCapabilities"`
	License               string   `json:"license"`
}

var extensionIDPattern = regexp.MustCompile(`^[a-z][a-z0-9-]*/[a-z][a-z0-9-]*$`)
var versionPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$`)
var hashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var licensePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.+-]*$`)

func ParseManifest(data []byte) (Manifest, error) {
	var manifest Manifest
	if err := DecodeStrictJSON(data, MaxManifestBytes, &manifest); err != nil {
		return Manifest{}, err
	}
	if err := ValidateManifest(manifest); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func ValidateManifest(manifest Manifest) error {
	if manifest.SchemaVersion != 1 || manifest.SDKMajor != 1 || manifest.World != World {
		return errors.New("unsupported manifest schema, SDK major or world")
	}
	if len(manifest.ExtensionID) > 128 || !extensionIDPattern.MatchString(manifest.ExtensionID) {
		return errors.New("invalid namespaced extension ID")
	}
	if len(manifest.Version) > 64 || !versionPattern.MatchString(manifest.Version) {
		return errors.New("invalid extension version")
	}
	if !hashPattern.MatchString(manifest.ArtifactSHA256) {
		return errors.New("invalid artifact SHA-256")
	}
	if manifest.RequestedCapabilities == nil || len(manifest.RequestedCapabilities) != 0 {
		return errors.New("v1 requires an empty capability array")
	}
	if len(manifest.License) > 128 || !licensePattern.MatchString(manifest.License) {
		return errors.New("invalid license identifier")
	}
	if manifest.Description == "" || len(manifest.Description) > MaxStringBytes || !utf8.ValidString(manifest.Description) {
		return errors.New("invalid description")
	}
	for _, r := range manifest.Description {
		if r < 32 || r == 127 {
			return errors.New("control character in description")
		}
	}
	return nil
}
