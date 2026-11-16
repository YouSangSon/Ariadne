package sqlite

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"io"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"syscall"

	"ariadne/runtime/internal/extensions/application"
	"ariadne/runtime/internal/extensions/domain"
	sqlite3 "github.com/mattn/go-sqlite3"
)

const schema = `
CREATE TABLE registry_meta(schema_version INTEGER NOT NULL, checkout TEXT NOT NULL, owner_uid INTEGER NOT NULL, device TEXT NOT NULL, inode TEXT NOT NULL);
CREATE TABLE extension_heads(id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>=1), selected_digest TEXT, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), CHECK(enabled=0 OR selected_digest IS NOT NULL), FOREIGN KEY(id,selected_digest) REFERENCES packages(id,digest));
CREATE TABLE packages(digest TEXT PRIMARY KEY, id TEXT NOT NULL, version TEXT NOT NULL, manifest BLOB NOT NULL, status TEXT NOT NULL CHECK(status IN ('installed','removing')), UNIQUE(id,digest), FOREIGN KEY(id) REFERENCES extension_heads(id));
`

var _ application.Registry = (*Store)(nil)

type Store struct {
	db        *sql.DB
	workspace string
	root      string
	device    string
	inode     string
	hook      func(string)
}

func trustedAncestry(path string) error {
	var chain []string
	for current := path; ; current = filepath.Dir(current) {
		chain = append(chain, current)
		if filepath.Dir(current) == current {
			break
		}
	}
	for i := len(chain) - 1; i >= 0; i-- {
		info, err := os.Lstat(chain[i])
		if err != nil || !info.IsDir() {
			return domain.RegistryUntrusted
		}
		st, ok := info.Sys().(*syscall.Stat_t)
		if !ok || (st.Uid != 0 && int(st.Uid) != os.Getuid()) || (info.Mode().Perm()&0022 != 0 && info.Mode()&os.ModeSticky == 0) {
			return domain.RegistryUntrusted
		}
	}
	return nil
}

func identity(path string) (string, string, error) {
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return "", "", domain.RegistryUntrusted
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || int(st.Uid) != os.Getuid() {
		return "", "", domain.RegistryUntrusted
	}
	return strconv.FormatUint(uint64(st.Dev), 10), strconv.FormatUint(st.Ino, 10), nil
}

