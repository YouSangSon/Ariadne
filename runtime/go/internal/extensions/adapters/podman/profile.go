package podman

import (
	"errors"
	"regexp"
)

var namePattern = regexp.MustCompile(`^ariadne-q-[a-z0-9-]{1,40}$`)
var imagePattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

// ProfileArgs is a fixed qualification profile, not permission to execute an extension.
func ProfileArgs(name, imageID string) ([]string, error) {
	if !namePattern.MatchString(name) || !imagePattern.MatchString(imageID) {
		return nil, errors.New("invalid qualification resource identity")
	}
	return []string{"run", "--name=" + name, "--label=io.ariadne.qualification=" + name, "--pull=never", "--network=none", "--pid=private", "--ipc=none", "--uts=private", "--read-only", "--read-only-tmpfs=false", "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777", "--log-driver=none", "--timeout=30", "--restart=no", "--http-proxy=false", "--memory=256m", "--memory-swap=256m", "--cpus=1", "--pids-limit=32", "--cap-drop=ALL", "--user=65532:65532", "--security-opt=no-new-privileges", "--entrypoint=/usr/local/bin/ariadne-extension-worker", "-i", imageID}, nil
}
