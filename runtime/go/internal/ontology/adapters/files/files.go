package ontologyfiles

import (
	coreapp "ariadne/runtime/internal/core/application"
	ontologyjson "ariadne/runtime/internal/ontology/adapters/json"
	ontologyapp "ariadne/runtime/internal/ontology/application"
	ontology "ariadne/runtime/internal/ontology/domain"
	"errors"
	"path/filepath"
)

func New(file string, reader coreapp.ProjectTextReader) (ontologyapp.Ports, error) {
	absolute, err := absoluteFile(file)
	if err != nil {
		return ontologyapp.Ports{}, err
	}
	root := filepath.Dir(absolute)
	var manifest coreapp.FileIdentity
	return ontologyapp.Ports{
		ReadDocument: func() (any, error) {
			source, err := reader.ReadProjectText(root, filepath.Base(absolute))
			if err != nil {
				return nil, err
			}
			manifest = source.Identity
			return ontologyjson.DecodeDocument(source.Bytes)
		},
		ReadSource: func(path ontology.Text) (string, error) {
			source, err := reader.ReadProjectText(root, path.String())
			if err != nil {
				return "", err
			}
			if source.Identity == manifest {
				return "", errors.New("Ontology manifest cannot be its own source")
			}
			return source.SHA256, nil
		},
		Fingerprint: ontologyjson.Fingerprint,
	}, nil
}
