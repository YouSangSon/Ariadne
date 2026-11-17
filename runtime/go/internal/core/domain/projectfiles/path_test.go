package projectfiles

import (
	"sync"
	"testing"
)

func TestNodePathPolicy(t *testing.T) {
	for _, p := range []string{"docs/readme.md", "ID_rsa-other", "İD_rsa", "ｉｄ_rsa", "README", "Σ.txt", "K.txt"} {
		if _, err := Path(p); err != nil {
			t.Fatalf("allowed %q: %v", p, err)
		}
	}
	for _, p := range []string{"", "/a", "a/", "a//b", "a/./b", "a/../b", `a\b`, "a\x00b", "a\x1fb", "a\x7fb", "C:a", "a/.GIT/x", "AGENTS.MD", "x/.envy", "a.credential.txt", "secret-files/a", "id_rsa", "ID_ED25519.pub", "file.KEY", "file.KEY"} {
		if _, err := Path(p); err == nil {
			t.Fatalf("denied %q", p)
		}
	}
	var wg sync.WaitGroup
	for _, p := range []string{"İD_rsa", "file.KEY"} {
		wg.Go(func() {
			for range 10 {
				_, _ = Path(p)
			}
		})
	}
	wg.Wait()
}
