// export_test.go exposes internal hub fields for white-box testing.
// This file is compiled only during `go test` (package hub, not hub_test).
package hub

// SetRegisterHook installs a callback fired in the register case immediately
// after the client is added to h.clients but before c.start().
// The hook runs in the hub's event-loop goroutine; it must not block.
// Pass nil to remove. For tests only.
func (h *Hub) SetRegisterHook(fn func()) {
	h.afterRegisterHook = fn
}
