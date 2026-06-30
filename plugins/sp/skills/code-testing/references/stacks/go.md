---
name: stacks/go
description: "Stack adapter for Go — go test coverprofile command, per-function coverage parsing, table-driven test and interface-mocking idioms. Loaded by unit-testing.md for go.mod projects."
see_also:
  - unit-testing
---

# Stack adapter: Go

Mechanics for the [unit-testing.md](../unit-testing.md) spine when the project is Go.

## Test + coverage command

```bash
go test -v ./...                                         # run + interpret
go test -coverprofile=coverage.out ./... && \
  go tool cover -func=coverage.out                       # per-function coverage
```

`-func` output lists per-function and total coverage:

```
spur/internal/auth/auth.go:21:   ValidateEmail   100.0%
spur/internal/auth/auth.go:42:   Login            66.7%
total:                           (statements)     88.4%
```

Use the per-function column to target the lowest-covered functions first. `go tool cover
-html=coverage.out` opens a line-level view for pinpointing branches.

## Test-file convention

Tests live beside the code as `<name>_test.go` in the same package. Use the standard `testing`
package; no external runner.

## Idioms

**Table-driven tests** — the canonical Go pattern; one row per branch/edge:

```go
func TestValidateEmail(t *testing.T) {
    tests := []struct {
        name    string
        email   string
        wantErr bool
    }{
        {"valid standard", "user@example.com", false},
        {"missing @", "userexample.com", true},
        {"empty", "", true},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            if err := ValidateEmail(tt.email); (err != nil) != tt.wantErr {
                t.Errorf("ValidateEmail(%q) err = %v, wantErr %v", tt.email, err, tt.wantErr)
            }
        })
    }
}
```

**Mock at the boundary via interfaces** — inject a fake implementing the dependency interface:

```go
func TestCreateUser_setsID(t *testing.T) {
    repo := &MockRepository{SaveFunc: func(u *User) error { u.ID = 123; return nil }}
    if err := NewUserService(repo).CreateUser(&User{Name: "Test"}); err != nil {
        t.Fatalf("CreateUser() err = %v", err)
    }
}
```

**Inline coverage-exclusion rationale** — Go has no built-in line-exclusion pragma; document the
unreachable branch in a comment and exclude the file/function at the report level if needed:

```go
// unreachable in production: the adapter guarantees a non-nil row here.
if row == nil {
    panic("unreachable: adapter contract violated")
}
```

## Notes

- Go reports **statement** coverage, not branch coverage — a fully-covered statement count can still
  miss a branch. For branch-sensitive logic, ensure the table has a row per branch and read the
  `-html` view to confirm both sides of each conditional are green.
- Generated code (protobuf, mocks) is conventionally excluded by build tag or a `//go:generate`
  boundary; do not chase coverage on it.
