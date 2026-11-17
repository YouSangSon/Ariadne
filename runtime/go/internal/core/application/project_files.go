package coreapp

type FileIdentity struct{ Device, Inode uint64 }

// ProjectText contains raw verified UTF-8. Presentation must scrub its text.
type ProjectText struct {
	Bytes    []byte
	SHA256   string
	Identity FileIdentity
}
type ProjectTextReader interface {
	ReadProjectText(root, path string) (ProjectText, error)
}
