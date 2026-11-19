package files

import "golang.org/x/sys/unix"

const searchDirectoryFlags = unix.O_PATH | unix.O_DIRECTORY | unix.O_NOFOLLOW | unix.O_CLOEXEC