func trusted(path string, directory bool) error {
	info, err := os.Lstat(path)
	if err != nil {
		return domain.RegistryUntrusted
	}
	return trustedInfo(info, directory)
}
func trustedInfo(info os.FileInfo, directory bool) error {
	st, ok := info.Sys().(*syscall.Stat_t)
	mode := os.FileMode(0600)
	if directory {
		mode = 0700
	}
	if !ok || int(st.Uid) != os.Getuid() || info.Mode()&(os.ModePerm|os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != mode || info.Mode()&os.ModeSymlink != 0 || directory != info.IsDir() || (!directory && !info.Mode().IsRegular()) {
		return domain.RegistryUntrusted
	}
	return nil
}

func Open(workspace string, create bool) (*Store, error) {
	absolute, err := filepath.Abs(workspace)
	if err != nil {
		return nil, domain.RegistryUntrusted
	}
	canonical, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return nil, domain.RegistryUntrusted
	}
	if err = trustedAncestry(canonical); err != nil {
		return nil, err
	}
	dev, ino, err := identity(canonical)
	if err != nil {
		return nil, err
	}
	s := &Store{workspace: canonical, root: filepath.Join(canonical, ".ariadne", "private", "extensions"), device: dev, inode: ino}
	for _, p := range []string{filepath.Join(canonical, ".ariadne"), filepath.Join(canonical, ".ariadne", "private"), s.root} {
		if _, err := os.Lstat(p); errors.Is(err, os.ErrNotExist) {
			if !create {
				return s, nil
			}
			if err = os.Mkdir(p, 0700); err != nil && !errors.Is(err, os.ErrExist) {
				return nil, domain.RegistryUntrusted
			}
			if err = syncDirectory(filepath.Dir(p)); err != nil {
				return nil, domain.RegistryUntrusted
			}
		} else if err != nil {
			return nil, domain.RegistryUntrusted
		}
		if err = trusted(p, true); err != nil {
			return nil, err
		}
	}
	path := filepath.Join(s.root, "registry.sqlite")
	fresh := false
	if _, err := os.Lstat(path); errors.Is(err, os.ErrNotExist) {
		if !create {
			return s, nil
		}
		f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
		if err == nil {
			fresh = true
			err = f.Close()
		}
		if err != nil && !errors.Is(err, os.ErrExist) {
			return nil, domain.RegistryUntrusted
		}
	} else if err != nil {
		return nil, domain.RegistryUntrusted
	}
	if err = s.checkTree(); err != nil {
		return nil, err
	}
	if !fresh {
		info, err := os.Stat(path)
		if err != nil || info.Size() == 0 {
			return nil, domain.RegistryCorrupt
		}
	}
	for _, name := range []string{"artifacts", "staging"} {
		p := filepath.Join(s.root, name)
		if _, err := os.Lstat(p); errors.Is(err, os.ErrNotExist) && fresh {
			if err = os.Mkdir(p, 0700); err != nil && !errors.Is(err, os.ErrExist) {
				return nil, domain.RegistryUntrusted
			}
		}
		if err = trusted(p, true); err != nil {
			return nil, err
		}
	}
	u := url.URL{Scheme: "file", Path: path}
	q := u.Query()
	q.Set("mode", "rw")
	q.Set("_synchronous", "FULL")
	q.Set("_foreign_keys", "on")
	q.Set("_busy_timeout", "1000")
	q.Set("_txlock", "immediate")
	u.RawQuery = q.Encode()
	db, err := sql.Open("sqlite3", u.String())
	if err != nil {
		return nil, dbError(err)
	}
	db.SetMaxOpenConns(1)
	s.db = db
	failed := true
	defer func() {
		if failed {
			db.Close()
		}
	}()
	if fresh {
		tx, err := db.BeginTx(context.Background(), nil)
		if err != nil {
			return nil, dbError(err)
		}
		defer tx.Rollback()
		if _, err = tx.Exec(schema); err == nil {
			_, err = tx.Exec("INSERT INTO registry_meta VALUES(1,?,?,?,?)", canonical, os.Getuid(), dev, ino)
		}
		if err == nil {
			err = tx.Commit()
		}
		if err != nil {
			return nil, dbError(err)
		}
		if err = syncDirectory(s.root); err != nil {
			return nil, domain.RegistryUntrusted
		}
	}
	tx, err := s.begin(context.Background())
	if err != nil {
		return nil, err
	}
	tx.Rollback()
	failed = false
	return s, nil
}

