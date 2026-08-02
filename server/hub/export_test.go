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

// SetDispatchProbe installs a callback fired at the top of dispatch, before the
// message is routed. It exists so a test can make a handler panic on demand and
// assert the event loop survives it: there is no other way to prove the recover
// in dispatch works without shipping a message type that crashes on purpose.
// Runs in the hub's event-loop goroutine. Pass nil to remove. For tests only.
func (h *Hub) SetDispatchProbe(fn func()) {
	h.dispatchProbe = fn
}
