package files

import "golang.org/x/sys/unix"

// Traversal requires search permission. Directory listing would also require read permission.
const searchDirectoryFlags = unix.O_SEARCH | unix.O_NOFOLLOW | unix.O_CLOEXEC
