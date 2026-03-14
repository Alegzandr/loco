package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

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

	log.Printf("loco server listening on :%s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatal(err)
	}
}
