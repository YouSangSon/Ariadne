package verification

import v "ariadne/runtime/internal/core/domain/verification"

type Ports interface {
	// ListTests returns the caught message, including an empty message, as its second result.
	ListTests() ([]v.Text, *v.Text)
	RunTests([]v.Text) (*v.Text, error)
	CheckMirrors() (*v.Text, error)
	CommitLog() (*v.Text, error)
	Start(string) error
	Finish(string, *v.Text) error
	Report(string) error
}

// VerifySources returns an exit code when no uncaught port error occurred.
func VerifySources(withCode bool, ports Ports) (int, error) {
	testStep := "source tests only"
	if withCode {
		testStep = "source tests + code integration"
	}
	steps := [...]struct {
		name string
		run  func() (*v.Text, error)
	}{
		{testStep, func() (*v.Text, error) {
			names, caught := ports.ListTests()
			if caught != nil {
				return caught, nil
			}
			tests, err := v.SourceTests(names, withCode)
			if err != nil {
				message := v.TextOf(err.Error())
				return &message, nil
			}
			return ports.RunTests(tests)
		}},
		{"check-mirror", ports.CheckMirrors},
		{"commit-req-invariant", func() (*v.Text, error) {
			log, err := ports.CommitLog()
			if err != nil {
				return nil, err
			}
			if log == nil {
				message := v.TextOf("git log 실패 (git 리포 아님?)")
				return &message, nil
			}
			return v.CommitErrors(*log), nil
		}},
	}
	for _, step := range steps {
		if err := ports.Start(step.name); err != nil {
			return 0, err
		}
		token, err := step.run()
		if err != nil {
			return 0, err
		}
		failed := false
		if token != nil {
			// Pass the text by value like the Node callback despite its nullable Go representation.
			value := *token
			token = &value
			failed = !value.IsEmpty()
		}
		if err := ports.Finish(step.name, token); err != nil {
			return 0, err
		}
		if failed {
			return 1, nil
		}
	}
	return 0, ports.Report("verify: green")
}
