// Package product runs product lifecycle plans through caller-owned ports.
package product

import (
	"strings"

	domain "ariadne/runtime/internal/core/domain/product"
)

type Ports struct {
	Run    func(domain.Step) (int, error)
	Report func(string) error
}

func RunProduct(action string, modules []string, ports Ports) (int, error) {
	scope := strings.Join(modules, ",")
	if err := ports.Report("product: " + action + " modules=" + scope); err != nil {
		return 0, err
	}
	for _, step := range domain.LifecycleSteps(action, modules) {
		status, err := ports.Run(step)
		if err != nil {
			return 0, err
		}
		if status != 0 {
			return status, nil
		}
	}
	if err := ports.Report("product: " + action + " complete modules=" + scope); err != nil {
		return 0, err
	}
	return 0, nil
}
