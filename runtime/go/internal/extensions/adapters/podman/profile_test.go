package podman

import (
	"slices"
	"strings"
	"testing"
)

func TestProfileBindsImmutableImageAndIndependentLimits(t *testing.T) {
	image := strings.Repeat("a", 64)
	args, err := ProfileArgs("ariadne-q-1234", image)
	if err != nil {
		t.Fatal(err)
	}
	for _, flag := range []string{"--pull=never", "--network=none", "--read-only", "--read-only-tmpfs=false", "--log-driver=none", "--timeout=30", "--restart=no", "--http-proxy=false", "--memory=256m", "--memory-swap=256m", "--cpus=1", "--pids-limit=32", "--cap-drop=ALL", "--user=65532:65532", "--security-opt=no-new-privileges", "--entrypoint=/usr/local/bin/ariadne-extension-worker"} {
		if !slices.Contains(args, flag) {
			t.Errorf("missing enforced runtime flag %s in %v", flag, args)
		}
	}
	if len(args) == 0 || args[len(args)-1] != image {
		t.Fatal("immutable image not bound")
	}
	if slices.Contains(args, "--rm") {
		t.Fatal("state removed before exit/cleanup evidence")
	}
}

func TestProfileRejectsMutableOrInjectedIdentity(t *testing.T) {
	for _, tc := range []struct{ name, image string }{{"ariadne-q-1", "latest"}, {"--privileged", strings.Repeat("a", 64)}, {"ariadne-q-1", "abc"}, {"different-project", strings.Repeat("a", 64)}} {
		if _, err := ProfileArgs(tc.name, tc.image); err == nil {
			t.Fatalf("invalid identity accepted %+v", tc)
		}
	}
}
