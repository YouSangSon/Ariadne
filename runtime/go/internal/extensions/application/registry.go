package application

import (
	"ariadne/runtime/internal/extensions/domain"
	"context"
)

type PackageReader interface {
	ReadPackage(string) (domain.PackageSnapshot, error)
}
type Registry interface {
	Inspect(context.Context, string) (domain.RegistryView, error)
	Install(context.Context, domain.PackageSnapshot) (domain.RegistryView, error)
	Activate(context.Context, string, string, int64) (domain.RegistryView, error)
	Disable(context.Context, string, int64) (domain.RegistryView, error)
	Remove(context.Context, string, string, int64) (domain.RegistryView, error)
}