func (s *Store) Close() error {
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}
func (s *Store) checkTree() error {
	if err := trustedAncestry(s.workspace); err != nil {
		return err
	}
	dev, ino, err := identity(s.workspace)
	if err != nil || dev != s.device || ino != s.inode {
		return domain.WorkspaceMismatch
	}
	for _, p := range []string{filepath.Join(s.workspace, ".ariadne"), filepath.Join(s.workspace, ".ariadne", "private"), s.root} {
		if err = trusted(p, true); err != nil {
			return err
		}
	}
	for _, name := range []string{"registry.sqlite", "registry.sqlite-journal", "registry.sqlite-wal", "registry.sqlite-shm"} {
		p := filepath.Join(s.root, name)
		info, err := os.Lstat(p)
		if errors.Is(err, os.ErrNotExist) && name != "registry.sqlite" {
			continue
		}
		if err != nil {
			return domain.RegistryUntrusted
		}
		if name != "registry.sqlite" && s.hook != nil {
			s.hook("sidecar-observed")
		}
		if err = trustedInfo(info, false); err != nil {
			return err
		}
	}
	return nil
}
func (s *Store) begin(ctx context.Context) (*sql.Tx, error) {
	if s.db == nil {
		return nil, domain.NotInstalled
	}
	if err := s.checkTree(); err != nil {
		return nil, err
	}
	for _, n := range []string{"artifacts", "staging"} {
		if err := trusted(filepath.Join(s.root, n), true); err != nil {
			return nil, err
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	// Context cancellation must not release the writer lock during filesystem changes.
	tx, err := s.db.BeginTx(context.WithoutCancel(ctx), nil)
	if err != nil {
		return nil, dbError(err)
	}
	var version, uid int
	var checkout, dev, ino string
	err = tx.QueryRowContext(ctx, "SELECT schema_version,checkout,owner_uid,device,inode FROM registry_meta").Scan(&version, &checkout, &uid, &dev, &ino)
	if err != nil {
		tx.Rollback()
		return nil, dbError(err)
	}
	if version != 1 {
		tx.Rollback()
		return nil, domain.UnsupportedSchema
	}
	if checkout != s.workspace || uid != os.Getuid() || dev != s.device || ino != s.inode {
		tx.Rollback()
		return nil, domain.WorkspaceMismatch
	}
	var count int
	if err = tx.QueryRow("SELECT count(*) FROM registry_meta").Scan(&count); err != nil || count != 1 {
		tx.Rollback()
		return nil, domain.RegistryCorrupt
	}
	var journal string
	var foreignKeys, synchronous int
	if err = tx.QueryRow("PRAGMA journal_mode").Scan(&journal); err != nil || journal != "delete" {
		tx.Rollback()
		return nil, domain.RegistryCorrupt
	}
	if err = tx.QueryRow("PRAGMA foreign_keys").Scan(&foreignKeys); err != nil || foreignKeys != 1 {
		tx.Rollback()
		return nil, domain.RegistryCorrupt
	}
	if err = tx.QueryRow("PRAGMA synchronous").Scan(&synchronous); err != nil || synchronous != 2 {
		tx.Rollback()
		return nil, domain.RegistryCorrupt
	}
	return tx, nil
}
func dbError(err error) error {
	var known domain.Fault
	if errors.As(err, &known) {
		return known
	}
	var e sqlite3.Error
	if errors.As(err, &e) && (e.Code == sqlite3.ErrBusy || e.Code == sqlite3.ErrLocked) {
		return domain.RegistryBusy
	}
	return domain.RegistryCorrupt
}

func view(tx *sql.Tx, id string) (domain.RegistryView, error) {
	v := domain.RegistryView{ExtensionID: id, Packages: []domain.PackageView{}, OrphanArtifacts: []string{}, StagingEntries: []string{}}
	var selected sql.NullString
	err := tx.QueryRow("SELECT revision,selected_digest,enabled FROM extension_heads WHERE id=?", id).Scan(&v.Revision, &selected, &v.Enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return v, domain.NotInstalled
	}
	if err != nil {
		return v, dbError(err)
	}
	v.SelectedDigest = selected.String
	if v.Revision < 1 || (v.Enabled && !selected.Valid) {
		return v, domain.RegistryCorrupt
	}
	rows, err := tx.Query("SELECT digest,version,status FROM packages WHERE id=? ORDER BY digest", id)
	if err != nil {
		return v, dbError(err)
	}
	defer rows.Close()
	for rows.Next() {
		var p domain.PackageView
		if err = rows.Scan(&p.Digest, &p.Version, &p.Status); err != nil {
			return v, dbError(err)
		}
		if !domain.ValidDigest(p.Digest) || (p.Status != "installed" && p.Status != "removing") {
			return v, domain.RegistryCorrupt
		}
		if p.Status == "removing" {
			v.CleanupPending = true
		} else if p.Digest == v.SelectedDigest {
			if v.Enabled {
				p.Status = "active"
			} else {
				p.Status = "disabled"
			}
		} else {
			p.Status = "inactive"
		}
		v.Packages = append(v.Packages, p)
	}
	return v, dbErrorOrNil(rows.Err())
}
func dbErrorOrNil(err error) error {
	if err != nil {
		return dbError(err)
	}
	return nil
}
func (s *Store) reports(tx *sql.Tx, v *domain.RegistryView) error {
	rows, err := tx.Query("SELECT digest FROM packages")
	if err != nil {
		return dbError(err)
	}
	registered := map[string]bool{}
	for rows.Next() {
		var d string
		if err = rows.Scan(&d); err != nil {
			rows.Close()
			return dbError(err)
		}
		registered[d] = true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return dbError(err)
	}
	for _, name := range []string{"artifacts", "staging"} {
		entries, err := os.ReadDir(filepath.Join(s.root, name))
		if err != nil {
			return domain.RegistryUntrusted
		}
		for _, entry := range entries {
			n := entry.Name()
			if name == "artifacts" && registered[n] {
				continue
			}
			if !domain.ValidDigest(n) {
				n = "unrecognized-entry"
			}
			if name == "artifacts" {
				v.OrphanArtifacts = append(v.OrphanArtifacts, n)
			} else {
				v.StagingEntries = append(v.StagingEntries, n)
			}
		}
	}
	return nil
}
func (s *Store) Inspect(ctx context.Context, id string) (domain.RegistryView, error) {
	if !domain.ValidID(id) {
		return domain.RegistryView{}, domain.InvalidPackage
	}
	tx, err := s.begin(ctx)
	if err != nil {
		return domain.RegistryView{}, err
	}
	defer tx.Rollback()
	v, err := view(tx, id)
	if err != nil && !errors.Is(err, domain.NotInstalled) {
		return v, err
	}
	err = s.reports(tx, &v)
	return v, err
}
func increment(tx *sql.Tx, id string) error {
	result, err := tx.Exec("UPDATE extension_heads SET revision=revision+1 WHERE id=? AND revision<?", id, int64(math.MaxInt64))
	if err != nil {
		return dbError(err)
	}
	n, err := result.RowsAffected()
	if err != nil {
		return dbError(err)
	}
	if n != 1 {
		return domain.RevisionConflict
	}
	return nil
}
func finish(tx *sql.Tx, id string) (domain.RegistryView, error) {
	v, err := view(tx, id)
	if err != nil {
		return v, err
	}
	if err = tx.Commit(); err != nil {
		return v, dbError(err)
	}
	return v, nil
}
func (s *Store) Install(ctx context.Context, pkg domain.PackageSnapshot) (domain.RegistryView, error) {
	if !domain.ValidDigest(pkg.Digest()) {
		return domain.RegistryView{}, domain.InvalidPackage
	}
	tx, err := s.begin(ctx)
	if err != nil {
		return domain.RegistryView{}, err
	}
	defer tx.Rollback()
	id := pkg.Manifest().ExtensionID
	var status string
	err = tx.QueryRow("SELECT status FROM packages WHERE digest=?", pkg.Digest()).Scan(&status)
	if err == nil {
		if status == "removing" {
			return domain.RegistryView{}, domain.RemovalPending
		}
		if err = s.verifyArtifact(pkg); err != nil {
			return domain.RegistryView{}, err
		}
		return finish(tx, id)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return domain.RegistryView{}, dbError(err)
	}
	if err = s.publish(pkg); err != nil {
		return domain.RegistryView{}, err
	}
	if s.hook != nil {
		s.hook("published")
	}
	result, err := tx.Exec("INSERT INTO extension_heads(id,revision,enabled) VALUES(?,1,0) ON CONFLICT(id) DO NOTHING", id)
	if err != nil {
		return domain.RegistryView{}, dbError(err)
	}
	inserted, err := result.RowsAffected()
	if err != nil {
		return domain.RegistryView{}, dbError(err)
	}
	if inserted == 0 {
		if err = increment(tx, id); err != nil {
			return domain.RegistryView{}, err
		}
	}
	_, err = tx.Exec("INSERT INTO packages(digest,id,version,manifest,status) VALUES(?,?,?,?,'installed')", pkg.Digest(), id, pkg.Manifest().Version, pkg.Files()["manifest.json"])
	if err != nil {
		return domain.RegistryView{}, dbError(err)
	}
	return finish(tx, id)
}
func (s *Store) Activate(ctx context.Context, id, digest string, expected int64) (domain.RegistryView, error) {
	return s.selectPackage(ctx, id, digest, expected, true)
}
func (s *Store) Disable(ctx context.Context, id string, expected int64) (domain.RegistryView, error) {
	return s.selectPackage(ctx, id, "", expected, false)
}
func (s *Store) selectPackage(ctx context.Context, id, digest string, expected int64, enable bool) (domain.RegistryView, error) {
	if !domain.ValidID(id) || (enable && !domain.ValidDigest(digest)) {
		return domain.RegistryView{}, domain.InvalidPackage
	}
	tx, err := s.begin(ctx)
	if err != nil {
		return domain.RegistryView{}, err
	}
	defer tx.Rollback()
	v, err := view(tx, id)
	if err != nil {
		return v, err
	}
	if err = v.CheckRevision(expected); err != nil {
		return v, err
	}
	if enable {
		var status string
		err = tx.QueryRow("SELECT status FROM packages WHERE id=? AND digest=?", id, digest).Scan(&status)
		if errors.Is(err, sql.ErrNoRows) {
			return v, domain.NotInstalled
		}
		if err != nil {
			return v, dbError(err)
		}
		if status == "removing" {
			return v, domain.RemovalPending
		}
		_, err = tx.Exec("UPDATE extension_heads SET selected_digest=?,enabled=1 WHERE id=?", digest, id)
	} else {
		_, err = tx.Exec("UPDATE extension_heads SET enabled=0 WHERE id=?", id)
	}
	if err != nil {
		return v, dbError(err)
	}
	if err = increment(tx, id); err != nil {
		return v, err
	}
	return finish(tx, id)
}
func (s *Store) Remove(ctx context.Context, id, digest string, expected int64) (domain.RegistryView, error) {
	if !domain.ValidID(id) || !domain.ValidDigest(digest) {
		return domain.RegistryView{}, domain.InvalidPackage
	}
	tx, err := s.begin(ctx)
	if err != nil {
		return domain.RegistryView{}, err
	}
	defer tx.Rollback()
	v, err := view(tx, id)
	if err != nil {
		return v, err
	}
	if err = v.CheckRevision(expected); err != nil {
		return v, err
	}
	var status string
	err = tx.QueryRow("SELECT status FROM packages WHERE id=? AND digest=?", id, digest).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return v, domain.NotInstalled
	}
	if err != nil {
		return v, dbError(err)
	}
	if err = v.CanRemove(digest); err != nil {
		return v, err
	}
	if status != "removing" {
		_, err = tx.Exec("UPDATE extension_heads SET selected_digest=NULL WHERE id=? AND selected_digest=? AND enabled=0", id, digest)
		if err == nil {
			_, err = tx.Exec("UPDATE packages SET status='removing' WHERE id=? AND digest=?", id, digest)
		}
		if err != nil {
			return v, dbError(err)
		}
		if err = increment(tx, id); err != nil {
			return v, err
		}
	}
	if err = tx.Commit(); err != nil {
		return v, dbError(err)
	}
	if s.hook != nil {
		s.hook("removing")
	}
	return s.cleanup(ctx, id, digest)
}
func (s *Store) cleanup(ctx context.Context, id, digest string) (domain.RegistryView, error) {
	tx, err := s.begin(ctx)
	if err != nil {
		return domain.RegistryView{}, err
	}
	defer tx.Rollback()
	v, err := view(tx, id)
	if err != nil {
		return v, err
	}
	var status string
	err = tx.QueryRow("SELECT status FROM packages WHERE id=? AND digest=?", id, digest).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return finish(tx, id)
	}
	if err != nil {
		return v, dbError(err)
	}
	if status != "removing" || v.SelectedDigest == digest {
		return v, domain.RemovalPending
	}
	if err = s.deleteArtifact(digest); err != nil {
		v.CleanupPending = true
		return v, domain.CleanupPending
	}
	_, err = tx.Exec("DELETE FROM packages WHERE id=? AND digest=? AND status='removing'", id, digest)
	if err != nil {
		return v, dbError(err)
	}
	return finish(tx, id)
}
func syncDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}
func (s *Store) verifyArtifact(pkg domain.PackageSnapshot) error {
	path := filepath.Join(s.root, "artifacts", pkg.Digest())
	if err := trusted(path, true); err != nil {
		return err
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return domain.RegistryUntrusted
	}
	files := pkg.Files()
	if len(entries) != len(files) {
		return domain.RegistryCorrupt
	}
	for _, entry := range entries {
		p := filepath.Join(path, entry.Name())
		if err = trusted(p, false); err != nil {
			return err
		}
		expected, ok := files[entry.Name()]
		if !ok {
			return domain.RegistryCorrupt
		}
		f, err := os.Open(p)
		if err != nil {
			return domain.RegistryUntrusted
		}
		actual, readErr := io.ReadAll(io.LimitReader(f, int64(len(expected))+1))
		closeErr := f.Close()
		if readErr != nil || closeErr != nil || !bytes.Equal(actual, expected) {
			return domain.RegistryCorrupt
		}
	}
	return nil
}
func (s *Store) publish(pkg domain.PackageSnapshot) error {
	destination := filepath.Join(s.root, "artifacts", pkg.Digest())
	if _, err := os.Lstat(destination); err == nil {
		return s.verifyArtifact(pkg)
	} else if !errors.Is(err, os.ErrNotExist) {
		return domain.RegistryUntrusted
	}
	stage, err := os.MkdirTemp(filepath.Join(s.root, "staging"), "package-")
	if err != nil {
		return domain.RegistryUntrusted
	}
	for name, data := range pkg.Files() {
		f, err := os.OpenFile(filepath.Join(stage, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return domain.RegistryUntrusted
		}
		_, writeErr := f.Write(data)
		syncErr := f.Sync()
		closeErr := f.Close()
		if writeErr != nil || syncErr != nil || closeErr != nil {
			return domain.RegistryUntrusted
		}
	}
	if err = syncDirectory(stage); err != nil {
		return domain.RegistryUntrusted
	}
	if s.hook != nil {
		s.hook("staged")
	}
	if err = os.Rename(stage, destination); err != nil {
		return domain.RegistryUntrusted
	}
	if err = syncDirectory(filepath.Join(s.root, "artifacts")); err != nil {
		return domain.RegistryUntrusted
	}
	if err = syncDirectory(filepath.Join(s.root, "staging")); err != nil {
		return domain.RegistryUntrusted
	}
	return nil
}
func (s *Store) deleteArtifact(digest string) error {
	path := filepath.Join(s.root, "artifacts", digest)
	if _, err := os.Lstat(path); errors.Is(err, os.ErrNotExist) {
		return syncDirectory(filepath.Dir(path))
	}
	if err := trusted(path, true); err != nil {
		return err
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !domain.AllowedFile(entry.Name()) {
			return domain.RegistryUntrusted
		}
		if err = trusted(filepath.Join(path, entry.Name()), false); err != nil {
			return err
		}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		if err = os.Remove(filepath.Join(path, entry.Name())); err != nil {
			return err
		}
		if s.hook != nil {
			s.hook("deleted-file")
		}
	}
	if err = os.Remove(path); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}
