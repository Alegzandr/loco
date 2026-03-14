package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"loco/server/hub"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	h := hub.New()
	go h.Run()

	http.HandleFunc("/ws", h.ServeWS)
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		stats := h.GetStats()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(stats)
	})
	http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		m := h.GetMetrics()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(m)
	})

	srv := &http.Server{
		Addr: ":" + port,
		// ReadHeaderTimeout guards against Slowloris attacks and stale HTTP connections.
		// WebSocket connections are hijacked before this applies to the WS body.
		ReadHeaderTimeout: 10 * time.Second,
		// IdleTimeout reclaims keep-alive HTTP connections that are no longer active.
		IdleTimeout: 60 * time.Second,
	}
	log.Printf("loco server listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
